import {Recording} from './recording.js';
import {opdata, opmeta} from './opdata.js';

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
//   [0Pwrsp10] [ addrlo ] [ addrhi ] [ page?  ] [ read?  ] [readhi? ] [ write? ]
//   p = address was paged, enables page? byte
//   s = 16-bit read, enables valhi? byte
//   r = whether this is a read
//   w = whether this is a write
//   P = whether this is PPU memory
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

// UPDATE - change how we store the log - just go backwards.  This means we require
// a correct key to work back further, but we generally have that... So now we put
// the selector at the END of the log entry.


//const BYTES_BY_MODE = [2, 2, 1, 3, 1, 2, 2, 2, 3, 3, 2, 3, 3];

export class Debug {
  constructor(nes, size = 0x4000000) { // default to 64MB
    size &= ~0xff; // size must be a multiple of 256
    this.nes = nes;
    // trace buffer
    this.buffer = new Uint8Array(size);
    this.pos = 0;
    this.resets = 0;
    // ---
    this.holding = new HoldingPatternTracker(this);
    this.watches = {}; // {[addr]: {[break_#]: function()}}
    this.breakpoints = new Uint8Array(0x10000);
    this.coverage = new Debug.Coverage(this.nes);
    this.breakIf = () => true,
    this.breakIn = null;
    this.breakAtScanline = null;
    this.break = false;
    this.mt = new Debug.MemTracker(this.nes);
    this.origin = new Debug.OriginTracker(this.nes);
    this.frame = 0;
    this.scanline = 0;
    this.lastPc = 0;
    this.recording = new Recording(this.nes);
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
    if (addr instanceof Array && addr.length == 1) addr = addr[0];
    if (!(addr instanceof Array)) addr = [addr, addr];
    if (addr.length < 3) addr = [addr[0], 1, addr[1]];
    if (!this.breakpoints || addr[2] >= this.breakpoints.length) {
      this.growBreakpoints_(addr[2]);
    }
    let mask = 0;
    for (const mode of modes) {
      mask |= BREAKPOINT_MODES[mem + '-' + mode];
      if (mask != mask) throw new Error(`Bad mode ${mode} on ${mem}`);
    }
    for (let i = addr[0]; i <= addr[2]; i += addr[1]) {
      this.breakpoints[i] |= mask;
    }
  }

  resetTrace() {
    while (this.pos < this.buffer.length) {
      this.buffer[this.pos++] = 0;
    }
    this.resets++;
    this.pos = 0;
  }

