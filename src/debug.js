// TODO - more pluggable debug framework
//  - provide a few hooks via properties on nes:
//    * logCpu, logMem, logPpu, logBank, ...
//  - default to null, but otherwise is an array of functions
//    - when attaching a function, returns a deregister handler?
//      or possibly accept a promise, unregister when resolved?
//  - make it easy to plug in a DOM-based logger as well...
//    - possibly one that can be triggered by a keypress?
//  - don't incur costs for loggers we don't care about...
//  - watch memory, record set of values, set of write addrs, etc
//  - record and (fast) replay input sequences?

// Debug logging

// ROM address is 16 bits, but only 13 are meaningful
// Bank index is up to 8 more bits

// Log format:
// Selector:
//   lowest 2 bits indicate what type of message it is:
//     00 skip  -- use 256-byte blocks, never cross so skip when needed
//     01 cpu
//     10 mem
//     11 other
//   next 6 bits are other flags, dependent on the type
// CPU instruction:
//   [00000p01] [ opcode ] [ pclow  ] [ pchigh ] [ page?  ]
//   p = PC is paged, enables 5th byte
//   // ss = number of bytes in instruction (1-3)
//   opcode = opcode executed
//   pc = address opcode was read from (little endian)
//   page = optional page index (if p == 1)
// Memory:
//   [00wrsp10] [ addrlo ] [ addrhi ] [ page?  ] [ read?  ] [readhi? ] [ write? ]
//   p = address was paged, enables page? byte
//   s = 16-bit read, enables valhi? byte
//   r = whether this is a read
//   w = whether this is a write
//   addr = address read from
//   page = page index (if p == 1)
//   read = low 8 bits of read value (r == 1)
//   readhi = upper 8 bits, if a 16-bit read (r == 1, s == 1)
//   write = written value (if w == 1)
// Other:
//   [00000111] ==> start vblank
//   [00000011] ==> end vblank

//  ---- log bank changes, cpu args - print actual along w/ rom addr
//    ---- accumulator?!?


// TODO - consider storing additional info for mem?
//   - e.g. purpose of read?  code/data/indirect?
//   - then possible get rid of CPU op, just use "code" read as opcode,
//     reconstruct from there?!? but that's kind of a pain
// ?jcwrrp0
//   - rr = # of bytes read, w = written  - [001, 010, 011, 100, 101]
//   - c = read as code - otherwise = as data
//   - j = read as indirect address? - code ptr vs data ptr?
//   more compact to pack multiple bytes in (rather than repeating 3 bytes for addr
//   when only diff by 1 each) but harder to write at the correct time,
//   and unable to nuance indirect reads as well (but do we care?)
// could just keep the cpu logs but annotate indirect reads for addr mode?
//  - esp because they may come before the actual cpu log?


//const BYTES_BY_MODE = [2, 2, 1, 3, 1, 2, 2, 2, 3, 3, 2, 3, 3];

export class Debug {
  constructor(nes, size = 0x4000000) { // default to 64MB
    size &= ~0xff; // size must be a multiple of 256
    this.nes = nes;
    // trace buffer
    this.buffer = new Uint8Array(size);
    this.size = size;
    this.pos = 0;
    this.resets = 0;
    this.waits = {};
    this.waiting = false;
    // ---
    this.watches = {}; // {[addr]: {[break_#]: function()}}
    this.breakpoints = new Uint8Array(0x10000);
    this.coverage = new Debug.Coverage(this.nes);
    this.breakIf = () => true,
    this.breakIn = null;
    this.breakAtVBlank = false;
    this.break = false;
    this.mt = new Debug.MemTracker(this.nes);
  }

  growBreakpoints_(addr) {
    const size = 1 << (32-Math.clz32(addr))
    const newBreakpoints = new Uint8Array(size);
    if (this.breakpoints) newBreakpoints.set(this.breakpoints);
    this.breakpoints = newBreakpoints;
  }

  /**
   * @param {number|!Array<number>} addr Address or range [start, end]
   * @param {string} mem One of 'prg' or 'ram'
   * @param {string} modes A string made of 'r', 'w', and/or 'x'
   */
  breakAt(addr, mem, modes) {
    if (!(addr instanceof Array)) {
      addr = [addr, addr];
    }
    if (!this.breakpoints || addr[1] >= this.breakpoints.length) {
      this.growBreakpoints_(addr[1]);
    }
    let mask = 0;
    for (const mode of modes) {
      mask |= BREAKPOINT_MODES[mem + '-' + mode];
      if (mask != mask) throw new Error(`Bad mode ${mode} on ${mem}`);
    }
    for (let i = addr[0]; i <= addr[1]; i++) {
      this.breakpoints[i] |= mask;
    }
  }

