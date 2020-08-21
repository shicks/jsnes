import {opdata, opmeta} from './opdata.js';

// interface OffsetData {
//   type: 'cont'|'code'|'byte'|'word';
//   preComment?: string;
//   postComment?: string;
//   label?: string;
//   address?: number; // 24-bit
//   arg?: number|string;
//   bytes?: number[];
//   usage?: Set<string>;
// }

const ARG_FORMATS = [
  [2, '%'], // zp
  [4, '%'], // rel
  [0, ''],  // imp
  [4, '%'], // abs
  [0, ''],  // acc
  [2, '#%'], // imm
  [2, '%,x'], // zp,x
  [2, '%,y'], // zp,y
  [4, '%,x'], // abs,x
  [4, '%,y'], // abs,y
  [2, '(%,x)'], // (zp,x) preind
  [2, '(%),y'], // (zp),y postind
  [4, '(%)'], // ind
];

function getOffset(fullAddr) {
  const bank = fullAddr >>> 16;
  const mem = fullAddr & 0x1fff;
  return bank << 13 | mem;
}

function hex(addr, sep = ':') {
  return (addr >>> 16).toString(16).padStart(2, '0') + sep +
      (addr & 0xffff).toString(16).padStart(4, '0');
}

function setBank(data, ref) {
  // Given an instruction with an absolute address, set the arg
  // to point to the given bank.  Returns the full address if applicable.
  if (data.bytes.length < 3) return null;
  const addr = data.bytes[1] | data.bytes[2] << 8 | (ref & 0xff0000);
  if (typeof data.arg !== 'string') data.arg = addr;
  return addr & 0x8000 ? addr : null;
}

function formatArg(data, size, fmt = '%', addrMode = undefined) {
  const bytes = data.bytes || [];
  let num = (bytes[1] | (bytes[2] || 0) << 8);
  if (typeof data.arg === 'number') {
    num = data.arg;
    size = data.arg < 0x6000 ? 4 : 6;
  } else if ((num & 0xe000) === (data.address & 0xe000)) {
    num |= (data.address & 0xff0000);
    size = 6;
  } else if (addrMode === 1) {
    num = data.address + ((num << 24) >> 24) + 1;
    size = 6;
  }
  const hexNum = size === 6 ? hex(num) : num.toString(16).padStart(size, '0');
  return typeof data.arg === 'string' ? data.arg :
         fmt.replace('%', '$' + hexNum);
}

function formatOp(data) {
  if (data.type !== 'code') throw new Error('expected code');
  const opinf = opdata[data.bytes[0]];
  const instr = opmeta.instname[opinf & 0xff].toLowerCase();
  const addrMode = (opinf >> 8) & 0xff;
  let [size, argFmt] = ARG_FORMATS[addrMode];
  if (!size) return instr;
  return instr + ' ' + formatArg(data, size, argFmt, addrMode);
}

