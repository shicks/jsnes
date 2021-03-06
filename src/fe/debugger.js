// Debugging tools
import {child, text, link, fmt} from './utils.js';
import {CodeDataLog} from '../cdl.js';
import {Component} from './component.js';
import {Controller} from '../controller.js';
import {Savestate} from '../wire.js';
import {disassemble} from '../disassembler.js';

// A single watched memory location or expression.
export class Watch {
  constructor(expression, format = (x) => fmt(x, 2)) {
    this.expression = expression;
    this.element = document.createElement('span');
    this.element.classList.add('value');
    this.value = -1;
    this.red = 0;
    this.format = format;
  }

  update(format = (x) => this.format(x), dim = 2) {
    const newValue = this.expression();
    if (this.value != newValue) {
      this.element.textContent = format(newValue);
      this.element.style.color = '#ff0000';
      this.value = newValue;
      this.red = 255;
    } else if (this.red > 0) {
      this.red = Math.max(0, this.red - dim);
      this.element.style.color = `#${this.red.toString(16).padStart(2,0)}0000`;
    }
  }

  static ram(nes, address) {
    return new Watch(() => nes.cpu.load(address));
  }
}

export class WatchGroup extends Component {
  constructor() {
    super();
    this.watches = [];
    // TODO(sdh): might be reasonable to set this per-watch?
    // maybe single-click value to toggle, single-click top-left to toggle all,
    // double-click anywhere to delete
    this.format = 'hex';
  }

  update(dim) {
    for (const watch of this.watches) {
      watch.update(x => this.formatValue(x), dim);
    }
  }

  frame() {
    this.update(2);
  }

  step() {
    this.update(24);
  }

  formatValue(v) {
    if (this.format == 'dec') return v.toString(10).padStart(3);
    if (this.format == 'asc') return `'${String.fromCharCode(v)}'`;
    return fmt(v, 2);
  }
}

// TODO(sdh): make this configurable from the UI?
export class WatchPanel extends WatchGroup {
  constructor(nes, ...addrs) {
    super();
    this.element.classList.add('watch');
    for (let addr of addrs) {
      const entry = child(this.element, 'div', 'group');
      if (addr instanceof Array && addr.length == 1) addr = addr[0];
      if (!(addr instanceof Array)) addr = [addr, addr];
      const label = text(entry, fmt(addr[0], 4) + ':');
      for (let a = addr[0]; a <= addr[1]; a++) {
        // TODO(sdh): allow other expressions, possibly registers...?
        text(entry, ' ');
        const watch = Watch.ram(nes, a);
        entry.appendChild(watch.element);
        this.watches.push(watch);
      }
    }
  }
}

export class WatchReg extends WatchGroup {
  constructor(nes) {
    super();
    this.element.classList.add('watch');
    this.group = child(this.element, 'div');
    this.watch('A: ', () => nes.cpu.REG_ACC);
    this.watch(' X: ', () => nes.cpu.REG_X);
    this.watch(' Y: ', () => nes.cpu.REG_Y);
    this.watch('\nSP: ', () => nes.cpu.REG_SP & 0xff);
    this.watch(' PC: ', () => nes.cpu.REG_PC, (x) => fmt(x, 4));
    this.watch('\nF: ', () => nes.cpu.F_CARRY ? 'C' : '-', (x) => x);
    this.watch('', () => nes.cpu.F_NONZERO ? '-' : 'Z', (x) => x);
    this.watch('', () => nes.cpu.F_INTERRUPT ? 'I' : '-', (x) => x);
    this.watch('', () => nes.cpu.F_DECIMAL ? 'D' : '-', (x) => x);
    this.watch('', () => nes.cpu.F_BRK ? 'B' : '-', (x) => x);
    this.watch('', () => nes.cpu.F_NOTUSED ? 'U' : '-', (x) => x);
    this.watch('', () => nes.cpu.F_OVERFLOW ? 'V' : '-', (x) => x);
    this.watch('', () => nes.cpu.F_SIGN ? 'S' : '-', (x) => x);
  }

  watch(label, reg, fmt = undefined) {
    if (label) text(this.group, label);
    const watch = new Watch(reg, fmt);
    this.group.appendChild(watch.element);
    this.watches.push(watch);
  }

  update(dim) {
    for (const watch of this.watches) {
      watch.update(undefined, dim);
    }
  }
}

