import {Movie, Savestate} from './wire.js';
import {checkState} from './utils.js';

export {Movie};

// Facilities for recording inputs in a run for future playback.
// Each frame we query the state of the controls and write any
// changes to the array.

// Recordings are stored as a protobuf, relying on packed repeated
// uint32 fields to store long sequences of button presses efficiently.
// The main repeated 'records' field stores a combination of both the
// number of frames since the last datum as well as the button that
// was pressed or released.  The number is as follows:
//
//   xxxx ffff   ffff ffff   ffff ffff   cbbb pfff 
//
//   f = 23-bit frame count (at 60 fps, this is 1.6 days)
//   p = 1 if pressed, 0 if released
//   b = button index [A,B,select,start,up,down,left,right]
//   c = 1 if controller 2, 0 if controller 1
//   x = extra data for rare events:
//       1 = soft reset
//       2 = end of chunk (e.g. from savestate) - no actual input
//
// The basic idea here is that at maximum APM (.133 sec between
// buttons), each button press/release takes only a single byte.
// On the 2nd controller or with gaps up to 8.5 seconds, a press
// takes two bytes.  Beyond that they're so infrequent we don't
// really care how big they are.

// Between chunks we have the possibility for savestate-enabled
// "keyframes", which can be navigated between, both for sync
// purposes and other debugging or editing use cases.

// This all seems to work assuming we start with a soft reset (or from the
// title screen, etc).  But it would be good to have some integration w/
// save states/snapshots so that we could record a movie from anywhere,
// In particular, while replaying if I take a snapshot it should include the
// state of the replay (or split the replay to have a new keyframe).

// TODO - need a way to continue recordings
//   -- auto-stop at end of playback/record could help things, assuming no OBO errors
//   -- consider adding snapshots (i.e. keyframes) into the mix
//      would allow resyncing
//   -- could put together a multi-session full playthrough, with keyframes every few
//      minutes to ensure quick navigation.


class Record {
  constructor(record = 0) {
    this.frames = (record & 7 | (record & 0x0fffff00) >> 5) - 1;
    this.button = (record >>> 4) & 7;
    this.pressed = (record >>> 3) & 1;
    this.controller = (record >>> 7) & 1;
    this.softReset = (record >>> 28) == 1;
    this.empty = (record >>> 28) == 2;
  }

  number() {
    if (this.frames < 0) throw new Error('Negative frames');
    const f = this.frames + 1;
    const num = (f & 7) | ((f << 5) & 0x0fffff00);
    if (this.empty) return num | 0x20000000;
    if (this.softReset) return num | 0x10000000;
    return num |
        (this.controller << 7) |
        (this.pressed << 3) |
        (this.button << 4);
  }
}

class Keyframe {
  constructor(movie, index, position) {
    this.movie = movie;
    this.index = index;
    this.position = position;
  }

  image() {
    return new Uint8Array(this.movie.getImage(this.index));
  }

  imageDataUrl() {
    return 'data:image/png;base64,' + btoa(String.fromCharCode(...this.image()));
  }
}

// interface:

class MovieInterface {
  keyframes() {}
  seek(keyframe) {}
}

export class Playback {
  constructor(nes, movie, {onStop = () => {}} = {}) {
    this.nes = nes;
    this.movie = movie instanceof Movie ? movie : Movie.parse(movie, 'NES-MOV\x1a');
    this.onStop = onStop;
    this.chunkIndex = 0;
    this.recordIndex = 0;
    this.framesWaited = 0;
    this.framesFromStart = 0;
    this.playing = false;
  }

  start() {
    if (this.movie.chunks[this.chunkIndex].snapshot) {
      this.nes.restoreSavestate(this.movie.chunks[this.chunkIndex].snapshot);
      this.framesFromStart -= this.recordIndex;
      this.recordIndex = 0;
      this.framesWaited = 0;
    }
    this.playing = true;
  }

  stop() {
    this.playing = false;
    // TODO - we're likely to end up in a broken state here.
    // figure out the use cases and see what we should actually do.
  }

  frame() {
    return this.framesFromStart;
  }

  totalFrames() {
    return this.movie.frames;
  }

  keyframes() {
    let frames = 0;
    const result = [];
    const chunks = this.movie.chunks;
    for (let i = 0; i < chunks.length; i++) {
      if (chunks[i].snapshot) {
        result.push(new Keyframe(this, i, frames));
      }
      frames += chunks[i].frames;
    }
    return result;
  }