  logCpu(opcode, pc) {
    const bank = this.nes.banks[pc >>> 13];
    const addr =
        bank != null ? (bank << 13) | (pc & 0x1fff) : pc < 0x2000 ? pc & 0x7ff : pc;
    this.coverage.cov[addr] |= (bank != null ? BREAK_PRG_X : BREAK_RAM_X);
if(this.watches && addr in this.watches){
const watch = this.watches[addr][bank != null ? BREAK_PRG_X : BREAK_RAM_X];
if(watch)watch();
}
//if(bank==0x1e&&(pc&0x1ffd)==0x900)return; // blackbox
    const len = 4 + (bank != null)
    // pad up to the next block if necessary
    while ((this.pos + len ^ this.pos) & 0x100) this.buffer[this.pos++] = 0;
    if (this.pos == this.size) {this.resets++; this.pos = 0;}
    this.buffer[this.pos++] = 1 | (bank != null ? PAGED : 0);
    this.buffer[this.pos++] = opcode;
    this.buffer[this.pos++] = pc;
    this.buffer[this.pos++] = pc >>> 8;
    if (bank != null) this.buffer[this.pos++] = bank;

    if (this.breakpoints) {
      if ((this.breakpoints[addr] & (bank != null ? BREAK_PRG_X : BREAK_RAM_X))
         && this.breakIf(pc, 'x', opcode)) {
        console.log(`break on execute ${bank ? 'PRG' : 'RAM'} $${addr.toString(16)}`)
        this.break = true;
      }
    }
    if (this.breakIn != null && --this.breakIn == 0) {
      this.breakIn = null;
      this.break = true;
    }
    // TODO - optionally store registers (add a bit to the selector to indicate
    // that 4 extra bytes are being stored - a, x, y, f); could also optionally
    // store the arguments, particularly if we're in RAM...
  }

  logMem(op, address, value, write = -1) {
    const bank = op & MEM_READ ? this.nes.banks[address >>> 13] : null;
    const addr =
        bank != null ? (bank << 13) | (address & 0x1fff) :
            address < 0x2000 ? address & 0x7ff : address;
    this.coverage.cov[addr] |= (bank != null ? BREAK_PRG_R :
                                (op & MEM_READ ? BREAK_RAM_R : 0) |
                                (op & MEM_WRITE ? BREAK_RAM_W : 0));
if(this.watches && addr in this.watches){
const w = this.watches[addr];
const wr = bank != null ? w[BREAK_PRG_R] : op & MEM_READ ? w[BREAK_RAM_R] : null;
const ww = op & MEM_WRITE ? w[BREAK_RAM_W] : null;
if(wr)wr(value);
if(ww)ww(write == -1 ? value : write);
}
//if(bank==null&&address==9)return; // blackbox
    if (bank != null) op |= PAGED;
    const len = LEN_BY_OP[op];
    if (len == 0) {
      console.log('Bad memory log: ' + op + ' at ' + address.toString(16));
      return;
    }
    while ((this.pos + len ^ this.pos) & 0x100) this.buffer[this.pos++] = 0;
    if (this.pos == this.size) {this.resets++; this.pos = 0;}
    this.buffer[this.pos++] = op;
    this.buffer[this.pos++] = address;
    this.buffer[this.pos++] = address >>> 8;
    if (op & PAGED) this.buffer[this.pos++] = bank;
    this.buffer[this.pos++] = value;
    if (op & MEM_WORD) this.buffer[this.pos++] = value >>> 8;
    if (write >= 0) this.buffer[this.pos++] = write;

    if (this.breakpoints) {
      const mask = bank != null ? BREAK_PRG_R : (op >> 4) & 3;
      if ((this.breakpoints[addr] & mask)
          && this.breakIf(address, op & MEM_READ ? 'r' : 'w', value)) {
        console.log(`break on ${op & MEM_READ ? 'read' : 'write'
                     } ${bank ? 'PRG' : 'RAM'} $${addr.toString(16)}`);
        this.break = true;
      } else if ((op & MEM_WORD) && (this.breakpoints[addr + 1] & mask)
                && this.breakIf(address, 'r', value)) {
        console.log(`break on read ${bank ? 'PRG' : 'RAM'
                     } $${(addr + 1).toString(16)}`);
        this.break = true;
      }
    }


// if(address == 0x3c1 && (op & MEM_WRITE)) {
// this.break = true;
// console.log(`break on write ${address} <- ${value}`);
// }
  }