export class WatchPpu extends WatchGroup {
  constructor(nes) {
    super();
    this.element.classList.add('watch');
    this.group = child(this.element, 'div');
    this.watch('frame: ', () => nes.ppu.frame);
    this.watch(' scanline: ', () => nes.ppu.scanline);
    this.watch(' curX: ', () => nes.ppu.curX);
    this.watch('\ncntFV: ', () => nes.ppu.cntFV.toString(16));
    this.watch(' cntVT: ', () => nes.ppu.cntVT.toString(16));
    this.watch(' cntV: ', () => nes.ppu.cntV.toString(16));
    this.watch(' cntH: ', () => nes.ppu.cntH.toString(16));
    this.watch('\nregFV: ', () => nes.ppu.regFV.toString(16));
    this.watch(' regVT: ', () => nes.ppu.regVT.toString(16));
    this.watch(' regV: ', () => nes.ppu.regV.toString(16));
    this.watch(' regH: ', () => nes.ppu.regH.toString(16));
  }

  watch(label, reg, fmt = undefined) {
    if (label) text(this.group, label);
    const watch = new Watch(reg, fmt);
    this.group.appendChild(watch.element);
    this.watches.push(watch);
  }

  update(dim) {
    for (const watch of this.watches) {
      watch.update(undefined, dim);
    }
  }
}

export class WatchPage extends WatchGroup {
  constructor(nes, page) {
    super();
    page <<= 8;
    this.element.classList.add('watchpage');
    const head = child(this.element, 'div');
    text(head, '     x0 x1 x2 x3 x4 x5 x6 x7 x8 x9 xa xb xc xd xe xf');
    for (let i = page; i < page + 0x100; i += 0x10) {
      const row = child(this.element, 'div');
      text(row, `${(i>>4).toString(16).padStart(3, 0)}x`);
      for (let j = i; j < i + 0x10; j++) {
        const watch = Watch.ram(nes, j)
        row.appendChild(watch.element);
        watch.element.addEventListener(
            'click', () => watch.element.classList.toggle('highlight'));
        this.watches.push(watch);
      }
    }
  }

  formatValue(v) {
    // Note: big decimal numbers will run into each other...
    if (this.format == 'dec') return v.toString(10).padStart(3);
    if (this.format == 'asc') return ` ${String.fromCharCode(v)} `;
    return ' ' + v.toString(16).padStart(2, 0);    
  }
}

export class Trace extends Component {
  constructor(nes, start) {
    super();
    this.nes = nes;
    this.start = start;
    this.addCornerButton('o', () => this.clear());
    this.addCornerButton('^', () => this.back());
    this.addCornerButton('>', () => this.advance(1));
    this.addCornerButton('>>', () => this.advance(128));
    this.element.classList.add('trace');
    this.trace = child(this.element, 'div');
    this.next = child(this.element, 'div');
    this.size = 0;
    this.top = null;
    this.current = null;

    this.registerKey('f', 'Advance Frame', () => this.advanceFrame());
    this.registerKey('t', 'Advance Tile Row', () => this.advanceTileRow());
    this.registerKey('o', 'Step Out', () => this.stepOut());
    this.registerKey('g', 'Step', () => this.advance(1));
  }

  clearDom() {
    while (this.trace.firstChild) this.trace.firstChild.remove();
  }

  clear() {
    this.clearDom();
    this.size = 0; // doubling
    this.top = null;
    this.current = null;
  }

  advance(cycles) {
    this.nes.debug.breakIn = cycles;
    this.start();
  }

  advanceFrame() {
    this.nes.debug.breakAtScanline = -1;
    this.start();
  }

  stepOut() {
    this.nes.debug.stepOut();
    this.start();
  }
  
  advanceTileRow() {
    this.nes.debug.breakAtScanline =
        this.nes.ppu.scanline < 20 || this.nes.ppu.scanline > 260 ?
            0 : this.nes.ppu.scanline - 13;
    this.start();
  }

  frame() {
    // don't update on every frame, but do keep track of how far back we are.
  }

  step() {
    // update the log on a step
    const result = [];
    let previous = this.current;
    this.current = this.nes.debug.tracePosition();
    if (this.current.distance(previous) > 0x4000) {
      this.clearDom();
      this.size = 0x400;
      this.top = null;
      previous = this.size;
    }
    const top = this.nes.debug.trace(this.current, previous, (s) => result.push(s));
    if (!this.top) this.top = top;

    const documentScroll = document.body.scrollTop;
    const scroll = this.element.scrollTop;
    this.next.scrollIntoView();
    let shouldScroll = true;
    if (scroll != this.element.scrollTop) {
      this.element.scrollTop = scroll;
      shouldScroll = false;
    }
    text(this.trace, result.join('\n'));
    this.fillNext();
    if (shouldScroll) this.next.scrollIntoView();
    document.body.scrollTop = documentScroll;
  }

  back() {
    if (this.current == null) this.step();
    const result = [];
    this.top = this.nes.debug.trace(this.top, this.size, (s) => result.push(s));
    this.size *= 2;
    const text = document.createTextNode(result.join('\n'));
    this.trace.insertBefore(text, this.trace.firstChild);
  }

  fillNext() {
    this.next.textContent = this.nes.debug.nextInstruction();
  }
}

