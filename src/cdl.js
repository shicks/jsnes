import {affected, opdata, opmeta} from './opdata.js';
import {CoverageLog} from './wire.js';
import {disassemble} from './disassembler.js';

// Code-Data Logger
// This is a component that can be installed into the debugger to generate
// a CDL file for a rom.  This file records the following:

// Entries:
//  - For each jump instruction (JMP, JSR, B**), record a 24-bit address
//    for the source and destination.
//  - Each jump also stores the first and last frame in which if occurred,
//    as well as the number of times happened.
// Data (not yet):
//  - For each instruction that reads from ROM, record the 24-bit address
//    that it was read from and the 24-bit address that was read.
//  - Coverage data for each read: (fst/lst/cnt).
//  - Bit set indicating how it was used:
//     * jump, data, index, nametable, oam, palette, chr
// This is effectively a giant map from 48-bit numbers (source/dest or
// pc/data) to frame/count/function records, which are simply 4 unsigned
// varints (function: 1=code, 2=data, others TBD; log2(count); first; last).

// Keys to CoverageLog.Record.meta field
const ENTRY = 1;
const DATA = 2;
const IMMEDIATE_DATA = 4;
const WR_NAMETABLE = 8;
const WR_OAM = 0x10;
const WR_CHR = 0x20;
const WR_INDEX = 0x40;
const WR_INDIRECT = 0x80;
const WR_JUMP = 0x100;
const WR_PALETTE = 0x200;

const REG_A = -1;
const REG_X = -2;
const REG_Y = -3;
const REG_C = -4;
const REG_TMP = -5;

// interface CoverageRecord {
//   address: number;
//   first: number;
//   last: number;
//   count: number; // will be log oin serialized version
//   meta: number;
//   refs: Set<number>;
//   regs: Set<number>;
//   indirect?: number;
// }

export class CodeDataLog {
  constructor(nes) {
    // NOTE: nes can be just {rom} if necessary.
    this.nes = nes;
    this.data = new Map(); // Full address => CoverageRecord
    this.lastKey = new Map(); // int24 => int48
    this.lastPc = null;
    this.lastOp = null;
    // Key: positive  (full address) or -1=a, -2=x, -3=y.
    // Value: immutable iterable of 24-bit full original ROM addresses.
    this.source = new Map();
  }

  static make(nes) {
    return new CodeDataLog(nes);
  }

  disasm() {
    return disassemble(this.nes.rom.rom, this);
  }

  serialize() {
    const records = [];
    // sort the keys
    const keys = [...this.data.keys()].sort((a, b) => a - b);
    for (const key of keys) {
      const record = {...this.data.get(key)};
      if (record.count) record.logCount = Math.floor(Math.log2(record.count) * 16);
      record.refs = [...(record.refs || [])].filter(x => x !== key - 1);
      record.regs = [...(record.regs || [])];
      delete record.count;
      records.push(record);
    }
    return CoverageLog.of({records}).serialize('NES-CDL\x1a');
  }

  merge(bytes) {
    const {records = []} = CoverageLog.parse(bytes, 'NES-CDL\x1a');
    for (const record of records) {
      const rec = this.getRecord(record.address);
      if (record.first != null) {
        rec.first = Math.min(rec.first != null ? rec.first : Infinity, record.first);
      }
      if (record.last != null) rec.last = Math.max(rec.last || 0, record.last);
      if (record.logCount != null) {
        rec.count = (rec.count || 0) + Math.floor(2 ** (record.logCount / 16));
      }
      if (record.meta) rec.meta |= record.meta;
      for (const ref of record.refs || []) {
        (rec.refs || (rec.refs = new Set())).add(ref);
      }
      for (const reg of record.regs || []) {
        (rec.regs || (rec.regs = new Set())).add(reg);
      }
      if (record.indirect != null) rec.indirect = record.indirect;
    }
  }

  // Given a memory address, returns a full 24-bit address.
  // Full addresses are (bank << 16 | address).  Bank is zero
  // for CPU RAM and (typically) PRG RAM.
  fullAddress(addr) {
    if (addr < 0x800) return addr; // CPU RAM and (negative) registers
    const bank = this.nes.mmap.prgRomBank(addr) || 0;
    return bank << 16 | addr;
  }

  // Determines the current source for the given address.

