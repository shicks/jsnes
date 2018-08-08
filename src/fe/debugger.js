// Debugging tools

const child = (parent, type, ...classes) => {
  const e = document.createElement(type);
  parent.appendChild(e);
  for (const c of classes) {
    e.classList.add(c);
  }
  return e;
};

const text = (parent, text) => {
  const n = document.createTextNode(text);
  parent.appendChild(n);
};

// Format a hex number
export const fmt = (x, p) => `$${x.toString(16).padStart(p, 0)}`;

// A component of the grid.  Handles drag-and-drop rearrangement, closing, etc.
export class Component {
  constructor() {
    this.outer = child(document.getElementById('grid'), 'div', 'component');
    this.corner = child(this.outer, 'div', 'corner');
    this.addCornerButton('x', () => this.outer.remove());
    Component.map.set(this.outer, this);
    this.element = child(this.outer, 'div');
  }

  addCornerButton(text, handler) {
    const button = child(this.corner, 'div');
    button.textContent = text;
    button.addEventListener('click', handler);
  }

  remove() { this.element.remove(); }

  // Returns a string representation of this component's state, to be merged
  // into the URL fragment.
  getState() { return ''; }
  // Sets the state of this component from a URL fragment.  May assume presence
  // of localstorage, etc.
  setState(state) {}

  // Abstract update method called on each frame.
  frame() {}

  // Update method for stepping execution - defaults to same as frame.
  // This runs every time the CPU breaks.
  step() { this.frame(); }
}

// Map from elements to components.
Component.map = new WeakMap();

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