export class PatternTableViewer extends Component {
  // TODO - allow selecting a palette?
  // TODO - static CHR ROM viewer?
  constructor(nes) {
    super();
    this.nes = nes;
    //this.table = table << 12; // 0 (left) or 1 (right)
    this.canvas = child(this.element, 'canvas', 'patterntable');
    this.canvas.width = 288;
    this.canvas.height = 180;
    this.context = this.canvas.getContext('2d');
    // We could try to be smart about which palettes are used for
    //    which tiles, and auto-pick unique options.
    // Note: extra size is for a black grid between all patterns.
    this.imageData = this.context.getImageData(0, 0, 288, 143);

    this.buf = new ArrayBuffer(this.imageData.data.length);
    this.buf8 = new Uint8ClampedArray(this.buf);
    this.buf32 = new Uint32Array(this.buf);

    // Set alpha
    for (let i = 0; i < this.buf32.length; ++i) {
      this.buf32[i] = 0xff000000;
    }

    this.palette = null;
    this.palIndex = -1;
    this.canvas.addEventListener('click', (e) => this.click(e));
    this.canvas.addEventListener('mousemove', (e) => this.mousemove(e));
    this.info = child(this.element, 'pre');
  }

  mousemove(e) {
    let x = e.offsetX;
    let y = e.offsetY;
    const table = x < 146 ? 0 : 1;
    if (table) x -= 145;
    if (y >= 145) { // palette
      const index = Math.floor(x / 33) + table * 4;
      if (this.palIndex == index) {
        this.palIndex = -1;
      } else {
        this.palIndex = index;
      }
      this.hoverPalette(index);
      return;
    }
    const row = Math.floor(y / 9);
    const column = Math.floor(x / 9);
    this.hoverTile(table, row, column);
  }

  click(e) {
    if (e.offsetY < 145) return;
    let x = e.offsetX;
    const table = x < 146 ? 0 : 1;
    if (table) x -= 145;
    const index = Math.floor(x / 33) + table * 4;
    if (this.palIndex == index) {
      this.palIndex = -1;
    } else {
      this.palIndex = index;
    }
    this.frame();
  }

  hoverPalette(index) {
    // TODO - not really a good way to get the index we actually want... :-/
  }

  tileId(row, col) {
    return row << 4 | col;
  }

  hoverTile(table, row, col) {
    const id = this.tileId(row, col);
    const addr = table << 12 | id << 4;
    const index = (addr >> 4).toString(16).padStart(3, 0);
    const fullAddr = this.nes.mmap.mapChr(addr);
    const fullIndex = (fullAddr >> 4).toString(16).padStart(4, 0);
    const bank = (fullAddr >> 10).toString(16).padStart(2, 0);
    this.info.textContent =
        `Pattern $${fullIndex} (at $${index}), 1k bank $${bank}`;
  }

  getTile(table, row, col, tileRow, colors) {
    const addr = table << 12 | this.tileId(row, col) << 4| tileRow;
    this.getTileInternal(
        this.nes.ppu.patternTableBanks[addr >> 10][addr & 0x3ff], colors);
  }

  getTileInternal(line, colors) {
    for (let bit = 7; bit >= 0; bit--) {
      colors[bit] = this.palette[line & 3];
      line >>>= 2;
    }
  }

  frame() {
    // Update the image data.
    const tile = [0, 0, 0, 0, 0, 0, 0, 0];
    const p = this.nes.ppu.palette();
    // Select the palette
    if (this.palIndex < 0) {
      this.palette = [
        0x000000,
        0xffffff,
        0xaaaaaa,
        0x555555,
      ];
    } else {
      this.palette = p.slice(4 * this.palIndex).slice(0, 4);
    }
    this.palette = this.palette.map(x => (x | 0xff000000) >>> 0);

    for (let table = 0; table < 2; table++) {
      const x0 = table ? 145 : 0;
      for (let row = 0; row < 16; row++) {
        const y1 = row * 9;
        for (let column = 0; column < 16; column++) {
          const x1 = x0 + column * 9;
          for (let tileRow = 0; tileRow < 8; tileRow++) {
            this.getTile(table, row, column, tileRow, tile);
            const index = (y1 + tileRow) * 288 + x1;
            
            for (let bit = 0; bit < 8; bit++) {
              // Convert pixel from NES BGR to canvas ABGR
              this.buf32[index + bit] = tile[bit];
            }
          }
        }
      }

      // add the palette choices
      const y0 = 148;
      for (let pal = 0; pal < 4; pal++) {
        const x1 = x0 + pal * 33;
        for (let row = 0; row < 2; row++) {
          const y1 = y0 + row * 16;
          for (let col = 0; col < 2; col++) {
            const i = table * 16 + pal * 4 + row * 2 + col;
            const c =
                ((p[i] & 0xff) << 16) |
                (p[i] & 0xff00) |
                ((p[i] & 0xff0000) >> 16);
            this.context.fillStyle = `#${c.toString(16).padStart(6,0)}`;
            this.context.fillRect(x1 + col * 16, y1, 16, 16);
          }
        }
        if (4 * table + pal == this.palIndex) {
          this.context.strokeStyle = '#ff0000';
          this.context.strokeRect(x1 + 1, y0 + 1, 30, 30);
        }
      }
    }

    this.imageData.data.set(this.buf8);
    this.context.putImageData(this.imageData, 0, 0);
  }
}