  logEntry(addr) {
    // source: lastPc
    const record = this.markCoverage(this.fullAddress(addr),
                                     {meta: ENTRY, ref: this.lastPc, count: 1});
  }

  // addr: a full address
  // returns a CoverageRecord, creating one if necessary
  getRecord(address) {
    let record = this.data.get(address);
    if (!record) {
      //const frame = this.nes ? this.nes.ppu.frame : 0;
      this.data.set(address,
                    record = {
                      address,
                      meta: 0,
                      refs: new Set(),
                      regs: new Set(),
                    });
    }
    return record;
  }

  // addr: a full address
  // returns the record, or null.
  markCoverage(addr, extra) {
    if (addr < 0 || !this.nes.mmap.isRom(addr & 0xffff)) return null;
    const record = this.getRecord(addr);
    if (extra.count) {
      record.first = Math.min(record.first != null ? record.first : Infinity,
                              this.nes.ppu.frame);
      record.last = Math.max(record.last || 0, this.nes.ppu.frame);
      record.count = (record.count || 0) + extra.count;
    }
    if (extra.meta) record.meta |= extra.meta;
//    if (extra.ref === 0x1ec42d && addr === 0x188000) debugger;
    if (extra.ref != null) (record.refs || (record.refs = new Set())).add(extra.ref);
    if (extra.reg != null) (record.regs || (record.regs = new Set())).add(extra.reg);
    return record;
  }

  markUsage(address, meta) {
    for (const source of this.source.get(this.fullAddress(address)) || []) {
      const rec = this.getRecord(source);
      rec.meta |= meta;
    }
  }

  logExec(op, addr) {
    this.lastOp = OPS[op];
    this.lastPc = this.fullAddress(addr);
    if (this.lastOp) this.lastOp.exec(this, this.lastPc);
  }

  logMem(addr, isWord, isPpu, isWrite) {
    const full = this.fullAddress(addr);
    // Always log coverage (if ROM)
    if (this.nes.mmap.isRom(addr) && !isWrite) {
      this.markCoverage(full, {meta: DATA, ref: this.lastPc, count: 1});
      if (isWord) this.markCoverage(full + 1,
                                    {meta: DATA, ref: this.lastPc, count: 1});
    }
    // Let the op do its thing.
    if (this.lastOp) {
      if (isWord) {
        this.lastOp.word(this, full);
      } else {
        this.lastOp.mem(this, full, isPpu);
      }
    }
  }

  logIndex(reg) {
    this.markUsage(reg === 'x' ? REG_X : REG_Y, WR_INDEX);
  }

  markIndirect(addr, meta) {
    const a =
        this.fullAddress(this.nes.cpu.load(addr) |
                         (this.nes.cpu.load(addr + 1) << 8));
    for (const address of [addr, addr + 1]) {
      for (const source of this.source.get(this.fullAddress(address)) || []) {
        const rec = this.getRecord(source);
        rec.meta |= meta;
        if (this.nes.mmap.isRom(a)) rec.indirect = a;
      }
    }
  }

  logIndirect(addr) {
    this.markIndirect(addr, WR_INDIRECT);
  }

  // TODO - probably remove this
  // logIndirectJump() {}

  logOamDma(value) {
    const base = value << 8;
    for (let i = 0; i < 256; i++) {
      this.markUsage(base | i, WR_OAM);
    }    
  }

// source for 'm' is itself if ROM, otherwise it's transitive sources
//   - will need a mmap.isRom() function?
// todo - consider also tracking immediate inline values??
//      - read from previous byte...

  logSprite(tile, attr) {
    return;
    const ppu = this.nes.ppu;
    const tall = ppu.f_tallSprites;
    tile =
        ((tall && ppu.tallSpritePatternTableBanks || ppu.patternTableBanks)
         [tile >>> 10].byteOffset | (tile & 0x3ff)) >>> 4;
    let mask = this.nes.ppu.f_tallSprites ? 0x20 : 0x10;
    mask |= 1 << ((attr & 0xc0) >>> 6);
    if (this.chr[tile]) {
      this.chr[tile] |= mask;
      return;
    }
    this.chr[tile] |= mask | packPalette(this.nes.ppu.paletteRam,
                                         0x10 | (attr & 3) << 2);
  }

