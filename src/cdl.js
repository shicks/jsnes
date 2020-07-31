// Code-Data Logger
// This is a component that can be installed into the debugger to generate
// a CDL file for a rom.  This file records the following:
// For code:
//  1. which offsets are executed
//  2. what rom pages were banked into each slot on execution [~16 bytes]
//  3. what the values of each register (A,X,Y,P) were [~256 bytes]
//  4. how many times it executed (log2) [1 byte]
//  5. how many frames it was executed (log2) [1 byte]
//  6. first execution frame [4 bytes]
//  7. last execution frame [4 bytes]
//  8. up to 5 previous PCs [10 bytes]
// For data:
//  1. up to 5 offsets that read the data [10 bytes]
//  2. value(s) of X,Y when the data was read [~128 bytes]
//  3. how many times it was read (log2) [1 byte]
//  4. how many frames it was read (log2) [1 byte]
//  5. first read frame [4 bytes]
//  6. last read frame [4 bytes]
// For CHR:
//  1. rendered as a sprite (any of 4 flips, or 8x16 mode)?
//  2. rendered as background?
//  3. color palette?????
// For RAM:
//  1. all possible values [~32 bytes]

// Unpacked, this is a lot of data.  Each "all possible" is up to 256 bits,
// or 32 bytes in a bitmap.  We need to worry about how to efficiently store
// the data both in memory and on disk.  We use bigint for the in-memory
// representation, allowing that it may occupy a gigabyte or more.  On disk
// we adopt a more flexible protocol: a set begins with a signed varint.  If
// the varint is positive then it indicates a length-delimited list of bytes.
// If it is negative then the varint itself is the negative of the bitmap.

// The data is split into three files: *.prg.cdl has PRG coverage, *.chr.cdl
// has CHR coverage, and *.ram.cdl has the RAM coverage.

// The PRG file starts with a TOC containing two bytes per PRG byte.  Each
// entry is (size of full entry << 2) | (code ? 2) | (data ? 1).  For
// uncovered addresses, this is exactly `00 00`.  This allows seeing quick
// coverage data at a glance.  At the end of the TOC is `ff ff`.
// After the TOC is the data, in order.  Each entry contains the following
// variable-width data:
//   1. total # accesses - varint
//   2. total # accessed frames - varint
//   3. first accessed frame - varint
//   4. last accessed frame - varint
//   5. If code: 8 coverage sets: X, Y, A, P, bank0, bank1, bank2, bank3
//      if a coverage set is the _same_ as the previous non-empty
//      instruction, it is omitted and replaced with FF (otherwise nonsense)
//      If not code (data only): 2 coverage sets: X, Y
// TODO - this is not included yet
//   6. If code: up to 5 previous PC addresses (non-offset, till EOF)

// The CHR file contains a single uint32 per 16-byte tile:
//   1. upper 8 bits is (bg ? 40) | (16x8 ? 20) | (8x8 ? 10) |
//                      (hvflip ? 8) | (vflip ? 4) | (hflip ? 2) | (normal ? 1)
//   2. lower 24 bits is (pal3 << 18) | (pal2 << 12) | (pal1 << 6) | (pal0)

// The RAM file contains a TOC of uint8 sizes for values written to RAM.
//   => 64k TOC, then a single coverage set for the actual value written to each

export class CodeDataLog {
  constructor(nes) {
    // NOTE: nes can be just {rom} if necessary.
    this.nes = nes;
    this.prg = new Uint8Array(nes.rom.rom.length);
    this.first = new Uint32Array(nes.rom.rom.length).fill(0xffffffff);
    this.last = new Uint32Array(nes.rom.rom.length);
    this.count = new Uint32Array(nes.rom.rom.length);
    this.frameCount = new Uint32Array(nes.rom.rom.length);
    this.prgX = new Uint8Array(nes.rom.rom.length << 5);
    this.prgY = new Uint8Array(nes.rom.rom.length << 5);
    this.prgA = new Uint8Array(nes.rom.rom.length << 5);
    this.prgP = new Uint8Array(nes.rom.rom.length << 5);
    this.banks = [
      new Uint8Array(nes.rom.rom.length << 5),
      new Uint8Array(nes.rom.rom.length << 5),
      new Uint8Array(nes.rom.rom.length << 5),
      new Uint8Array(nes.rom.rom.length << 5),
    ];
    this.lastPc = null;
    this.refs = Array.from(nes.rom.rom, () => new Set());
    this.ram = new Uint8Array(0x8000 << 5);
    this.chr = new Uint32Array(nes.rom.vrom.length >>> 4);
    //this.lastAddr;
  }

  // Makes sure bigint works before instantiating
  static make(nes) {
    if (typeof BigInt === 'function' && typeof BigInt(0) === 'bigint') {
      return new CodeDataLog(nes);
    }
    return null;
  }