// This is for MMC5 w/ 8x16 sprite mode b/c it has a separate pattern tale
export class SpritePatternTableViewer extends PatternTableViewer {
  tileId(row, col) {
    // row,col => id mapping for 8x16 sprites:
    //  (0,0) => 0, (1,0) => 1, (0,1) => 2, (1,1) => 3, (1,f) => 31, (2,0) => 32
    return (row & 0xe) << 4 | col << 1 | row & 1;
  }

  getTile(table, row, col, tileRow, colors) {
    const addr = table << 12 | this.tileId(row, col) << 4| tileRow;
    const banks =
        this.nes.ppu.tallSpritePatternTableBanks ||
        this.nes.ppu.patternTableBanks;
    this.getTileInternal(banks[addr >> 10][addr & 0x3ff], colors);
  }

  hoverTile(table, row, col) {
    const id = this.tileId(row, col);
    const addr = table << 12 | id << 4;
    const index = (id & ~1 | table & 1).toString(16).padStart(2, 0);
    // const index = (addr >> 4).toString(16).padStart(2, 0);
    const fullAddr = this.nes.mmap.mapChr(addr);
    const fullIndex = (fullAddr >> 4).toString(16).padStart(4, 0);
    const bank = (fullAddr >> 10).toString(16).padStart(2, 0);
    this.info.textContent =
        `Pattern $${fullIndex} (at $${index}), 1k bank $${bank}`;
  }
}

export class ChrRomViewer extends PatternTableViewer {
  
  // views 1k pages
  constructor(nes, pages) {
    super(nes);
    this.pages = pages;
  }

  hoverTile(table, row, col) {
    // TODO - less important, but might be nice.
  }

  getTile(table, row, col, tileRow, colors) {
    // support up to 8 different pages
    const bankIndex = (table << 2) | (row >>> 2);
    if (bankIndex >= this.pages.length) {
      for (let i = 0; i < 8; i++) this.getTileInternal(0, colors);
      return;
    }

    const bank = this.pages[bankIndex];
    const addr = (bank << 10) | ((row & 3) << 8) | (col << 4) | tileRow;
    this.getTileInternal(this.nes.ppu.patternTableFull[addr], colors);
    // const bankNum = bank >>> 2;
    // const addr = (bank % 4) << 10 | ((row & 3) << 8) | (col << 4) | tileRow;
    // this.getTileInternal(
    //     this.nes.ppu.patternTableFull.subarray(bankNum, bankNum + 0x400),
    //     addr, data);
  }
}

// TODO - nametable viewer?
// TODO - sprite info viewer?

export class CodeDataLogger extends Component {
  constructor(main, file) {
    super();
    this.main = main;
    this.file = file;
    this.element.classList.add('cdl');
    this.write = child(this.element, 'div');
    link(this.write, '[write]', () => this.doWrite());
    text(this.write, ' ');
    link(this.write, '[disassemble]', () => this.disasm());

    // Make sure there's actually a CDL running...
    let cdl = this.main.nes.debug.cdl;
    if (!cdl) cdl = this.main.nes.debug.cdl = new CodeDataLog(this.main.nes);
    (async () => { // merge if data
      const f = await this.main.fs.open(file);
      if (f && f.data && f.data.byteLength) cdl.merge(f.data);
    })();
  }

  doWrite() {
    const cdl = this.main.nes.debug.cdl;
    this.main.fs.save(this.file, cdl.serialize());
  }

  disasm() {
    const asm = disassemble(this.main.nes.rom.rom, this.main.nes.debug.cdl);
    const asmBytes = Uint8Array.from(new Array(asm.length).fill(0)
                                     .map((_, i) => asm.charCodeAt(i)));
    this.main.fs.download(asmBytes, this.file.replace(/(\.cdl)?$/, '.s'));
  }
}