  logCpu(opcode, pc) {
    // Check if we're waiting for an interrupt
    // TODO - break out of "waiting" if the pattern breaks
    //if (this.holding.holding) return;

    // If we've gotten to this point then we're not ignoring anything.
    this.lastPc = pc;
    const bank = this.nes.mmap.prgRomBank(pc);
    const addr = bank != null ? this.nes.mmap.prgRomAddress(bank, pc) :
          pc < 0x2000 ? pc & 0x7ff : pc;
    if (bank != null) {
      this.origin.logCpu(opcode, addr);
    } else {
      this.origin.logIndirect();
    }
    // only check for backjumps in PRG.
    let wasHolding = this.holding.holding;
    if (bank != null && this.holding.check(addr) && this.breakAtScanline == null) {
      if (!wasHolding) this.buffer[this.pos++] = Debug.ELIDED;
      return;
    }

    this.coverage.cov[addr] |= (bank != null ? BREAK_PRG_X : BREAK_RAM_X);
    if(this.watches && addr in this.watches){
      const watch = this.watches[addr][bank != null ? BREAK_PRG_X : BREAK_RAM_X];
      if (watch) watch();
    }
    const len = 4 + (bank != null)
    // pad up to the next reset if necessary
    if (this.pos + len >= this.buffer.length) this.resetTrace();
    
    if (bank != null) this.buffer[this.pos++] = bank;
    this.buffer[this.pos++] = pc >>> 8;
    this.buffer[this.pos++] = pc;
    this.buffer[this.pos++] = opcode;
    this.buffer[this.pos++] = 1 | (bank != null ? PAGED : 0);

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
    if (this.holding.holding) return;
    const bank = op & MEM_READ ? this.nes.mmap.prgRomBank(address) : null;
    const addr = bank != null ? this.nes.mmap.prgRomAddress(bank, address) :
            address < 0x2000 ? address & 0x7ff : address;
    this.coverage.cov[addr] |= (bank != null ? BREAK_PRG_R :
                                (op & MEM_READ ? BREAK_RAM_R : 0) |
                                (op & MEM_WRITE ? BREAK_RAM_W : 0));

    if (this.watches && addr in this.watches) {
      const w = this.watches[addr];
      const wr = bank != null ? w[BREAK_PRG_R] : op & MEM_READ ? w[BREAK_RAM_R] : null;
      const ww = op & MEM_WRITE ? w[BREAK_RAM_W] : null;
      if (wr) wr(value);
      if (ww) ww(write == -1 ? value : write);
    }

    if (bank != null) op |= PAGED;
    const len = LEN_BY_OP[op];
    if (len == 0) {
      console.log('Bad memory log: ' + op + ' at ' + address.toString(16));
      return;
    }

    if (this.pos + len >= this.buffer.length) this.resetTrace();

    if (write >= 0) this.buffer[this.pos++] = write;
    if (op & MEM_WORD) this.buffer[this.pos++] = value >>> 8;
    this.buffer[this.pos++] = value;
    if (op & PAGED) this.buffer[this.pos++] = bank;
    this.buffer[this.pos++] = address >>> 8;
    this.buffer[this.pos++] = address;
    this.buffer[this.pos++] = op;

    if (this.breakpoints) {
      const mask = bank != null ? BREAK_PRG_R :
            op & MEM_PPU ? (op == Debug.PPU_RD ? BREAK_PPU_R : BREAK_PPU_W) :
            (op >> 4) & 3; // tricky: may include both read and write
      if ((this.breakpoints[addr] & mask)
          // NOTE: breakIf is not going to know it's PPU...?
          && this.breakIf(address, op & MEM_READ ? 'r' : 'w', value, this.banked(this.lastPc))) {
        const opMask = op & (MEM_READ | MEM_WRITE);
        const type = opMask == MEM_READ ? 'read' :
            opMask == MEM_WRITE ? 'write' : 'read-write';
        const source = op & MEM_PPU ? 'PPU' : bank ? 'PRG' : 'RAM';
        console.log(`break on ${type} ${source} $${addr.toString(16)
                     } at ${this.banked(this.lastPc)}`);
        this.break = true;
      } else if ((op & MEM_WORD) && (this.breakpoints[addr + 1] & mask)
                 && this.breakIf(address, 'r', value, this.banked(this.lastPc))) {
        // NOTE: this can give the wrong PC immediately
        // after jumps?
        console.log(`break on read ${bank ? 'PRG' : 'RAM'} $${
                     (addr + 1).toString(16)} at ${this.banked(this.lastPc)}`);
        this.break = true;
      }
    }
  }

  logScanline(line, frame) {
    if (line == 0) { // start vblank
      if (this.pos + 3 >= this.buffer.length) this.resetTrace();
      this.frame = frame & 0xffff;
      this.scanline = -1;
      this.buffer[this.pos++] = frame >> 8;
      this.buffer[this.pos++] = frame;
      this.buffer[this.pos++] = Debug.VBLANK;
      if (this.breakAtScanline != null) {
        this.break = true;
        this.breakAtScanline = null;
      }
    } else if (line > 20) {
      if (this.buffer[this.pos - 1] == Debug.SCANLINE &&
          this.buffer[this.pos - 3] == Debug.SCANLINE) {
        // Special case: while waiting for interrupt, don't just add empty "scanline"
        // events everywhere.  Conservatively only elide events in between two others
        this.buffer[this.pos - 2] = this.scanline = line - 21;
        return;
      }
      if (this.pos + 3 >= this.buffer.length) this.resetTrace();
      this.buffer[this.pos++] = this.scanline = line - 21;
      this.buffer[this.pos++] = Debug.SCANLINE;
      if (this.breakAtScanline != null && this.breakAtScanline >= 0 &&
          this.breakAtScanline <= line - 21) {
        this.break = true;
        this.breakAtScanline = null;
      }
    }
  }