  serializeRam() {
    const bytes = new Array(0x8000).fill(0);
    for (let i = 0; i < 0x8000; i++) {
      if (isEmpty(this.ram, i)) continue;
      let size = bytes.length;
      pushSet(bytes, this.ram, i);
      bytes[i] = bytes.length - size;
    }
    return Uint8Array.from(bytes);
  }

  serializeChr() {
    const bytes = [];
    for (const elem of this.chr) {
      bytes.push(elem & 0xff);
      bytes.push(elem >>> 8 & 0xff);
      bytes.push(elem >>> 16 & 0xff);
      bytes.push(elem >>> 24 & 0xff);
    }
    return Uint8Array.from(bytes);
  }

  serializePrg() {
    const bytes = new Array(this.nes.rom.rom.length * 2).fill(0);
    for (let i = 0; i < this.nes.rom.rom.length; i++) {
      const cd = this.prg[i];
      if (!cd) continue;
      const start = bytes.length;
      pushVarint(bytes, this.count[i]);
      pushVarint(bytes, this.frameCount[i]);
      pushVarint(bytes, this.first[i]);
      pushVarint(bytes, this.last[i]);
      maybePushSet(bytes, this.prgX, i);
      maybePushSet(bytes, this.prgY, i);
      if (cd & 2) {
        maybePushSet(bytes, this.prgA, i);
        maybePushSet(bytes, this.prgP, i);
        maybePushSet(bytes, this.banks[0], i);
        maybePushSet(bytes, this.banks[1], i);
        maybePushSet(bytes, this.banks[2], i);
        maybePushSet(bytes, this.banks[3], i);
      }
      for (const ref of this.refs[i]) {
        pushVarint(bytes, ref);
      }
      const size = (bytes.length - start) << 2 | cd;
      bytes[i << 1] = size & 0xff;
      bytes[i << 1 | 1] = size >>> 8;
    }
    return Uint8Array.from(bytes);
  }

  mergeRam(bytes) {
    let cursor = 0x8000;
    for (let i = 0; i < 0x8000; i++) {
      const size = bytes[i];
      if (!size) continue;
      if (readSet(bytes, cusor, this.ram, i) !== size) {
        throw new Error(`size mismatch`);
      }
      cursor += size;
    }
  }

  mergeChr(bytes) {
    for (let i = 0; i < bytes.length; i += 4) {
      this.chr[i >>> 2] =
          bytes[i] | bytes[i + 1] << 8 |
          bytes[i + 2] << 16 | bytes[i + 3] << 24;
    }
  }

  mergePrg(bytes) {
    let cursor = this.nes.rom.rom.length << 1;
    let last;
    for (let i = 0; i < this.nes.rom.rom.length; i++) {
      const head = bytes[2 * i] | bytes[2 * i + 1] << 8;
      const cd = head & 3;
      const size = head >>> 2;
      if (!cd || !size) continue;
      const block = bytes.subarray(cursor, cursor + size);
      cursor += size;
      let j = 0;
      let s;
      [this.count[i], s] = readVarint(bytes, j);
      j += s;
      [this.frameCount[i], s] = readVarint(bytes, j);
      j += s;
      [this.first[i], s] = readVarint(bytes, j);
      j += s;
      [this.last[i], s] = readVarint(bytes, j);
      last = Math.max(last, this.last[i]);
      j += s;
      j += readSet(bytes, j, this.prgX, i);
      j += readSet(bytes, j, this.prgY, i);
      if (cd & 2) {
        j += readSet(bytes, j, this.prgA, i);
        j += readSet(bytes, j, this.prgP, i);
        j += readSet(bytes, j, this.banks[0], i);
        j += readSet(bytes, j, this.banks[1], i);
        j += readSet(bytes, j, this.banks[2], i);
        j += readSet(bytes, j, this.banks[3], i);
      }
      while (j < block.size && this.refs[i].size < 5) {
        const [ref, s1] = readVarint(bytes, j);
        this.refs[i].add(ref);
        j += s1;
      }
    }
    this.ppu.frame = last;
  }

  logExec(addr) {
    if (addr < 0x8000) return;
    addr =
        this.nes.mmap.prgBanks[(addr >>> 13) & 3].byteOffset | (addr & 0x1fff);
    this.prg[addr] |= 2;
    if (this.lastPc != null) {
      if (this.refs[addr].size < 5) this.refs[addr].add(this.lastPc);
    }
    this.lastPc = addr;
    const frame = this.nes.ppu.frame;
    if (this.first[addr] === 0xffffffff) {
      this.first[addr] = frame;
    }
    this.count[addr]++;
    if (this.last[addr] === frame) {
      this.frameCount[addr]++;
    } else {
      this.last[addr] = frame;
    }
    logSet(this.prgX, addr, this.nes.cpu.REG_X);
    logSet(this.prgY, addr, this.nes.cpu.REG_Y);
    logSet(this.prgA, addr, this.nes.cpu.REG_A);
    logSet(this.prgP, addr, this.nes.cpu.getStatus());
    for (let i = 0; i < 4; i++) {
      logSet(this.banks[i], addr, this.nes.mmap.prgBankIndex(i));
    }
  }