class MoviePanel extends Component {
  constructor(nes, movie) {
    super();
    this.nes = nes;
    this.movie = movie;
    this.element.classList.add('movie');
    // assume nes.movie is already set.
    this.top = child(this.element, 'div');
    const middle = child(this.element, 'div');

    this.status = child(this.top, 'span');

    text(middle, 'Keyframes: ');
    this.keyframeStatus = child(middle, 'span');
    link(middle, '|<', () => this.selectKeyframe(0));
    text(middle, ' ');
    link(middle, '<', () => this.selectKeyframe(this.currentKeyframe - 1));
    text(middle, ' ');
    link(middle, 'o', () => this.trackingKeyframe = true);
    text(middle, ' ');
    link(middle, '>', () => this.selectKeyframe(this.currentKeyframe + 1));
    text(middle, ' ');
    link(middle, '>|', () => this.selectKeyframe(this.keyframes.length));
    text(middle, ' ');
    link(middle, '[seek]', () => this.seekToKeyframe());

    this.keyframeSnapshot = child(this.element, 'img');
    this.keyframeSnapshot.height = '120';

    this.keyframes = this.movie.keyframes();
    this.currentKeyframe = 0;
    this.trackingKeyframe = true;
    this.closed().then(() => {
      this.movie.stop();
      this.nes.movie = null;
    });

    this.updateKeyframe();
    this.frame();

    this.registerKey('w', 'Seek', () => this.seekToKeyframe());
    this.registerKey('[', 'Previous Keyframe',
                     () => this.selectKeyframe(this.currentKeyframe - 1));
    this.registerKey(']', 'Next Keyframe',
                     () => this.selectKeyframe(this.currentKeyframe + 1));
  }

  areKeyframesStale() {} // abstract: returns true if we need to recache

  isActive() {} // abstract: returns whether we're stopped or not

  updateStatus() {} // abstract: returns status text

  frame() {
    // update
    let updateKeyframe = false;
    if (this.areKeyframesStale()) {
      this.keyframes = this.movie.keyframes();
      // which keyframe are we on?
      this.currentKeyframe = 0;
      this.trackingKeyframe = true;
      updateKeyframe = true;
    }
    if (!this.isActive()) { // ???
      this.status.textContent = 'Stopped';
      return;
    }
    const frame = this.movie.frame();
    while (this.trackingKeyframe &&
           this.currentKeyframe < this.keyframes.length - 1 &&
           this.keyframes[this.currentKeyframe + 1].position <= frame) {
      this.currentKeyframe++;
      updateKeyframe = true;
    }
    this.status.textContent = this.updateStatus();
    if (updateKeyframe) this.updateKeyframe();
  }

  updateKeyframe() {
    const kf = this.currentKeyframe;
    const kft = this.keyframes.length;
    this.keyframeStatus.textContent =
        `${String(kf + 1).padStart(String(kft).length, 0)} / ${kft}`;
    if (!kft) return;
    this.keyframeSnapshot.src = this.keyframes[kf].imageDataUrl();
    const frame = this.movie.frame();
    this.trackingKeyframe =
        kf >= kft - 1 ||
            (this.keyframes[kf].position <= frame &&
             this.keyframes[kf + 1].position > frame);
  }

  startRecording() {
    throw new Error('not implemented');
    this.frame();
  }

  seekToKeyframe() {
    this.movie.seek(this.keyframes[this.currentKeyframe]);
    this.trackingKeyframe = true;
    this.frame();
  }

  selectKeyframe(target) {
    this.currentKeyframe = Math.max(0, Math.min(target, this.keyframes.length - 1));
    this.updateKeyframe();
    this.frame();
  }
}

// while playing pack:
//   Playing 5 / 200 (2.5%) [record] [stop]
//   Keyframes: 1 / 20 [seek]
//     [<] [img] [>]    -- plus keyboard???
export class PlaybackPanel extends MoviePanel {
  constructor(nes) {
    super(nes, nes.movie);

    text(this.top, ' ');
    link(this.top, '[record]', () => this.startRecording());
    text(this.top, ' ');
    link(this.top, '[stop]', () => this.stopPlayback());
  }

  areKeyframesStale() {
    if (this.nes.movie != this.movie) {
      // changed the playback on us - refresh keyframes, etc
      this.movie = this.nes.movie;
      return true;
    }
    return false;
  }

  isActive() {
    return this.movie.playing;
  }

  updateStatus() {
    const frame = this.movie.frame();
    const total = this.movie.totalFrames();
    const percent = (100 * frame / total).toFixed(2);
    return `Playing ${frame} / ${total} ${percent}%`;
  }

  startRecording() {
    throw new Error('not implemented');
    this.frame();
  }

  stopPlayback() {
    this.movie.stop();
    this.frame();
    // TODO - null out nes.playback?
  }
}