  logScanline(line, frame) {
    if (line == 0) { // start vblank
      while ((this.pos + 3 ^ this.pos) & 0x100) this.buffer[this.pos++] = 0;
      if (this.pos == this.size) {this.resets++; this.pos = 0;}
      this.buffer[this.pos++] = Debug.VBLANK;
      this.buffer[this.pos++] = frame;
      this.buffer[this.pos++] = frame >> 8;
      if (this.breakAtVBlank) {
        this.break = true;
        this.breakAtVBlank = false;
      }
    } else if (line > 20) {
      while ((this.pos + 2 ^ this.pos) & 0x100) this.buffer[this.pos++] = 0;
      if (this.pos == this.size) {this.resets++; this.pos = 0;}
      this.buffer[this.pos++] = Debug.SCANLINE;
      this.buffer[this.pos++] = line - 21;
    }
  }

  logInterrupt(type) {
    // TODO - look for patterns of repeated CPU configurations to elide in the future
    // Then just log the interrupt.
    // Trick: we want to filter out scanline entries.
  }

  // logOther(op) {
  //   if (this.pos == this.size) {console.log('reset log'); this.pos = 0;}
  //   this.buffer[this.pos++] = op;
  // }

  /**
   * Returns a valid TracePosition.  If an argument is given, clamps it to the
   * available range.  Otherwise returns the current position.
   */
  tracePosition(arg = undefined) {
    if (!arg) return new TracePosition(this.size, this.resets, this.pos);
    if (arg.resets == this.resets) return arg;
    return new TracePosition(
        this.size,
        this.resets - 1,
        Math.max((this.pos + 0x100) & ~0xff, arg.pos));
  }

  /**
   * @param {function(opcode, pc, pcrom)=} cpu
   * @param {function(addr, addrrom, read?, written?)=} mem
   * @param {function(num)=} scanline
   * @param {!TracePosition=} start
   * @param {!TracePosition=} end
   */
  visitLog({cpu, mem, scanline} = {}, start = undefined, end = undefined) {
    end = this.tracePosition(end instanceof TracePosition ? end : end || 0);
    start =
        this.tracePosition(
            start instanceof TracePosition ? start : end.previous(start || 10));
    let pos = start.pos;
    let resets = start.resets;

    while (resets < end.resets || pos < end.pos) {
      if (pos == this.size) {
        pos = 0;
        resets++;
      }
      const selector = this.buffer[pos++];
      switch (selector & 3) {
      case 0: // skip
        continue;
      case 1: { // cpu
        const op = this.buffer[pos++];
        const addr = this.buffer[pos++] | (this.buffer[pos++] << 8);
        const romaddr =
            selector & PAGED ? (addr & 0x1fff) | (this.buffer[pos++] << 13) : null;
        cpu && cpu(op, addr, romaddr);
        break;
      }
      case 2: { // mem
        const addr = this.buffer[pos++] | (this.buffer[pos++] << 8);
        const romaddr =
            selector & PAGED ? (addr & 0x1fff) | (this.buffer[pos++] << 13) : null;
        const read =
            selector & MEM_READ ?
                this.buffer[pos++] |
                    (selector & MEM_WORD ? this.buffer[pos++] << 8 : 0) :
                undefined;
        const write = selector & MEM_WRITE ? this.buffer[pos++] : undefined;
        mem && mem(addr, romaddr, read, write);
        break;
      }
      case 3: { // other
        if (selector == Debug.VBLANK) {
          const frame = this.buffer[pos++] | (this.buffer[pos++] << 8);
          scanline && scanline(-1, frame);
        } else if (selector == Debug.SCANLINE) {
          scanline && scanline(this.buffer[pos++]);
        }
        break;
      }
      default:
      }
    }
  }

