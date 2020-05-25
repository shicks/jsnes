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
//   1. log(total # accesses) - varint
//   2. log(total # accessed frames) - varint
//   3. first accessed frame - varint
//   4. last accessed frame - varint
//   5. If code: 8 coverage sets: X, Y, A, P, bank0, bank1, bank2, bank3
//      if a coverage set is the _same_ as the previous non-empty
//      instruction, it is omitted and replaced with FF (otherwise nonsense)
//      If not code (data only): 2 coverage sets: X, Y
//   6. If code: up to 5 previous PC addresses (non-offset, till EOF)

// The CHR file contains a single uint32 per 16-byte tile:
//   1. upper 8 bits is (bg ? 40) | (16x8 ? 20) | (8x8 ? 10) |
//                      (hvflip ? 8) | (vflip ? 4) | (hflip ? 2) | (normal ? 1)
//   2. lower 24 bits is (pal3 << 18) | (pal2 << 12) | (pal1 << 6) | (pal0)

// The RAM file contains a TOC of uint8 sizes for values written to RAM.
//   => 64k TOC, then a single coverage set for the actual value written to each

export class CodeDataLog {
  
}