// while recording
//   Recorded 5 frames [save] [cancel]
//   Keyframes: 1 / 20 [seek]
//     [<] [img] [>]    -- plus keyboard???
export class RecordPanel extends MoviePanel {
  constructor(main, filename) {
    super(main.nes, main.nes.movie);
    this.fs = main.fs;
    this.filename = filename;

    text(this.top, ' ');
    this.startButton = link(this.top, '[start]', () => this.start());
    this.saveButton = link(this.top, '[save]', () => this.save());
    text(this.top, ' ');
    link(this.top, '[cancel]', () => this.cancel());
    this.saveButton.style.display = 'none';

    this.registerKey('q', 'Save New Keyframe',
                     () => this.movie.keyframe(this.nes.writeSavestate()));
  }

  areKeyframesStale() {
    if (this.nes.movie != this.movie) {
      // changed the playback on us - refresh keyframes, etc
      this.movie = this.nes.movie;
      return true;
    }
    return this.movie.isLastKeyframeStale(
        this.keyframes[this.keyframes.length - 1]);
  }

  isActive() {
    return this.movie.recording;
  }

  updateStatus() {
    return `Recorded ${this.movie.frame()} frames`;
  }

  start() {
    this.movie.start();
    this.movie.keyframe(this.nes.writeSavestate());
    this.saveButton.style.display = 'inline';
    this.startButton.style.display = 'none';
  }

  seekToKeyframe() {
    super.seekToKeyframe(); // starts recording automatically!
    this.saveButton.style.display = 'inline';
    this.startButton.style.display = 'none';
  }    

  async save() {
    this.fs.save(this.filename, this.movie.save());
  }

  cancel() {
    this.movie.stop();
    // TODO - take a final snapshot so we can resume later?
  }
}

// [q]: Save [w]: Restore
// [<] # [>]   -- plus keyboard
export class SnapshotPanel extends Component {
  constructor(main) {
    super();
    this.nes = nes;
    this.main = main;
    this.fs = main.fs
    this.index = 0;
    this.element.classList.add('snapshot');
    const top = child(this.element, 'div');
    link(top, '[save]', () => this.save(this.index));
    text(top, ' ');
    link(top, '[load]', () => this.load(this.index));

    const middle = child(this.element, 'div');
    text(middle, 'Slot: ');
    link(middle, '<', () => this.selectIndex((this.index + 9) % 10));
    text(middle, ' ');
    this.indexSpan = child(middle, 'span');
    text(middle, ' ');
    link(middle, '>', () => this.selectIndex((this.index + 1) % 10));

    this.thumbnail = child(this.element, 'img');
    this.thumbnail.height = '120';

    this.registerKey('q', 'Save', () => this.save());
    this.registerKey('w', 'Load', () => this.load());
    this.registerKey('[', 'Previous Slot',
                     () => this.selectIndex((this.index + 9) % 10));
    this.registerKey(']', 'Next Slot',
                     () => this.selectIndex((this.index + 1) % 10));
    
    this.selectIndex(0);
  }

  get base() {
    const base = this.main.romName || 'rom.nes';
    return base.replace(/\.nes$/, '');
  }

  async selectIndex(i) {
    this.indexSpan.textContent = this.index = i;
    const fn = this.base + '.st' + i;
    const file = await this.fs.open(fn);
    if (file) {
      const state = Savestate.parse(file.data, 'NES-STA\x1a');
      const screen = state && state.screen;
      if (screen) {
        const url =
            'data:image/png;base64,' + btoa(String.fromCharCode(...screen));
        this.thumbnail.src = url;
        this.thumbnail.style.visibility = 'visible';
        return;
      }
    }
    this.thumbnail.style.visibility = 'hidden';
  }

  async save() {
    const buffer = this.nes.writeSavestate();
    const fn = this.base + '.st' + this.index;
    await this.fs.save(fn, buffer);
    this.selectIndex(this.index);
  }

  async load() {
    const fn = this.base + '.st' + this.index;
    const file = await this.fs.open(fn);
    if (!file) return;
    this.nes.restoreSavestate(file.data);
  }
}

export class NametableTextViewer extends WatchGroup {
  constructor(nes) {
    super();
    this.nes = nes;
    this.element.classList.add('nametable-text');
    const head = child(this.element, 'div');
    text(head, '   ' + new Array(64).fill(0)
         .map((_, i) => i.toString(16).padStart(2, 0)).join(' '));
    for (let y = 0; y < 64; y++) {
      if ((y & 0x1e) == 0x1e) continue;
      const row = child(this.element, 'div');
      text(row, `${y.toString(16).padStart(2, 0)}`);
      for (let x = 0; x < 64; x++) {
        const watch = new NametableWatch(nes, (y >>> 4 & 2) | (x >>> 5), y & 0x1f, x & 0x1f);
        row.appendChild(watch.element);
        if (x == 31) watch.element.classList.add('table-right');
        // TODO - consider adding a click handler to display the 8x8 tile in the top left?
        //      - with attributes?
        // watch.element.addEventListener(
        //     'click', () => watch.element.classList.toggle('highlight'));
        this.watches.push(watch);
      }
      if (y == 29) row.classList.add('table-bottom');
    }
  }