  // Workaround for bug where "load savestate" during movie recording
  // didn't keep track of the load - we should have done a "seek" but
  // instead we just kept on recording even though the state of the
  // emulator was completely changed from under us.  We should remove
  // this code and instead fix up any old movies, but for now it's a
  // start.
  checkSkip() {
    const thisChunk = this.movie.chunks[this.chunkIndex];
    const nextChunk = this.movie.chunks[this.chunkIndex + 1];
    if (!(thisChunk && thisChunk.snapshot && nextChunk && nextChunk.snapshot)) {
      return;
    }
    let frames = thisChunk.frames +
        Savestate.parse(thisChunk.snapshot, 'NES-STA\x1a').ppu.timing.frame -
        Savestate.parse(nextChunk.snapshot, 'NES-STA\x1a').ppu.timing.frame;
    if (!frames) return;
    frames += window.SKIP_DELTA && window.SKIP_DELTA[this.chunkIndex] || 0;
    console.log(`Skipping ${frames} frames to patch savestate recording bug`);

    frames += this.framesWaited;
    this.framesFromStart -= this.framesWaited;
    this.framesWaited = 0;
    let rec = this.peekRecord();
    while (rec && rec.frames < frames) {
      frames -= rec.frames;
      this.framesFromStart += rec.frames;
      this.recordIndex++;
      rec = this.peekRecord();
    }
    this.framesFromStart += frames;
    this.framesWaited = frames;
  }

  seek(keyframe) {
    checkState(keyframe.movie == this, 'invalid keyframe');
    this.chunkIndex = keyframe.index;
    this.framesFromStart = keyframe.position;
    this.recordIndex = 0;
    this.framesWaited = 0;
    this.playing = true;
    this.nes.resetControllers();
    this.nes.restoreSavestate(this.movie.chunks[keyframe.index].snapshot);
    // attempted workaround to fix buggy movies...?
    this.checkSkip();
  }

  peekRecord() {
    while (this.chunkIndex < this.movie.chunks.length) {
      const chunk = this.movie.chunks[this.chunkIndex];
      if (this.recordIndex >= chunk.records.length) {
        this.recordIndex = 0;
        this.chunkIndex++;
        this.checkSkip();
        continue;
      }
      const record = chunk.records[this.recordIndex];
      if (record === 0) throw new Error('Invalid empty record');
      return new Record(record);
    }
    return null;
  }

  // TODO - consider a promise-based approach to advance N frames,
  // making sure not to hang the UI while we do it.
  playbackFrame() {
    if (!this.playing) return;
    let rec = this.peekRecord();
    if (!rec) return;
    while (rec && rec.frames == this.framesWaited) {
      if (rec.empty) {
        // do nothing
      } else if (rec.softReset) {
        this.nes.cpu.softReset();
      } else if (rec.pressed) {
        //console.log(`playback: button down ${rec.controller+1}:${rec.button}`);
        this.nes.buttonDown(rec.controller + 1, rec.button);
      } else {
        //console.log(`playback: button up   ${rec.controller+1}:${rec.button}`);
        this.nes.buttonUp(rec.controller + 1, rec.button);
      }
      this.framesWaited = 0;
      this.recordIndex++;
      rec = this.peekRecord();
    }
    if (!rec) this.onStop();
    this.framesWaited++;
    this.framesFromStart++;
  }

  // Returns a movie that ends at the current frame.
  slice() {
    throw new Error('Not yet implemented');
  }

  getImage(chunkIndex) {
    const result =
        Savestate.parse(this.movie.chunks[chunkIndex].snapshot, 'NES-STA\x1a')
            .screen;
    return result;
  }
}

export class Recorder {
  // TODO - accept a Movie or Playback object 
  constructor(nes, movie = undefined) {
    //if (movie && !movie.chunks) throw new Error('Invalid movie file');
    this.nes = nes;
    this.recording = false;
    this.totalFrames = movie && movie.frames || 0;
    this.chunks = movie && movie.chunks ? movie.chunks.slice() : [];
    this.chunkFrames = 0;
    this.framesSinceRecord = 0;
    this.records = [];
    this.lastSnapshot = null;
    this.autosave = 0;
    // TODO - add a final snapshot field to the movie for continuation?
  }

  recordFrame() {
    if (!this.recording) return;
    this.framesSinceRecord++;
    this.chunkFrames++;
    this.totalFrames++;
    if (this.autosave && this.chunkFrames >= this.autosave) {
      this.keyframe(this.nes.writeSavestate());
    }
  }

