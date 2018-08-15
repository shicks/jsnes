// Debugging tools
import {child, text, link, fmt} from './utils.js';
import {Component} from './component.js';

// A single watched memory location or expression.
export class Watch {
  constructor(expression, format = (x) => fmt(x, 2)) {
    this.expression = expression;
    this.element = document.createElement('span');
    this.element.classList.add('value');
    this.value = -1;
    this.red = 0;
  }

  update(format = (x) => fmt(x, 2), dim = 2) {
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
    return new Watch(() => nes.cpu.mem[address]);
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
    this.palIndex = [-1, -1];
    this.vram = this.nes.ppu.vramMem;
    this.canvas.addEventListener('click', (e) => this.click(e));
  }

  click(e) {
    if (e.offsetY < 145) return;
    let x = e.offsetX;
    const table = x < 146 ? 0 : 1;
    if (table) x -= 145;
    const index = Math.floor(x / 33);
    if (this.palIndex[table] == index) {
      this.palIndex[table] = -1;
    } else {
      this.palIndex[table] = index;
    }
    this.frame();
  }

  getTile(table, row, col, tileRow, colors) {
    const addr = (table << 12) | (row << 8) | (col << 4) | tileRow;
    this.getTileInternal(this.vram, addr, colors);
  }

  getTileInternal(ram, addr, colors) {
    let upper = ram[addr | 8];
    let lower = ram[addr];
    for (let bit = 7; bit >= 0; bit--) {
      colors[bit] = this.palette[((upper & 1) << 1) | (lower & 1)];
      upper >>>= 1;
      lower >>>= 1;
    }
  }

  frame() {
    // Update the image data.
    const tile = [0, 0, 0, 0, 0, 0, 0, 0];
    for (let table = 0; table < 2; table++) {

      // Select the palette
      const p = table ? this.nes.ppu.imgPalette : this.nes.ppu.sprPalette;
      if (this.palIndex[table] < 0) {
        this.palette = [
          0x000000,
          0xffffff,
          0xaaaaaa,
          0x555555,
        ];
      } else {
        this.palette = p.slice(4 * this.palIndex[table]).slice(0, 4);
      }
      this.palette = this.palette.map(x => (x | 0xff000000) >>> 0);

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
            const i = pal * 4 + row * 2 + col;
            const c =
                ((p[i] & 0xff) << 16) |
                (p[i] & 0xff00) |
                ((p[i] & 0xff0000) >> 16);
            this.context.fillStyle = `#${c.toString(16).padStart(6,0)}`;
            this.context.fillRect(x1 + col * 16, y1, 16, 16);
          }
        }
        if (pal == this.palIndex[table]) {
          this.context.strokeStyle = '#ff0000';
          this.context.strokeRect(x1 + 1, y0 + 1, 30, 30);
        }
      }
    }

    this.imageData.data.set(this.buf8);
    this.context.putImageData(this.imageData, 0, 0);
  }
}

export class ChrRomViewer extends PatternTableViewer {
  
  // views 1k pages
  constructor(nes, pages) {
    super(nes);
    this.pages = pages;
  }

  getTile(table, row, col, tileRow, data) {
    // support up to 8 different pages
    const bankIndex = (table << 2) | (row >>> 2);
    if (bankIndex >= this.pages.length) {
      for (let i = 0; i < 8; i++) data[i] = 0xffffff;
      return;
    }

    const bank = this.pages[bankIndex];
    const bankNum = bank >>> 2;
    const addr = (bank % 4) << 10 | ((row & 3) << 8) | (col << 4) | tileRow;
    this.getTileInternal(this.nes.rom.vrom[bankNum], addr, data);
  }
}

// TODO - nametable viewer?
// TODO - sprite info viewer?

export class RecordingPane extends Component {
  constructor(main) {
    super();
    this.fs = main.fs;
    this.recording = main.nes.debug.recording;
    this.element.classList.add('recordings');
    const top = child(this.element, 'div');
    link(top, 'open', () => this.open());
    text(top, ' ');
    link(top, 'save', () => this.save());
    text(top, ' ');
    link(top, 'reset', () => main.nes.cpu.softReset());
    this.name = child(this.element, 'input');
    this.name.type = 'text';
    const middle = child(this.element, 'div');
    this.status = child(middle, 'span');
    text(middle, ' ');
    this.position = child(middle, 'span');
    const bottom = child(this.element, 'div');
    link(bottom, 'play', () => this.play());
    text(bottom, ' ');
    link(bottom, 'record', () => this.record());
    text(bottom, ' ');
    link(bottom, 'stop', () => this.stop());
  }

  async open() {
    const picked = await this.fs.pick('Select movie');
    this.name.value = picked.name;
    this.recording.loadFile(picked.data);
    this.frame();
  }

  save() {
    this.fs.save(this.name.value, this.recording.saveFile());
  }

  play() {
    this.recording.startPlayback();
    this.status.textContent = 'playing';
    this.frame();
  }

  record() {
    this.recording.startRecording();
    this.status.textContent = 'recording';
    this.frame();
  }

  stop() {
    this.recording.stop();
    this.status.textContent = 'stopped';
    this.frame();
  }

  frame() {
    if (this.status.textContent == 'playing') {
      const fraction = this.recording.index / this.recording.buffer.length;
      this.position.textContent = `${(100 * fraction).toFixed(2)}%`;
    } else {
      this.position.textContent = `${this.recording.index} bytes`;
    }      
  }
}