  update(...args) {
    super.update(...args);
    // also update the scanline
    const scan = this.nes.ppu.scanline;
    const rows = [...this.element.children].slice(1);
    for (let i = 0; i < rows.length; i++) {
      rows[i].classList.remove('scan');
      if (scan > 20 && scan < 261 &&
          i == (this.nes.ppu.cntV ? 30 : 0) + this.nes.ppu.cntVT) {
        rows[i].classList.add('scan');
      }
    }
  }

  formatValue(v) {
    return ' ' + v.toString(16).padStart(2, 0);
  }
}

class NametableWatch extends Watch {
  constructor(nes, table, y, x) {
    super(() => nes.ppu.nametables[table][y << 5 | x]);   
    this.nes = nes;
    this.table = table;
    this.y = y;
    this.x = x;
  }

  update(...args) {
    super.update(...args);
    // handle classes for scroll
    this.element.classList.remove('top', 'bottom', 'left', 'right');
    // look for left/right border - ignore fine scroll for now
    const sameH = !(this.table & 1) == !this.nes.ppu.regH;
    const sameV = !(this.table & 2) == !this.nes.ppu.regV;
    // TODO - if fine scroll is 0 then don't add the extra line.
    if (this.x == this.nes.ppu.regHT &&
        (sameV ? this.y >= this.nes.ppu.regVT : this.y <= this.nes.ppu.regVT)) {
      this.element.classList.add(sameH ? 'left' : 'right');
    }
    if (this.y == this.nes.ppu.regVT &&
        (sameH ? this.x >= this.nes.ppu.regHT : this.x <= this.nes.ppu.regHT)) {
      this.element.classList.add(sameV ? 'top' : 'bottom');      
    }
  }
}

export class ControllerPanel extends Component {
  constructor(nes) {
    super();
    this.nes = nes;
    const e = this.element;
    e.classList.add('controller');
    this.buttons = [];    
    for (let c = 1; c <= 2; c++) {
      const title = child(e, 'div');
      text(title, `Controller ${c}:`);
      const main = child(e, 'div');
      for (const [l, b] of BUTTONS) {
        const sp = child(main, 'span', 'button');
        sp.dataset['c'] = c;
        sp.dataset['b'] = b;
        this.buttons.push(sp);
        text(sp, l);
      }
    }
    const handle = ({type, target}) => {
      if (!target.classList.contains('button')) return;
      const c = Number(target.dataset['c']);
      const b = Number(target.dataset['b']);
      if (type == 'mousedown') this.nes.buttonDown(c, b);
      if (type == 'mouseup') this.nes.buttonUp(c, b);
      this.frame();
    };
    e.addEventListener('mousedown', handle);
    e.addEventListener('mouseup', handle);
  }

  frame() {
    for (const button of this.buttons) {
      const c = Number(button.dataset['c']);
      const b = Number(button.dataset['b']);
      button.classList.toggle('pressed', this.nes.controllers[c].state[b] & 1);
    }
  }
}

const BUTTONS = [
  ['<', Controller.BUTTON_LEFT],
  ['^', Controller.BUTTON_UP],
  ['v', Controller.BUTTON_DOWN],
  ['>', Controller.BUTTON_RIGHT],
  ['sel', Controller.BUTTON_SELECT],
  ['st', Controller.BUTTON_START],
  ['B', Controller.BUTTON_B],
  ['A', Controller.BUTTON_A],
];

export class TimerPanel extends Component {
  constructor() {
    super();
    this.started = 0;
    this.registerKey('1', 'Start', () => this.start());
    this.registerKey('2', 'Pause', () => this.pause());
    this.registerKey('3', 'Stop', () => this.stop());
    this.frame();
  }

  start() {
    if (this.started > 0) return;
    this.started = new Date().getTime();
  }

  pause() {
    if (this.started > 0) {
      this.started -= new Date().getTime();
    } else {
      this.started += new Date().getTime();
    }
  }

  stop() {
    if (this.started > 0) {
      this.pause();
    } else {
      this.started = 0;
    }
  }

  time() {
    function pad(x, n) { return String(x).padStart(n, '0'); }
    let delta = new Date().getTime() - this.started;
    const ms = delta % 1000;
    delta = (delta - ms) / 1000;
    const s = delta % 60;
    delta = (delta - s) / 60;
    const m = delta % 60;
    delta = (delta - m) / 60;
    const h = delta;
    if (h) {
      return `${h}:${pad(m, 2)}:${pad(s, 2)}.${pad(ms, 3)}`;
    } else if (m) {
      return `${m}:${pad(s, 2)}.${pad(ms, 3)}`;
    }
    return `${s}.${pad(ms, 3)}`;
  }