  logInterrupt(type) {
    // Log first, it will be ignored later.
    if (this.pos + 1 >= this.buffer.length) this.resetTrace();
    this.buffer[this.pos++] = type;

    // When an interrupt happens, it's likely that we were in the middle of a
    // holding pattern.  If we hadn't already identified it, see if we can now.
    this.holding.interrupt();
  }

  /**
   * Returns a valid TracePosition.  If an argument is given, clamps it to the
   * available range.  Otherwise returns the current position.
   */
  tracePosition() {
    return new TracePosition(this, this.resets, this.pos, this.frame, this.scanline);
  }

  /**
   * Calls the given address, pushing the current PC onto the stack.
   * Be very careful about handling registers properly!
   */
  call(addr) {
    this.nes.cpu.push((this.nes.cpu.REG_PC >> 8) & 255);
    this.nes.cpu.push(this.nes.cpu.REG_PC & 255);
    this.nes.cpu.REG_PC = addr - 1;
  }

  banked(addr) {
    const bank = this.nes.mmap.prgRomBank(addr);
    return bank != null ?
        '$' + this.nes.mmap.prgRomAddress(bank, addr).toString(16).padStart(5, 0) :
        '$' + addr.toString(16).padStart(4, 0);
  }

  /**
   * Iterates in forward order anyway.
   * @param {function(opcode, pc, pcrom)=} cpu
   * @param {function(addr, addrrom, read?, written?)=} mem
   * @param {function(num, num)=} scanline
   * @param {function(num)=} interrupt
   * @param {!TracePosition=} start
   * @param {!TracePosition|number=} count
   * @return {!TracePosition} Position at end.
   */
  visitLog({cpu, mem, scanline, interrupt, elided} = {}, end = undefined, start = 0x400) {
    if (!end) end = this.tracePosition();
    if (!end.isValid()) return end;
    if (!(start instanceof TracePosition)) {
      let pos = end.pos - start;
      let resets = end.resets;
      if (pos < 0) {
        resets--;
        pos = Math.max(pos + this.buffer.length, this.pos + 1);
      }
      start = new TracePosition(this, resets, pos, null, null);
    }
    let pos = end.pos;
    let resets = end.resets;
    let currentFrame = end.frame;
    let currentScanline = end.scanline;

    const entries = [];

    // Work backwards, from most to least recent
    for (;;) {
      if (pos <= 0) {
        pos += this.buffer.length;
        resets--;
      }
      const selector = this.buffer[--pos];
      if (!selector) continue;
      const len = selectorLength(selector);
      if (resets < start.resets || resets == start.resets && pos - len + 1 < start.pos) {
        pos -= len - 1;
        break;
      }
      entries.push(pos + 1);
      // special case scanline frame so that we can know the start frame upfront
      if (selector == Debug.VBLANK) {
        currentFrame = this.buffer[pos - 1] + (this.buffer[pos - 2] << 8) - 1;
        currentScanline = 240;
      } else if (selector == Debug.SCANLINE) {
        currentScanline = this.buffer[pos - 1] - 1;
      }
      pos -= len - 1;
    }
    scanline && scanline(currentScanline, currentFrame);

    // Iterate backwards over entries, forward in time
    for (let i = entries.length - 1; i >= 0; i--) {
      let pos = entries[i];
      const selector = this.buffer[--pos];
      switch (selector & 3) {
      case 1: { // cpu
        const op = this.buffer[--pos];
        const addr = this.buffer[--pos] | (this.buffer[--pos] << 8);
        let romaddr = null;
let bank = null;
        if (selector & PAGED) {
          bank = this.buffer[--pos];
          romaddr = this.nes.mmap.prgRomAddress(bank, addr);
}

if(romaddr>0x3ffff)console.error(this.buffer.slice(pos, pos+5).map(x=>x.toString(16)), addr, bank, romaddr);

        cpu && cpu(op, addr, romaddr);
        break;
      }
      case 2: { // mem
        const addr = this.buffer[--pos] | (this.buffer[--pos] << 8);
        const romaddr =
            selector & MEM_PPU ? 'ppu' :  // NOTE: this will break with paged CHR RAM.
            selector & PAGED ? this.nes.mmap.prgRomAddress(this.buffer[--pos], addr) : null;
        const read =
            selector & MEM_READ ?
                this.buffer[--pos] |
                    (selector & MEM_WORD ? this.buffer[--pos] << 8 : 0) :
                undefined;
        const write = selector & MEM_WRITE ? this.buffer[--pos] : undefined;
        mem && mem(addr, romaddr, read, write);
        break;
      }
      case 3: { // other
        switch (selector) {
        case Debug.VBLANK:
          const frame = this.buffer[--pos] | (this.buffer[--pos] << 8);
          scanline && scanline(-1, frame);
          break;
        case Debug.SCANLINE:
          scanline && scanline(this.buffer[--pos]);
          break;
        case Debug.IRQ:
        case Debug.NMI:
        case Debug.RESET:
          interrupt && interrupt(selector);
          break;
        case Debug.ELIDED:
          elided && elided();
          break;
        }
        break;
      }
      default:
      }
    }
    return new TracePosition(this, resets, pos, currentFrame, currentScanline);
  }