  // tile is shifted left by 4, attr is shifted left by 2
  logBackground(tile, attr) {
    return;
    const ppu = this.nes.ppu;
    const banks = ppu.patternTableBanks;
    tile = (banks[tile >>> 10].byteOffset | (tile & 0x3ff)) >>> 4;
    const mask = 0x40;
    tile >>>= 4;
    if (this.chr[tile]) {
      this.chr[tile] |= mask;
      return;
    }
    this.chr[tile] |= mask | packPalette(ppu.paletteRam, 0x10 | (attr & 0x0c));
  }
}

function isEmpty(arr, addr) {
  for (let i = 0; i < 32; i++) {
    if (arr[addr << 5 | i]) return false;
  }
  return true;
}

function numConst(v) {
  return {
    'number': v,
    'bigint': typeof BigInt === 'function' ? BigInt(v) : null,
  };
}
const ZERO = numConst(0);
const ONE = numConst(1);
const SEVEN = numConst(7);
const SBYTE = numConst(127);
const SIGN = numConst(128);

function packPalette(ram, offset) {
  return (ram[offset] | ram[offset + 1] << 6 |
          ram[offset + 2] << 12 | ram[offset + 3] << 18) << 8;
}

// Tracks all registers affected by each instruction.
// This is a comma-separated list of assignments.  The
// source of each of the elements on the RHS is set to
// the union of the sources of all the elements on the
// LHS of the '>'.  The comma-separated terms are done
// simultaneously.  The elements are 'axy' for registers,
// 'c' for the carry flag, or 'm' for memory (which may
// actually be 'a' for some ops, and can refer to stack).
// 't' is an artificial temp register used to serialize
// parallel ops.
const DATA_FLOW_MAP = {
  'ADC': 'mac>ac',
  'AND': 'ma>a',
  'ASL': 'm>mc',
  'BCC': 'jmp',
  'BCS': 'jmp',
  'BEQ': 'jmp',
  'BMI': 'jmp',
  'BNE': 'jmp',
  'BPL': 'jmp',
  'BVC': 'jmp',
  'BVS': 'jmp',
  'CLC': '>c',
  'CMP': 'ma>c',
  'CPX': 'mx>c',
  'CPY': 'my>c',
  'DEC': 'm>c',
  'DEX': 'x>c',
  'DEY': 'y>c',
  'INC': 'm>c',
  'INX': 'x>c',
  'INY': 'y>c',
  'JMP': 'jmp',
  'JSR': 'jmp',
  'LDA': 'm>a',
  'LDX': 'm>x',
  'LDY': 'm>y',
  'LSR': 'm>mc',
  'ORA': 'ma>a',
  'PHA': 'a>m',
  'PHP': 'c>m',
  'PLA': 'm>a',
  'PLP': 'm>c',
  'ROL': 'c>t,m>c,mt>m',
  'ROR': 'c>t,m>c,mt>m',
  'SBC': 'mac>ac',
  'SEC': '>c',
  'STA': 'a>m',
  'STX': 'x>m',
  'STY': 'y>m',
  'TAX': 'a>x',
  'TAY': 'a>y',
  'TSX': '>x',
  'TXA': 'x>a',
  'TYA': 'y>a',
};

// code: string of the form a>c
// mode: addressing mode (see opdata)
// return: a DataFlow w/ exec() and mem() methods
function dataFlow(code, mode) {
  if (mode === opmeta.ADDR_ACC) code = code.replace(/m/g, 'a');
  if (code.includes(',')) {
    return new MultiDataFlow(code.split(/,/g).map(c => dataFlow(c, mode)));
  } else if (code === 'jmp') {
    return new JumpDataFlow();
  }
  const map =
      {'m': 0, 'a': REG_A, 'x': REG_X, 'y': REG_Y, 'c': REG_C, 't': REG_TMP};
  const [src, dst] = code.split('>').map(x => [...x].map(s => map[s]));
  if (dst == null) throw new Error(`bad code: ${code}`);
  // need to see if we have 'm' or 's' - in either case, we need to wait for
  // the mem before we can work.
  const immediate = mode === opmeta.ADDR_IMM;
  const late = code.includes('m') && !immediate;
  return late ? new LateDataFlow(src, dst) : new ImmediateDataFlow(src, dst);
}

// interface DataFlow {
//   exec(cdl: CodeDataLog, pc: int24): void;
//   mem(cdl: CodeDataLog, address: int24): void;
// }