  frame() {
    if (this.started > 0) {
      this.element.textContent = this.time();
    } else if (this.started === 0) {
      this.element.textContent = '0.000';
    }
  }
}

export class CoveragePanel extends Component {
  constructor(nes) {
    super();
    this.nes = nes;
    this.element.classList.add('coverage');
    const top = child(this.element, 'div');
    text(top, 'Type: ');
    this.type = 'x';
    this.typeSpan = child(top, 'span');
    this.typeSpan.textContent = 'exec';
    text(top, ' ');
    link(top, '[x]', () => this.setType('x', 'exec'));
    text(top, ' ');
    link(top, '[r]', () => this.setType('r', 'read'));
    text(top, ' ');
    link(top, '[w]', () => this.setType('w', 'write'));
    this.assertions = 0;

    const mid = child(this.element, 'div');
    text(mid, 'Results: ');
    link(mid, '[reset]', () => this.reset());
    this.results = child(this.element, 'div');

    this.registerKey('c', 'Assert Covered', () => this.assertCovered());
    this.registerKey('u', 'Assert Uncovered', () => this.assertUncovered());
    this.update();
  }

  reset() {
    this.assertions = 0;
    this.nes.debug.coverage.clear();
    this.update();
  }

  setType(type, text) {
    this.type = type;
    this.typeSpan.textContent = text;
    this.update();
  }

  assertCovered() {
    this.assertions |= 1;
    this.nes.debug.coverage.expectCovered();
    this.update();
  }

  assertUncovered() {
    this.assertions |= 2;
    this.nes.debug.coverage.expectUncovered();
    this.update();
  }

  update() {
    if (this.assertions !== 3) {
      this.results.textContent = '  c: assert covered\n  u: assert uncovered';
      return;
    }
    const results = this.nes.debug.coverage.candidates(this.type, true);
    if (typeof results === 'string') {
      this.results.textContent =
          '  PRG ' + results.replace(/,\s*/g, '\n  PRG ');
      return;
    }
    // it's an object - format the lines.
    const lines = [];
    for (const key in results) {
      lines.push(`  ${key}: $${results[key].toString(16).padStart(2, '0')}`);
    }
    this.results.textContent = lines.join('\n');
  }

  async selectIndex(i) {
    this.indexSpan.textContent = this.index = i;
    const fn = this.base + '.st' + i;
    const file = await this.fs.open(fn);
    if (file) {
      const state = Savestate.parse(file.data, 'NES-STA\x1a');
      const screen = state && state.screen;
      if (screen) {
        const url =
            'data:image/png;base64,' + btoa(String.fromCharCode(...screen));
        this.thumbnail.src = url;
        this.thumbnail.style.visibility = 'visible';
        return;
      }
    }
    this.thumbnail.style.visibility = 'hidden';
  }

  async save() {
    const buffer = this.nes.writeSavestate();
    const fn = this.base + '.st' + this.index;
    await this.fs.save(fn, buffer);
    this.selectIndex(this.index);
  }

  async load() {
    const fn = this.base + '.st' + this.index;
    const file = await this.fs.open(fn);
    if (!file) return;
    this.nes.restoreSavestate(file.data);
  }
}

export class KeysPanel extends Component {
  constructor() {
    super();
    this.element.classList.add('help');
    const line = (text) => {
      child(this.element, 'div').textContent = text;
    }
    line('General:');
    line('  arrows - Dpad');
    line('  z - B button');
    line('  x - A button');
    line('  ctrl - Select button');
    line('  enter - Start button');
    line('  p - Play/Pause');
    line('  m - Toggle music');
    line('  ` - Fast forward');
    line('  ~ - Toggle fast forward');
    line('Save states:');
    line('  q - Save');
    line('  w - Load');
    line('  [ ] - Change slot');
    line('Movie:');
    line('  q - Set a keyframe (record only)');
    line('  w - Seek to keyframe');
    line('  [ ] - Change keyframe');
    line('Timer:');
    line('  1 - Start');
    line('  2 - Pause/resume');
    line('  3 - Stop/reset');
    line('Trace:');
    line('  f - Advance 1 frame');
    line('  g - Advance 1 instruction');
    line('  t - Advance 8 scanlines');
    line('  o - Step out of routine');
  }
}

export class WindowsPanel extends Component {
  constructor() {
    super();
    this.element.classList.add('help');
    const line = (text) => {
      child(this.element, 'div').textContent = text;
    }
    line('General:');
    line('  x - Close panel');
    line('  \u25a1 - Move panel to front');
    line('File selection:');
    line('  ^ - Pick a file from disk');
    line('  + - Type a filename');
    line('  v - Download file to disk');
    line('  x - Delete file');
    line('Trace:');
    line('  >> - Advance 128 instructions');
    line('  > - Advance 1 instruction');
    line('  ^ - Load more history');
    line('  o - Clear the log');
  }
}