// Given a ROM and a CodeDataLog, disassembles it into assembly source.
export function disassemble(rom, cdl) {
  // Start by making a table of entries.
  // As we disassemble, we can also add relative jumps even if never taken.
  // Also, absolute jumps if they're in the *same* bank?

  // Each entry will get fully disassembled until we hit either an
  // illegal opcode (incl. brk) or an abrupt exit (jmp, rts, rti).

  // As we hit PC values (offset, not mem?), we add them to a "seen" set
  // so that we only handle the same path once.

  const entries = new Set();
  for (const rec of cdl.data.values()) {
    if (rec.meta & 1) entries.add(rec.address);
  }

  // Set<rom offset>
  const extraLabels = new Set();
  // Array<rom offset, OffsetData>
  const offsets = [];
  for (const entry of entries) {
    const offset = getOffset(entry);
    if (offsets[offset] && offsets[offset].type !== 'cont') continue;
    const op = rom[offset];
    const opinf = opdata[op];
    let instr = opmeta.instname[opinf & 0xff];
    if (instr) instr = instr.toLowerCase();
    if (instr === 'brk' || !instr) continue;

    // Add continuations, entry for after the instruction
    const addrSize = opmeta.addrSize[(opinf >> 8) & 0xff] + 1;
    const bytes = [];
    for (let i = 0; i < addrSize; i++) {
      if (i && !offsets[offset]) offsets[offset + i] = {type: 'cont'};
      bytes.push(rom[offset + i]);
    }
    const code = {
      type: 'code',
      address: entry,
      bytes,
    };

    if (instr) {
      if (instr === 'jmp' || instr === 'rts' || instr === 'rts') {
        // no continue: add an abrupt comment
        code.postComment = ';;; --------------------------------';
      } else {
        // continues
        entries.add(entry + addrSize);
      }
    }
    // Add entry for relative jumps, or absolute jumps to same bank
    const addrMode = (opinf >> 8) & 0xff;
    if (addrMode === 1) { // relative
      entries.add(entry + ((bytes[1] << 24) >> 24) + 2);
    }
    offsets[offset] = code;
  }

  // Now go through all of the coverage data again
  for (const rec of cdl.data.values()) {
    const offset = getOffset(rec.address);
    if (rec.meta & 1) { // entry
      const data = offsets[offset];
      if (!data) throw new Error(`missing entry: ${hex(rec.address)}`);
      const label = `Entry_${hex(rec.address, '_')}`;
      data.label = label;
      for (const ref of rec.refs) {
        const refData = offsets[getOffset(ref)];
        if (refData && refData.type === 'code') refData.arg = label;
      }
    }
    if (rec.meta & 2) { // non-immediate data - save bank for each ref
      for (const ref of rec.refs) {
        const refData = offsets[getOffset(ref)];
        if (refData && refData.type === 'code') {
          const addr = setBank(refData, rec.address);
          if (addr != null) extraLabels.add(getOffset(addr));
        }
      }
    }
    if (rec.indirect != null) { // typically either JUMP or INDIRECT
      // see if it's a direct word in memory, if so update indirect
      if (!offsets[offset]) {
        const data = rom[offset] | rom[offset + 1] << 8;
        if (data === (rec.indirect & 0xffff)) {
          extraLabels.add(getOffset(rec.indirect));
          offsets[offset] = {
            type: 'word',
            address: rec.address,
            arg: rec.indirect,
            bytes: [...rom.slice(offset, offset + 2)],
          };
          offsets[offset + 1] = {type: 'cont'};
        }
      }
    }
    const data = offsets[offset] || (offsets[offset] = {
      type: 'byte',
      address: rec.address,
    });
    const usage = data.usage || (data.usage = new Set());
    if (rec.meta & 8) usage.add('bg');
    if (rec.meta & 0x10) usage.add('spr');
    if (rec.meta & 0x20) usage.add('chr');
    if (rec.meta & 0x100) usage.add('jump');
    if (rec.meta & 0x200) usage.add('pal');
    for (const reg of rec.regs || []) {
      if (reg >= 0x4000 && reg <= 0x4017 && reg !== 0x4014) usage.add('apu');
    }
  }

  for (let i = 0; i < offsets.length; i++) {
    const data = offsets[i];
    if (data && !data.label && extraLabels.has(i)) {
      // TODO - can we distinguish jump tables?
      data.label = `Data_${hex(data.address, '_')}`;
    }
  }

  // Finally iterate over offsets and produce the disassembly.
  const lines = [];
  let bytes = [];
  const byteComment = new Set();
  let bytesCovered = false;
  let byteStartAddress = 0;
  let offset = 0;
  function emitBytes() {
    if (!bytes.length) return;
    if (!bytesCovered) byteComment.add('miss');
    let comment = [...byteComment].join(', ');
    if (comment) comment = `  ; ${comment}`;
    lines.push(`        $${hex(byteStartAddress)}              .byte $${
                           bytes.map(b => b.toString(16)
                                           .padStart(2, '0')).join(',$')}${
                           comment}`);
    bytes = [];
    byteComment.clear();
    bytesCovered = false;
  }
  let bank = 0x008000;
  while (offset < rom.length) {
    if (bytes.length === 16) emitBytes();
    const data = offsets[offset] || {type: 'byte', unused: true};
    if (data.preComment) lines.push(data.preComment);
    if (data.address != null) {
      bank = data.address & 0xffe000;
    } else {
      const page = offset >>> 13;
      // if page changed, pick new bank
      if (page !== (bank >>> 16)) bank = page << 16 | (page & 1) << 13 | 0x8000;
      data.address = (offset & 0x1fff) | bank;
      //if ((data.address & 0xf000) === 0x2000) debugger;
    }
    if (data.type !== 'byte' || data.label) emitBytes();
    if (data.label) lines.push(data.label + ':');
    if (data.type === 'cont') {
      // do nothing
    } else if (data.type === 'word') {
      const bytes = data.bytes.map(x => x.toString(16).padStart(2, '0'));
      let comment = [...(data.usage || [])].join(', ');
      if (comment) comment = `  ; ${comment}`;
      lines.push(`        $${hex(data.address)}   ${
                             bytes.join(' ').padEnd(8, ' ')}   .word (${
                             formatArg(data, 4, '%')})${comment}`);
    } else if (data.type === 'code') {
      const bytes = data.bytes.map(x => x.toString(16).padStart(2, '0'));
      lines.push(`        $${hex(data.address)}   ${
                             bytes.join(' ').padEnd(8, ' ')}   ${
                             formatOp(data)}`);
    } else if (data.type === 'byte') {
      if (!data.unused) bytesCovered = true;
      for (const usage of data.usage || []) {
        byteComment.add(usage);
      }
      if (!bytes.length) {
        byteStartAddress = data.address ||
                           ((offset & 0x1fff) | (offset >>> 16) << 13);
      }
      bytes.push(rom[offset]);
    }
    if (data.postComment) lines.push(data.postComment);
    offset++;
  }
  emitBytes();

  return lines.join('\n');
}

const EMPTY = {has() { return false; }};