class AbstractDataFlow {
  constructor(srcs, dsts) {
    this.srcs = srcs;
    this.dsts = dsts;
  }
  exec() {}
  mem() {}
  word() {}
  jump() {}
  flow(cdl, addr, isPpu) {
    const result = new Set();
    for (let src of this.srcs) {
      if (!src) { // memory
        // memory - see if it's PPU or a PRG register?  if so, skip
        const cpu = addr & 0xffff;
        if (isPpu || (cpu >= 0x2000 && cpu < 0x6000)) continue;
        if (cdl.nes.mmap.isRom(cpu)) {
          result.add(addr);
          if (addr === cdl.lastPc + 1) {
            cdl.markCoverage(addr,
                             {meta: IMMEDIATE_DATA, ref: cdl.lastPc, count: 1});
          }
          continue;
        }
        src = addr; // RAM - copy all sources.
      }
      for (const s of cdl.source.get(src) || []) {
        result.add(s);
      }
    }
            // [].concat(...this.srcs.map(s => {
            //   if (s) return cdl.source.get(s) || [];
            //   const cpu = addr & 0xffff;
            //   // Don't track PPU/register reads
            //   if (isPpu || cpu >= 0x2000 && cpu < 0x6000) return [];
            //   if (cdl.nes.mmap.isRom(cpu)) return [addr];
            //   const source = cdl.source.get(addr);
            //   return [...( || [])];
            // })));
    //if ([...result].some(x => typeof x !== 'number')) debugger;
    let meta = 0;
    for (const d of this.dsts) {
      if (!d) {
        if (isPpu) {
          meta |=
              addr < 0x2000 ? WR_CHR :
              addr < 0x3f00 ? WR_NAMETABLE : WR_PALETTE;
          continue;
        }
        // Only bother marking coverage for immediate data, since all other
        // memory invocations came through the logMem().
        if (addr === cdl.lastPc + 1) {
          cdl.markCoverage(addr,
                           {meta: IMMEDIATE_DATA, ref: cdl.lastPc, count: 1});
        }
        // Check for writes to CPU registers
        const cpu = addr & 0xffff;
        if (cpu === 0x2004) meta |= WR_OAM
        if (cpu < 0x8000 ?
            cpu >= 0x2000 && cpu < 0x6000 :
            cdl.nes.mmap.isRom(cpu)) {
          for (const source of result) {
            cdl.markCoverage(source, {reg: cpu});
          }
          break;
        }
      }
      cdl.source.set(d || addr, result);
    }
    // If meta is nonzero, update it
    if (meta) {
      for (const source of result) {
        cdl.markCoverage(source, {meta});
      }
    }
  }
}

class ImmediateDataFlow extends AbstractDataFlow {
  exec(cdl, pc) { this.flow(cdl, pc + 1); }
}

class LateDataFlow extends AbstractDataFlow {
  mem(cdl, addr, isPpu) { this.flow(cdl, addr, isPpu); }
}

class MultiDataFlow {
  constructor(terms) {
    this.terms = terms;
  }
  exec(cdl, pc) {
    for (const term of this.terms) term.exec(cdl, pc);
  }
  mem(cdl, address, isPpu) {
    for (const term of this.terms) term.mem(cdl, address, isPpu);
  }
  word() {}
  jump() {}
}

class JumpDataFlow {
  word(cdl, addr) {
    // Read a word before the jump -> indirect
    cdl.markIndirect(addr, WR_JUMP);
  }
  exec() {}
  mem() {}
  jump(cdl, addr) {
    if (!cdl.nes.mmap.isRom(cdl.lastPc & 0xffff)) {
      // If PC is in RAM then also mark indirect jump.
      cdl.markIndirect(cdl.lastPc + 1, WR_JUMP);
    }
    cdl.markCoverage(addr, {meta: ENTRY, ref: cdl.lastPc, count: 1});
  }
}

const OPS = (() => {
  const ops = [];
  for (let op = 0; op < 256; op++) {
    const opinf = opdata[op];
    const instr = opmeta.instname[opinf & 0xff];
    const addrMode = (opinf >> 8) & 0xff;
    const dataFlowSpec = DATA_FLOW_MAP[instr];
    if (!dataFlowSpec) continue; // not tracked.
    ops[op] = dataFlow(dataFlowSpec, addrMode);
  }
  return ops;
})();