  logRead(addr) {
    if (addr < 0x8000) return;
    addr =
        this.nes.mmap.prgBanks[(addr >>> 13) & 3].byteOffset | (addr & 0x1fff);
    this.prg[addr] |= 1;
    if (this.refs[addr].size < 5) this.refs[addr].add(this.lastPc);
    const frame = this.nes.ppu.frame;
    if (this.first[addr] === 0xffffffff) {
      this.first[addr] = frame;
    }
    this.count[addr]++;
    if (this.last[addr] === frame) {
      this.frameCount[addr]++;
    } else {
      this.last[addr] = frame;
    }
    logSet(this.prgX, addr, this.nes.cpu.REG_X);
    logSet(this.prgY, addr, this.nes.cpu.REG_Y);
  }

  logSprite(tile, attr) {
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

  logWrite(addr, val) {
    logSet(this.ram, addr, val);
  }
}

function logSet(set, addr, val) {
  set[addr << 5 | val >>> 3] |= (1 << (val & 7));
}

function isEmpty(arr, addr) {
  for (let i = 0; i < 32; i++) {
    if (arr[addr << 5 | i]) return false;
  }
  return true;
}

function maybePushSet(arr, set, addr) {
  if (!addr) {
    pushSet(arr, set, addr);
    return;
  }
  let back = 1;
  const b = addr << 5;
  while (back <= 3 && back <= addr) {
    if (!isEmpty(arr, addr - back)) break;
    back++;
  }
  back <<= 5;
  for (let i = 0; i < 32; i++) {
    if (arr[b + i] !== arr[b + i - back]) {
      pushSet(arr, set, addr);
      return;
    }
  }
  arr.push(0x7f); // same as previous
}

function pushSet(arr, set, addr) {
  let max = 8; // minimum of 8 bits
  let bi = BigInt(0);
  const list = [];
  for (let i = 0; i < 256; i++) {
    if (arr[addr << 5 | i >>> 3] & (1 << (i & 7))) {
      max = i;
      bi |= BigInt(1) << BigInt(i);
      list.push(i);
    }
  }
  if (max > 7 * (list.length + 1)) {
    // sparse: use length-delimited list
    arr.push(list.length, ...list);
  } else {
    // dense: use a big varint
    pushSignedVarint(arr, -bi);
  }
}

// returns size
function readSet(bytes, offset, arr, addr) {
  const i0 = offset;
  let [first, s] = readSignedVarint(bytes, offset);
  offset += s;
  if (first === BigInt(0x7f)) {
    // look for previous entry to make a copy of
    let back = 1;
    const b = addr << 5;
    while (true) {
      if (!isEmpty(arr, addr - back)) break;
      if (++back > 3 || back > addr) throw new Error(`bad copy at ${addr}`);
    }
    back <<= 5;
    for (let j = 0; j < 32; j++) {
      arr[addr + j] = arr[addr + j - back];
    }
  } else if (first < BigInt(0)) {
    first = -first;
    for (let j = 0; j < 32; j++) {
      arr[addr + j] = first & BigInt(0xff);
      first >>>= BigInt(8);
    }
  } else {
    for (let j = 0; j < s; j++) {
      const x = bytes[offset++];
      arr[addr + (x >>> 3)] |= (1 << (x & 7));
    }
  }
  return offset - i0;
}

function pushVarint(arr, num) {
  const sbyte = SBYTE[typeof num];
  const sign = SIGN[typeof num];
  while (true) {
    if (num > sbyte) {
      arr.push(Number(sign | num & sbyte));
      num >>= 7;
    } else {
      arr.push(Number(num));
      break;
    }
  }
}

function pushSignedVarint(arr, num) {
  const zero = ZERO[typeof num];
  const one = ONE[typeof num];
  if (num < ZERO) {
    num = (~num) << ONE | ONE;
  } else {
    num <<= ONE;
  }
  pushVarint(arr, num);
}

// return [value: bigint, size: number]
function readVarint(arr, i) {
  let value = BigInt(0);
  let shift = BigInt(0);
  let offset = 0;
  while (arr[i + offset] & 0x80) {
    value |= BigInt(arr[i + offset] & 0x7f) << shift;
    offset++;
    shift += BigInt(7);
  }
  value |= BigInt(arr[i + offset]) << shift;
  return [value, offset + 1];
}

function readSignedVarint(arr, i) {
  const [v, s] = readVarint(arr, i);
  if (v & BigInt(1)) return [-(v >>> BigInt(1)), s];
  return [v >>> BigInt(1), s];
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