  trace(start = undefined, end = undefined, log = console.log) {
    end = end instanceof TracePosition ? end : tracePosition().previous(end || 0);
    start = start instanceof TracePosition ? start : end.previous(start || 10);
    const parts = [];
    let frame = '????';
    let scanline = '??';
    this.visitLog({
      cpu: (op, addr, romaddr) => {
        // TODO - rewrite this to call formatInstruction
        const opmeta = this.nes.cpu.opmeta;
        const opinf = opmeta.opdata[op];
        const instr = opmeta.instname[opinf & 0xff];
        let pc = (romaddr != null ? romaddr : addr).toString(16);
        pc = ('$' + pc.padStart(4 + (romaddr != null), '0')).padStart(9);
        let bytes = [op];
        let arg = 0;
        let factor = 0;
        if (romaddr != null) { // can't really look up RAM
          for (let i = 0; i < opmeta.addrSize[(opinf >> 8) & 0xff]; i++) {
            romaddr++;
            const a = this.nes.rom.rom[romaddr >> 14][romaddr & 0x3fff];
            bytes.push(a);
            arg += (a << factor);
            factor += 8;
          }
        } else {
          arg = '??'; // don't know ram
        }
        const mode = opmeta.addrFmt[(opinf >> 8) & 0xff](romaddr, arg).padEnd(8);
        bytes = bytes.map(x => x.toString(16).padStart(2, 0));
        while (bytes.length < 3) bytes.push('  ');
        parts.push(`\n ${frame}:${scanline}${pc}: ${bytes.join(' ')} ${instr} ${mode}`);
      },
      mem: (addr, romaddr, read, write) => {
        let a = (romaddr != null ? romaddr : addr).toString(16);
        a = '$' + a.padStart(4 + (romaddr != null), '0');
        if (read != null) parts.push(`  read ${a} -> $${read.toString(16)}`);
        if (write != null) parts.push(`  write ${a} <- $${write.toString(16)}`);
      },
      scanline: (newScanline, newFrame) => {
        if (newFrame != null) frame = newFrame.toString(16).padStart(4, 0);
        scanline = newScanline < 0 ? '-1' : newScanline.toString(16).padStart(2, 0);
      },
      interrupt: (type) => {
        const name = type == Debug.NMI ? 'NMI' : type == Debug.IRQ ? 'IRQ' : 'reset';
        parts.push(`\ninterrupt: ${name}`);
      }
    }, start, end);
    log(parts.join(''));
  }

  nextInstruction() {
    const addr = this.nes.cpu.REG_PC + 1;
    const op = this.nes.cpu.mem[addr];
    return '           $' + addr.toString(16).padStart(5, 0) + ': ' +
        formatInstruction(this.nes, op, addr, (a) => this.nes.cpu.mem[a]);
  }

  patchRom(addr, value) {
    this.nes.rom.rom[addr >>> 14][addr & 0x3fff] = value;
  }

  memTracker() {
    return new Debug.MemTracker(this.nes);
  }

  watch() {
    return new Debug.Watch(this.nes);
  }
}


// Private-constructor marker class...
class TracePosition {
  constructor(size, resets, pos) {
    this.size = size;
    this.resets = resets;
    this.pos = pos;
  }

  previous(count = 1) {
    if (count < 1) return this;
    count = Math.max(0, Math.min(2 * this.size, Math.floor(count - 1)));
    let resets = this.resets;
    let pos = (this.pos - 1) & ~0xff;
    pos -= count * 0x100;
    while (pos < 0) {
      resets++;
      pos += this.size;
    }
    return new TracePosition(this.size, resets, pos);
  }

  distance(that) {
    if (!that) return Infinity;
    return this.pos - that.pos + (this.size) * (this.resets - that.resets);
  }
}


Debug.Coverage = class {
  constructor(nes) {
    this.nes = nes;
    this.cov = new Uint8Array(0x100000); // 1MB
    this.invalid = new Uint8Array(this.cov.length);
  }

  clear() { 
    this.cov.fill(0);
    this.invalid.fill(0);
  }

  expectCovered() {
    let count = 0;
    for (let i = 0; i < this.cov.length; i++) {
      count += !!~(this.invalid[i] |= ~this.cov[i]);
    }
    this.cov.fill(0);
    return count;
  }

  expectUncovered() {
    let count = 0;
    for (let i = 0; i < this.cov.length; i++) {
      count += !!~(this.invalid[i] |= this.cov[i]);
    }
    this.cov.fill(0);
    return count;
  }

  candidates(type) {
    let mask = 0;
    if (type == 'x') mask = BREAK_PRG_X | BREAK_RAM_X;
    else if (type == 'r') mask = BREAK_PRG_R | BREAK_RAM_R;
    else if (type == 'w') mask = BREAK_RAM_W;
    else throw new Error('Bad type: ' + type);
    const candidates = {};
// console.log(`type=${type}, mask=${mask.toString(16)}`);
    for (let i = 0; i < this.cov.length; i++) {
      const valid = ~this.invalid[i] & mask;
// if (i == 0x1c26f)console.log(`invalid=${this.invalid[i].toString(16)}, valid=${valid.toString(16)}`);
      if (valid & 0xf8) {
// if (i == 0x1c26f)console.log('PRG');
        // would be nice to build in a count - could get 4 bits in the coverage
        // we'd need to be careful about wrapping
        const value = type == 'x' ? 1 : this.nes.rom.rom[i >> 14][i & 0x3fff];
        candidates['PRG $' + i.toString(16).padStart(5, 0)] = value;
      }
      if (valid & 0x07) {
// if (i == 0x1c26f)console.log('RAM');
        const value = type == 'x' ? 1 : this.nes.cpu.mem[i < 0x2000 ? i & 0x7ff : i];
        candidates['RAM $' + i.toString(16).padStart(4, 0)] = value;
      }
    }
    return candidates;
  }
}