  keyframe(snapshot = null) {
    // Ends the current chunk and starts a new one.
    if (!this.recording) return;
    if (!this.chunkFrames) {
      if (snapshot) this.lastSnapshot = snapshot;
      return;
    }
    // First add an empty frame if needed.
    if (this.framesSinceRecord) {
      const rec = new Record();
      rec.frames = this.framesSinceRecord;
      rec.empty = true;
      this.framesSinceRecord = 0;
      this.records.push(rec.number());
    }
    const chunk = Movie.Chunk.of({
      snapshot: this.lastSnapshot,
      records: Uint32Array.from(this.records),
      frames: this.chunkFrames,
    });
    this.chunkFrames = 0;
    this.lastSnapshot = snapshot;
    this.chunks.push(chunk);
    this.records = [];
    for (const [controller, button] of this.nes.buttonsPressed()) {
      this.record({controller, button, pressed: true});
    }
  }

  record({controller, button, pressed, reset}) {
    if (!this.recording) return;
    if (controller != null || button != null || pressed != null) {
      checkState(controller == 1 || controller == 2,
                 `controller must be 1 or 2: ${controller}`);
      controller = controller > 1 ? 1 : 0;
      checkState(button >= 0 && button <= 7,
                 `button must be between 0 and 7: ${button}`);
      button = button & 7;
      checkState(!reset, 'reset cannot be combined with buttons');
      pressed = pressed ? 1 : 0;
    }
    //console.log(`record ctrl ${controller} btn ${button} pressed ${pressed}`);

    const rec = new Record();
    rec.frames = this.framesSinceRecord;
    if (reset) {
      rec.softReset = true;
    } else {
      Object.assign(rec, {button, controller, pressed});
    }
    this.records.push(rec.number());
    this.framesSinceRecord = 0;
  }

  // loadFile(buffer) {
  //   if (!(buffer instanceof Uint8Array) &&
  //       buffer.buffer instanceof ArrayBuffer) {
  //     buffer = buffer.buffer;
  //   }
  //   if (buffer instanceof ArrayBuffer) buffer = new Uint8Array(buffer);
  //   this.buffer = buffer;
  //   this.index = this.buffer.length;
  // }

  save() {
    this.keyframe(); // might be a no-op
    return Movie.of({
      chunks: this.chunks,
      frames: this.totalFrames,
    }).serialize('NES-MOV\x1a');
  }

  cancel() {
    // TODO - other behavior?
    this.nes.movie = null;
    this.remove();
  }

  start() {
    // probably need to check that this makes sense, or restore a savestate?
    this.recording = true;
  }

  stop() {
    this.recording = false;
  }

  isLastKeyframeStale(keyframe) {
    if (!keyframe) return !!this.lastSnapshot;
    if (this.lastSnapshot) return keyframe.index != this.chunks.length;
    for (let i = this.chunks.length - 1; i >= 0; i--) {
      if (this.chunks[i].snapshot) return keyframe.index != i;
    }
    return keyframe != null;
  }

  keyframes() {
    let frames = 0;
    const result = [];
    for (let i = 0; i < this.chunks.length; i++) {
      if (this.chunks[i].snapshot) {
        result.push(new Keyframe(this, i, frames));
      }
      frames += this.chunks[i].frames;
    }
    if (this.lastSnapshot) {
      result.push(new Keyframe(this, this.chunks.length, frames));
    }
    return result;
  }

  frame() {
    return this.totalFrames;
  }

  seek(keyframe) {
    checkState(keyframe.movie == this, 'invalid keyframe');
    const savestate = keyframe.index < this.chunks.length ?
        this.chunks[keyframe.index].snapshot : this.lastSnapshot;
    this.nes.restoreSavestate(savestate);
    this.lastSnapshot = savestate;
    this.chunks.splice(keyframe.index, this.chunks.length - keyframe.index);
    this.records = [];
    this.nes.resetControllers();
    this.totalFrames = keyframe.position;
    this.chunkFrames = 0;
    this.framesSinceRecord = 0;
    this.recording = true;
  }

  getImage(chunkIndex) {
    return Savestate.parse(
        chunkIndex < this.chunks.length ?
            this.chunks[chunkIndex].snapshot : this.lastSnapshot,
        'NES-STA\x1a').screen;
  }
}
