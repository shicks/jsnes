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
  constructor(nes, size = 0x1000000) { // default to 16MB
    size &= ~0xff; // size must be a multiple of 256
    this.nes = nes;
    this.buffer = new Uint8Array(size);
    this.size = size;
    this.pos = 0;
  }

  logCpu(opcode, pc) {
    const bank = this.nes.banks[pc >>> 13];
    const len = 4 + (bank != null)
    // pad up to the next block if necessary
    while ((this.pos + len ^ this.pos) & 0x100) this.buffer[this.pos++] = 0;
    if (this.pos == this.size) this.pos = 0;
    this.buffer[this.pos++] = 1 | (bank != null ? PAGED : 0);
    this.buffer[this.pos++] = opcode;
    this.buffer[this.pos++] = pc;
    this.buffer[this.pos++] = pc >>> 8;
    if (bank != null) this.buffer[this.pos++] = bank;
    // TODO - consider acting on a breakpoint?
  }

  logMem(op, address, value, write = -1) {
    const bank = this.nes.banks[address >>> 13];
    if (bank != null) op |= PAGED;
    const len = LEN_BY_OP[op];
    if (len == 0) {
      console.log('Bad memory log: ' + op + ' at ' + address.toString(16));
      return;
    }
    while ((this.pos + len ^ this.pos) & 0x100) this.buffer[this.pos++] = 0;
    this.buffer[this.pos++] = op;
    this.buffer[this.pos++] = address;
    this.buffer[this.pos++] = address >>> 8;
    if (op & PAGED) this.buffer[this.pos++] = bank;
    this.buffer[this.pos++] = value;
    if (op & MEM_WORD) this.buffer[this.pos++] = value >>> 8;
    if (write >= 0) this.buffer[this.pos++] = write;
  }

  logOther(op) {
    if (this.pos == this.size) this.pos = 0;
    this.buffer[this.pos++] = op;
  }

  /**
   * @param {function(opcode, pc, pcrom)} cpu
   * @param {function(addr, addrrom, read = undefined, written = undefined)} mem
   * @param {function(op)} other
   */
  visitLog({cpu, mem, other} = {}, count = Infinity) {
    count = Math.min(this.size - 1, count);
    let pos = (this.pos + this.size - count) & ~0xff;
    if (pos < this.pos) pos += 0x100;
    pos %= this.size;
    
    while (pos != this.pos) {
      if (pos == this.size) pos = 0;
      const selector = this.buffer[pos++];
      switch (selector & 3) {
      case 0: // skip
        continue;
      case 1: { // cpu
        const op = this.buffer[pos++];
        const addr = this.buffer[pos++] | (this.buffer[pos++] << 8);
        const romaddr =
            selector & PAGED ? (addr & 0x1fff) | (this.buffer[pos++] << 13) : addr;
        cpu && cpu(op, addr, romaddr);
        break;
      }
      case 2: { // mem
        const addr = this.buffer[pos++] | (this.buffer[pos++] << 8);
        const romaddr =
            selector & PAGED ? (addr & 0x1fff) | (this.buffer[pos++] << 13) : addr;
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
        other && other(selector);
        break;
      }
      default:
      }
    }
  }
}

// To pass as first arg of logMem
Debug.MEM_RD   = 0b00010010;
Debug.MEM_RD16 = 0b00011010;
Debug.MEM_WR   = 0b00100010;
Debug.MEM_RW   = 0b00110010;
// To pass as first arg or logOther
Debug.VBLANK_START = 0b00000111;
Debug.VBLANK_END   = 0b00000011;

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