  /** @return {!TracePosition} */
  trace(end = undefined, start = undefined, log = console.log) {
    const parts = [];
    let frame = '????';
    let scanline = '??';
    const result = this.visitLog({
      cpu: (op, addr, romaddr) => {
        // TODO - rewrite this to call formatInstruction
        const opinf = opdata[op];
        const instr = opmeta.instname[opinf & 0xff];
        let pc = (romaddr != null ? romaddr : addr).toString(16);
        pc = ('$' + pc.padStart(4 + (romaddr != null), '0')).padStart(9);
        let bytes = [op];
        let arg = 0;
        let factor = 0;
        if (romaddr != null) { // can't really look up RAM
          for (let i = 0; i < opmeta.addrSize[(opinf >> 8) & 0xff]; i++) {
            romaddr++;
if(romaddr>0x3ffff){
console.log('BAD!');
debugger;
return;
}
            const a = this.nes.rom.rom[romaddr];
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
        let a = (typeof romaddr == 'number' ? romaddr : addr).toString(16);
        a = '$' + a.padStart(4 + (typeof romaddr == 'number'), '0');
        if (romaddr == 'ppu') a = 'PPU ' + a;
        if (read != null) parts.push(`  read ${a} -> $${read.toString(16)}`);
        if (write != null) parts.push(`  write ${a} <- $${write.toString(16)}`);
      },
      scanline: (newScanline, newFrame) => {
        if (newScanline == null) {
          return;
        }
        if (newFrame != null) frame = newFrame.toString(16).padStart(4, 0);
        scanline = newScanline < 0 ? '-1' : newScanline.toString(16).padStart(2, 0);
      },
      interrupt: (type) => {
        const name = type == Debug.NMI ? '(NMI)' : type == Debug.IRQ ? '(IRQ)' : '(reset)';
        parts.push(`\n ${frame}:${scanline}   INTERRUPT        ${name.padEnd(12)}`);
        // Next entry will be the pops, so the newline helps.
      },
      elided: () => {
        parts.push(`\n ${frame}:${scanline}   --- frames elided waiting for interrupt ---`);
      },
    }, end, start);
    log(parts.join(''));
    return result;
  }

  nextInstruction() {
    const addr = this.nes.cpu.REG_PC + 1;
    const op = this.nes.cpu.load(addr);
    return '           $' + addr.toString(16).padStart(5, 0) + ': ' +
        formatInstruction(op, addr, (a) => this.nes.cpu.load(a));
  }

  patchRom(addr, value) {
    this.nes.rom.rom[addr] = value;
  }

  memTracker() {
    return new Debug.MemTracker(this.nes);
  }

  watch() {
    return new Debug.Watch(this.nes);
  }

  origins(destination) {
    return this.origin.origins(destination);
  }
}


/**
 * Keeps track of a piece of data for each element of the call stack.
 * Double-checks that the address pushed onto the stack is the same as
 * the data coming off before returning it.
 * @template T
 */
class CallStackTracker {
  constructor(nes) {
    this.nes = nes;
    /** @type {!Array<{sp: number, pc: number, data: T}>} */
    this.stack = [];
  }

  /**
   * Call after pushing to the stack and updating the PC.
   * Example:
   * ```
   *   ; SP = $1f7
   *   $8421: jsr $fc63  ; SP <- $1f5, $1f6 <- #$23, $1f7 <- #$84
   *   $fc63: lda #$0
   * ```
   * This will push `{sp: $1f5, pc: $8423}`.
   *
   * @param {T} data
   */
  push(data) {
    // First remove any obsolete elements.
    const sp = this.nes.cpu.REG_SP;
    const cpu = this.nes.cpu;
    const pc = cpu.load(sp + 1) | (cpu.load(sp + 2) << 8);
    const stack = this.stack;
    while (stack.length && stack[stack.length - 1].sp <= sp) stack.pop();
    stack.push({sp, pc, data});
  }

  /**
   * Call before popping the stack and restoring the PC.
   * Example:
   * ```
   *   ; SP = $1f5, ($1f6) = $8423, stack ends with {sp: $1f5, pc: $8423}
   *   $fc69: rts      ; SP <- $1f7, PC <- $8423
   *   $8424: lda #$0
   * ```
   * Before executing the `rts`, we get rid of anything with smaller SP
   * from the top of the stack, then check for a match against the current
   * top of the CPU's stack.
   *
   * @return {T|undefined} data
   */
  pop() {
    const sp = this.nes.cpu.REG_SP;
    const cpu = this.nes.cpu;
    const pc = cpu.load(sp + 1) | (cpu.load(sp + 2) << 8);
    const stack = this.stack;
    let top;
    while (stack.length && stack[stack.length - 1].sp <= sp) top = stack.pop();
    return top && top.sp == sp && top.pc == pc ? top.data : undefined;
  }
}


class HoldingPatternTracker {
  constructor(debug) {
    this.debug = debug;
    this.holdingPatterns = {};
    // PC of last instruction
    this.lastPc = 0;
    // PC of last backward jump that was taken
    this.lastBackjump = 0;
    this.pos1 = 0;
    this.pos2 = 0;
    this.holding = null;
  }

  /**
   * Returns true if we're in a known holding pattern.
   * Otherwise stores the current PC and tracelog position for future analysis.
   * We will only detect the pattern if the interrupt occurs immediately after
   * a backjump.
   */
  check(pc) {
    if (this.holding && pc >= this.holding[0] && pc <= this.holding[1]) return true;
    this.holding = null;
    if (pc > this.lastPc || pc < this.lastPc - 0x10) {
      this.lastPc = pc;
      return false;
    }
    // A backward jump has occurred - check if it's a known holding pattern.
    if (this.lastPc == this.lastBackjump && this.holdingPatterns[this.lastPc]) {
      this.holding = [pc, this.lastPc];
      return true;
    }
    // Keep track of this backjump.
    this.lastBackjump = this.lastPc;
    this.pos2 = this.pos1;
    this.pos1 = this.debug.pos;
    this.lastPc = pc;
    return false;
  }

  /** Analyzes the recent history to find a possible holding pattern. */
  interrupt() {
    if (this.holding) {
      this.holding = false;
      return;
    }
    // we will only find the pattern if the interrupt occurs immediately after a backjump
    const diff = this.pos1 - this.pos2;
    if (this.lastPc != this.lastBackjump || diff <= 0 || this.pos1 < 2 * diff) return;
    const buf = this.debug.buffer;
    // check for a cycle in the trace log
// incorrect find: $3d38c - not quite right, need up to 8 iterations to know it's
// a holding pattern.
// console.error(`pc=${this.lastPc.toString(16)}, diff=${diff}, pos=${this.pos1}, buf=${diff > 0 && diff < 20 && this.pos1 > 2 * diff ? buf.slice(this.pos1 - 2 * diff, this.pos1) : null}`);
    for (let i = 0; i < diff; i++) {
      if (buf[this.pos1 - i] != buf[this.pos2 - i]) return;
    }

 // 50d8:5b   $380b2: d0 f7    BNE $380ab  
 // 50d8:5b   $380ab: 9d 00 02 STA $0200,x   write $0228 <- $f0
 // 50d8:5b   $380ae: e8       INX         
 // 50d8:5b   $380af: e8       INX         
 // 50d8:5b   $380b0: e8       INX         
 // 50d8:5b   $380b1: e8       INX         
 // 50d8:5b   $380b2: d0 f7    BNE $380ab  
 // 50d8:5b   --- frames elided waiting for interrupt ---

    console.log(`Found holding pattern backjump: $${this.lastPc.toString(16).padStart(5,0)}`);
    this.holdingPatterns[this.lastPc] = true;
  }
}


// Private-constructor marker class...
class TracePosition {
  constructor(debug, resets, pos, frame, scanline) {
    this.debug = debug;
    this.resets = resets;
    this.pos = pos;
    this.frame = frame;
    this.scanline = scanline;
  }

  distance(that) {
    if (!that) return Infinity;
    return this.pos - that.pos + this.debug.buffer.length * (this.resets - that.resets);
  }

  isValid() {
    return this.resets == this.debug.resets ||
        this.resets == this.debug.resets - 1 && this.pos > this.debug.pos;
  }
}


Debug.OriginTracker = class {
  constructor(nes) {
    this.nes = nes;
    this.lastPc = null;
    this.source = null;
    /** @type {{[dst: number]: {[src: number]: {[type: string]: number}}}} */
    this.data = {};
    this.stack = new CallStackTracker(nes);
  }

  add(origin, destination, type) {
    let map = this.data[destination];
    if (!map) map = this.data[destination] = {'': {}};
    let byOrigin = map[type];
    if (!byOrigin) byOrigin = map[type] = {};
    byOrigin[origin] = (byOrigin[origin] || 0) + 1;
    map[''][origin] = (map[''][origin] || 0) + 1;
  }

  logCpu(op, pc) {
    // If we just came from a jump, log it
    let source = this.source;
    if (source) {
      if (source == 'cond') {
        source = pc == this.lastPc + 2 ? 'cond-f' : 'cond-t';
      }
      this.add(this.lastPc, pc, source);
      if (source.startsWith('call')) {
        this.stack.push(pc); // push addr of first instruction of sub
      }
    }
    // If we're about to return, pop the call stack tracker
    // Note: is we called a routine that consisted entirely
    // of a single RTS onstruction, then we'll immediately
    // pop the PC we just pushed above, which is correct.
    if (op == 0x60) { // rts
      const entry = this.stack.pop()
      if (entry) this.add(entry, pc, 'exit');
    }
    // If this is a jump, track it
    this.source = JUMP_OPCODES[op];
    this.lastPc = this.source ? pc : null;
  }

  logIndirect() {
    if (this.source) this.source += '-ind';
  }

  clear() {
    this.data = {};
  }

  origins(destination) {
    const result = {};
    const data = this.data[destination] || {};
    for (const origin in data['']) {
      result['$' + Number(origin).toString(16).padStart(5, 0)] = data[''][origin];
    }
    return result;
  }
}


const JUMP_OPCODES = {
  0x10: 'cond', // bpl
  0x30: 'cond', // bmi
  0x50: 'cond', // bvc
  0x70: 'cond', // bvs
  0x90: 'cond', // bcb
  0xb0: 'cond', // bcs
  0xd0: 'cond', // bne
  0xf0: 'cond', // beq
  0x4c: 'jmp',
  0x6c: 'jmp-ind',
  0x20: 'call',
  //0x40: 'rti'
  0x60: 'rts',
};


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

  candidates(type, format = false) {
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
        const value = type == 'x' ? 1 : this.nes.rom.rom[i];
        candidates['PRG $' + i.toString(16).padStart(5, 0)] = value;
      }
      if (valid & 0x07) {
// if (i == 0x1c26f)console.log('RAM');
        const value = type == 'x' ? 1 : this.nes.cpu.load(i < 0x2000 ? i & 0x7ff : i);
        candidates['RAM $' + i.toString(16).padStart(4, 0)] = value;
      }
    }
    if (type == 'x' && format) {
      const keys =
          Object.keys(candidates)
              .sort()
              .map(x => Number.parseInt(x.substring(5), 16));
      const ranges = [];
      for (const key of keys) {
        if (ranges.length && key - ranges[ranges.length - 1][1] < 4) {
          ranges[ranges.length - 1][1] = key;
        } else {
          ranges.push([key, key]);
        }
      }
      return ranges.map(x => {
        x = x.map(y => `$${y.toString(16).padStart(5, 0)}`);
        return `${x[0]}..${x[1]}`;
      }).join(', ');
    }
    return candidates;
  }
};

