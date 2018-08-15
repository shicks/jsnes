// Facilities for recording inputs in a run for future playback.
// Each frame we query the state of the controls and write any
// changes to the array.

// Format:
// Goal: pack as much as possible into fewest bytes.
// Records can be 1 or more bytes.  If the high byte is a
// 1 then the record continues in the next byte.
// First byte:
//  c fff bbb p
//  ^  ^   ^  ^-- pressed (1), unpressed (0)
//  |  |   \----- button index (see controller.js)
//  |  \--------- low bits of frames+1 since last record
//  \------------ 1 if continued
// Second byte:
//  c fffff bb
//  ^   ^    ^-- button (controller # (0 or 1), 2 for soft reset, 3 unused
//  |   \------- next 5 bits of frames+1 since last record
//  \----------- 1 if continued
// Third and later bytes:
//  c ffffff 0
//  ^   ^    ^-- currently must be zero - 1 is reserved for a later purpose
//  |   \------- next 6 bits of frame+1
//  \----------- continuation bit
// Note that 0 is never a valid (uncontinued) record, due to adding 1 to frame.
// This is intentional, since otherwise attempting to play back an empty array
// will lead to some problems.

// This all seems to work assuming we start with a soft reset (or from the
// title screen, etc).  But it would be good to have some integration w/
// save states/snapshots so that we could record a movie from anywhere,
// In particular, while replaying if I take a snapshot it should include the
// state of the replay.

const MODE_REC = 'rec';
const MODE_PLAY = 'play';

export class Recording {
  constructor(nes) {
    this.nes = nes;
    this.mode = null;  // null, 'rec', or 'play'
    this.buffer = new Uint8Array(0x10000);
    this.frame = 0;
    this.index = 0;
  }

  recordFrame() {
    this.frame++;
  }

  record({controller, button, pressed, reset}) {
    if (this.mode != MODE_REC) return;
    if (controller != null || button != null || pressed != null) {
      if (!(controller == 1 || controller == 2)) {
        throw new Error('controller must be 1 or 2: ' + controller);
      }
      controller = controller > 1 ? 1 : 0;
      if (!(button >= 0 && button <= 7)) {
        throw new Error('button must be beterrn 0 and 7: ' + button);
      }
      button = ((button & 7) << 1) | (pressed ? 1 : 0);
      if (reset) throw new Error('reset cannot be combined with buttons');
    } else if (reset) {
      controller = 2; // 2 in the controller position indicates a reset
      button = 0;
    }
    if (this.buffer.length < this.index + 20) {
      const newBuffer = new Uint8Array(Math.max(0x1000, this.buffer * 2));
      newBuffer.set(this.buffer);
      this.buffer = newBuffer;
    }
    let frame = this.frame + 1;
    this.frame = 0;
    let continued = frame > 7 || controller ? 0x80 : 0;
    // first byte
    this.buffer[this.index++] = continued | ((frame & 7) << 4) | button;
    if (!continued) return;
    frame >>>= 3;
    // second byte
    continued = frame > 31 ? 0x80 : 0;
    this.buffer[this.index++] = continued | ((frame & 31) << 2) | controller;
    frame >>>= 5;
    while (continued) {
      continued = frame > 63 ? 0x80 : 0;
      this.buffer[this.index++] = continued | ((frame & 63) << 1);
      frame >>>= 6;
    }
  }

  nextFrame() {
    let pos = this.index;
    let frame = 0;
    frame = (this.buffer[pos] >>> 4) & 7;
    if (!(this.buffer[pos++] & 0x80)) return frame - 1;
    frame |= (this.buffer[pos] & 0x7c) << 1;
    if (!(this.buffer[pos++] & 0x80)) return frame - 1;
    let shift = 1 << 8;
    do {
      frame += ((this.buffer[pos] >>> 1) & 0x3f) * shift;
      shift *= (1 << 6);
    } while (this.buffer[pos++] & 0x80);
    return frame - 1;
  }

  playbackFrame() {
    if (this.mode != MODE_PLAY) return;
    if (this.index >= this.buffer.length) {
      this.mode = null;
      return;
    }
    if (!this.buffer[this.index]) throw new Error('cannot play empty file');
    while (this.nextFrame() == this.frame) {
      let button = (this.buffer[this.index] & 0x0e) >>> 1;
      let pressed = this.buffer[this.index] & 1;
      let controller = 0;
      if (this.buffer[this.index++] & 0x80) {
        controller = this.buffer[this.index] & 0x3;
        while (this.buffer[this.index++] & 0x80) {}
      }
      if (controller == 2) {
        //console.log(`playback: soft reset`);
        this.nes.cpu.softReset();
      } else if (pressed) {
        //console.log(`playback: button down ${controller+1}:${button}`);
        this.nes.buttonDown(controller + 1, button);
      } else {
        //console.log(`playback: button up   ${controller+1}:${button}`);
        this.nes.buttonUp(controller + 1, button);
      }
      this.frame = 0;
    }
  }

  clear() {
    this.buffer = new Uint8Array(0x10000);
    this.index = 0;
    this.frame = 0;
    this.mode = null;
  }

  loadFile(buffer) {
    if (!(buffer instanceof Uint8Array) &&
        buffer.buffer instanceof ArrayBuffer) {
      buffer = buffer.buffer;
    }
    if (buffer instanceof ArrayBuffer) buffer = new Uint8Array(buffer);
    this.buffer = buffer;
    this.index = this.buffer.length;
  }

  saveFile() {
    // return a trimmed buffer
    return this.buffer.slice(0, this.index);
  }

  startPlayback(index = 0) {
    this.index = index;
    this.frame = 0;
    this.mode = MODE_PLAY;
  }

  startRecording() {
    this.clear(); // any reason to append?
    this.mode = MODE_REC;
  }

  stop() {
    this.mode = null;
  }
}