Debug.MemTracker = class {
  constructor(nes) {
    this.nes = nes;
    this.mem = new Uint8Array(0x8000);
    this.valid = new Uint8Array(0x8000);
  }

  reset() {
    const mem = this.nes.cpu.mem;
    for (let i = 0; i < 0x8000; i++) {
      this.mem[i] = mem[i];
    }
    this.valid.fill(1);
  }

  expectSame() {
    const mem = this.nes.cpu.mem;
    let candidates = 0;
    for (let i = 0; i < 0x8000; i++) {
      if (this.mem[i] != mem[i]) this.valid[i] = 0;
      this.mem[i] = mem[i];
      candidates += this.valid[i];
    }
    return candidates;
  }

  expectDiff() {
    const mem = this.nes.cpu.mem;
    let candidates = 0;
    for (let i = 0; i < 0x8000; i++) {
      if (this.mem[i] == mem[i]) this.valid[i] = 0;
      this.mem[i] = mem[i];
      candidates += this.valid[i];
    }
    return candidates;
  }

  candidates() {
    const c = [];
    for (let i = 0; i < 0x8000; i++) {
      if (this.valid[i]) c.push('$' + i.toString(16).padStart(4,0));
    }
    return c;
  }

  candidatesCurrent() {
    const c = {};
    for (let i = 0; i < 0x8000; i++) {
      if (this.valid[i]) c['$' + i.toString(16).padStart(4,0)] = '$' + this.mem[i].toString(16);
    }
    return c;
  }
};

// TODO - we could check against watches on every write, but that's more
// invasive - instead, we just check each frame or so if anything updated

// TODO - any way to configurably watch PRG page switches?
Debug.Watch = class {
  constructor(nes) {
    this.nes = nes;
  }

  add(addr, type, op, {changed=false, ascii=true, value=null} = {}) {
    // TODO - watch individual bits?
    if (addr instanceof Array && addr.length == 1) addr = addr[0];
    if (!(addr instanceof Array)) addr = [addr, addr];
    const mode = BREAKPOINT_MODES[`${type}-${op}`];
    if (!mode) throw new Error(`Bad mode: '${type}-${op}'`);
    const ws = this.nes.debug.watches || (this.nes.debug.watches = {});
    const fmt = (v, p) => `$${v.toString(16).padStart(p, 0)}${
                           ascii&&p==2&&v>31&&v<127?' ('+String.fromCharCode(v)+')':''}`;
    const read = type == 'ram' ?
          (a) => this.nes.cpu.mem[a < 0x2000 ? a & 0x7ff : a] :
          (a) => this.nes.rom.rom[a >>> 14][a & 0x3fff];
    const pad = type = 'ram' ? 4 : 5;
    const pc = () => {
      const a = this.nes.cpu.REG_PC + 1;
      const bank = this.nes.banks[a >>> 13];
      return bank != null ? fmt(bank << 13 | a & 0x1fff, 5) : fmt(a, 4);
    }
    const scanline = () => `${this.nes.ppu.frame.toString(16).padStart(6,0)}:${
                              this.nes.ppu.scanline < 21 ? -1 :
                                  (this.nes.ppu.scanline - 21).toString(16).padStart(2,0)}`;
    for (let i = addr[0]; i <= addr[1]; i++) {
      const w = ws[i] || (ws[i] = {});
      if (op == 'w') {
        let last = read(i); // for keeping track of changes
        w[mode] = (v) => {
          if (value != null && v != value) return;
          const next = v;
          if (!changed || next != last) {
            console.log(`${scanline()}: Write ${fmt(i, pad)}: ${fmt(last, 2)} -> ${
                           fmt(next, 2)} at ${pc()}`);
          }
          last = next;
        };
      } else if (op == 'r') {
        // TODO(sdh): option for 16-bit reads?
        w[mode] = (v) => {
          if (value != null && v != value) return;
          console.log(`${scanline()}: Read ${fmt(i, pad)}: ${fmt(v, 2)} at ${pc()}`);
        };
      } else {
        w[mode] = () => {
          console.log(
              `${scanline()}: Execute ${fmt(i, pad)}: ${
               formatInstruction(this.nes, read(i), i, read)}`);
        };
      }
    }
  }

  clear() {
    this.nes.debug.watches = null;
  }
}