Debug.MemTracker = class {
  constructor(nes) {
    this.nes = nes;
    this.mem = new Uint8Array(0x8000);
    this.valid = new Uint8Array(0x8000);
  }

  reset() {
    const cpu = this.nes.cpu;
    for (let i = 0; i < 0x8000; i++) {
      this.mem[i] = cpu.load(i);
    }
    this.valid.fill(1);
  }

  expectSame() {
    const cpu = this.nes.cpu;
    let candidates = 0;
    for (let i = 0; i < 0x8000; i++) {
      const mem = cpu.load(i);
      if (this.mem[i] != mem) this.valid[i] = 0;
      this.mem[i] = mem;
      candidates += this.valid[i];
    }
    return candidates;
  }

  expectDiff() {
    const cpu = this.nes.cpu;
    let candidates = 0;
    for (let i = 0; i < 0x8000; i++) {
      const mem = cpu.load(i);
      if (this.mem[i] == mem) this.valid[i] = 0;
      this.mem[i] = mem;
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

// TODO - any way to configurably watch PRG page switches?
Debug.Watch = class {
  constructor(nes) {
    this.nes = nes;
  }

  add(addr, type, op, {changed=false, ascii=true, value=null} = {}) {
    // TODO - watch individual bits?
    if (addr instanceof Array && addr.length == 1) addr = addr[0];
    if (!(addr instanceof Array)) addr = [addr, addr];
    if (addr.length < 3) addr = [addr[0], 1, addr[1]];
    const mode = BREAKPOINT_MODES[`${type}-${op}`];
    if (!mode) throw new Error(`Bad mode: '${type}-${op}'`);
    const ws = this.nes.debug.watches || (this.nes.debug.watches = {});
    const fmt = (v, p) => `$${v.toString(16).padStart(p, 0)}${
                           ascii&&p==2&&v>31&&v<127?' ('+String.fromCharCode(v)+')':''}`;
    const read = type == 'ram' ?
          (a) => this.nes.cpu.load(a) :
          (a) => this.nes.rom.rom[a];
    const pad = type = 'ram' ? 4 : 5;
    const pc = () => {
      const a = this.nes.cpu.REG_PC + 1;
      const bank = this.nes.mmap.prgRomBank(a);
      return bank != null ? fmt(this.nes.mmap.prgRomAddress(bank, a), 5) : fmt(a, 4);
    }
    const scanline = () => `${this.nes.ppu.frame.toString(16).padStart(6,0)}:${
                              this.nes.ppu.scanline < 21 ? -1 :
                                  (this.nes.ppu.scanline - 21).toString(16).padStart(2,0)}`;
    for (let i = addr[0]; i <= addr[2]; i += addr[1]) {
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
               formatInstruction(read(i), i, read)}`);
        };
      }
    }
  }

  clear() {
    this.nes.debug.watches = null;
  }
}

const formatInstruction = (op, addr, read) => {
  const opinf = opdata[op];
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
      this.watching[i] = this.nes.cpu.load(i);
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
      const curr = this.nes.cpu.load(addr);
      if (curr != old) {
        watching[addr] = curr;
        console.log(`Watch $${Number(addr).toString(16).padStart(4,0)}: ${
            old.toString(16)} -> ${curr.toString(16)}`);
      }
    }
    setTimeout(() => this.check(watching), 30);
  }
}


const selectorLength = (selector) => {
  switch (selector & 3) {
  case 1: // cpu
    return 4 + !!(selector & PAGED);
  case 2: // mem
    return 3 +
        !!(selector & PAGED) +
        !!(selector & MEM_READ) +
        !!(selector & MEM_WORD) +
        !!(selector & MEM_WRITE);
  case 3: // other
    switch (selector) {
      case Debug.VBLANK:   return 3;
      case Debug.SCANLINE: return 2;
      default:             return 1;
    }
  }
  return 1;
};


const BREAK_RAM_R = 1;
const BREAK_RAM_W = 2;
const BREAK_RAM_X = 4;
const BREAK_PRG_R = 8;
const BREAK_PRG_X = 0x10;
const BREAK_PPU_R = 0x20;
const BREAK_PPU_W = 0x40;

const BREAKPOINT_MODES = {
  'ram-r': BREAK_RAM_R,
  'ram-w': BREAK_RAM_W,
  'ram-x': BREAK_RAM_X,
  'prg-r': BREAK_PRG_R,
  'prg-x': BREAK_PRG_X,
  'ppu-r': BREAK_PPU_R,
  'ppu-w': BREAK_PPU_W,
};

// To pass as first arg of logMem
Debug.MEM_RD   = 0b00010010;
Debug.MEM_RD16 = 0b00011010;
Debug.MEM_WR   = 0b00100010;
Debug.MEM_RW   = 0b00110010;
Debug.PPU_RD   = 0b01010010;
Debug.PPU_WR   = 0b01100010;
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
const MEM_PPU = 0x40;

// Quick lookup table rather than counting bits?
const LEN_BY_OP = [];
LEN_BY_OP[Debug.MEM_RD] = 4;
LEN_BY_OP[Debug.MEM_RD | PAGED] = 5;
LEN_BY_OP[Debug.MEM_RD16] = 5;
LEN_BY_OP[Debug.MEM_RD16 | PAGED] = 6;
LEN_BY_OP[Debug.MEM_WR] = 4;
LEN_BY_OP[Debug.MEM_RW] = 5;
LEN_BY_OP[Debug.PPU_RD] = 4;
LEN_BY_OP[Debug.PPU_WR] = 4;