const formatInstruction = (nes, op, addr, read) => {
  const opmeta = nes.cpu.opmeta;
  const opinf = opmeta.opdata[op];
  const instr = opmeta.instname[opinf & 0xff];
  let bytes = [op];
  let arg = 0;
  let factor = 0;
  if (addr != null && read != null) { // can't really look up RAM
    for (let i = 0; i < opmeta.addrSize[(opinf >> 8) & 0xff]; i++) {
      const a = read(++addr);
      bytes.push(a);
      arg += (a << factor);
      factor += 8;
    }
  } else {
    arg = '??'; // don't know ram
  }
  const mode = opmeta.addrFmt[(opinf >> 8) & 0xff](addr, arg).padEnd(8);
  bytes = bytes.map(x => x.toString(16).padStart(2, 0));
  while (bytes.length < 3) bytes.push('  ');
  return `${bytes.join(' ')} ${instr} ${mode}`;
};

Debug.WatchOld = class {
  constructor(nes) {
    this.nes = nes;
    this.watching = null;
  }

  add(addr) {
    if (!this.watching) {
      const w = this.watching = {};
      setTimeout(() => this.check(w), 30);
    }
    if (!(addr instanceof Array)) addr = [addr, addr];
    for (let i = addr[0]; i <= addr[1]; i++) {
      this.watching[i] = this.nes.cpu.mem[i];
    }
  }

  clear() {
    if (this.watching) this.watching['cleared'] = true;
    this.watching = null;
  }

  check(watching) {
    if (watching['cleared']) return;
    for (let addr in watching) {
      const old = watching[addr];
      const curr = this.nes.cpu.mem[addr];
      if (curr != old) {
        watching[addr] = curr;
        console.log(`Watch $${Number(addr).toString(16).padStart(4,0)}: ${
            old.toString(16)} -> ${curr.toString(16)}`);
      }
    }
    setTimeout(() => this.check(watching), 30);
  }
}


const BREAK_RAM_R = 1;
const BREAK_RAM_W = 2;
const BREAK_RAM_X = 4;
const BREAK_PRG_R = 8;
const BREAK_PRG_X = 0x10;

const BREAKPOINT_MODES = {
  'ram-r': BREAK_RAM_R,
  'ram-w': BREAK_RAM_W,
  'ram-x': BREAK_RAM_X,
  'prg-r': BREAK_PRG_R,
  'prg-x': BREAK_PRG_X,
};

// To pass as first arg of logMem
Debug.MEM_RD   = 0b00010010;
Debug.MEM_RD16 = 0b00011010;
Debug.MEM_WR   = 0b00100010;
Debug.MEM_RW   = 0b00110010;
// To pass as first arg or logOther
Debug.SCANLINE = 0b00000011; // next argument is scanline number, 0..240
Debug.VBLANK   = 0b00000111; // next two arguments is frame number (LSB first)
Debug.IRQ      = 0b00001011;
Debug.NMI      = 0b00001111;
Debug.RESET    = 0b00010011;
// Indicates that redundant frames have been elided
Debug.ELIDED   = 0b00010111;

const CPU = 1;
const PAGED = 4;
const MEM_WORD = 8;
const MEM_READ = 0x10;
const MEM_WRITE = 0x20;

// Quick lookup table rather than counting bits?
const LEN_BY_OP = [];
LEN_BY_OP[Debug.MEM_RD] = 4;
LEN_BY_OP[Debug.MEM_RD | PAGED] = 5;
LEN_BY_OP[Debug.MEM_RD16] = 5;
LEN_BY_OP[Debug.MEM_RD16 | PAGED] = 6;
LEN_BY_OP[Debug.MEM_WR] = 4;
LEN_BY_OP[Debug.MEM_RW] = 5;
