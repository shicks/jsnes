require = require('esm')(module);
const {CodeDataLog} = require('./cdl.js');
const {affected, opdata, opmeta} = require('./opdata.js');
const {disassemble} = require('./disassembler.js');
const fs = require('fs');

// TODO - make some sort of fact engine?
//   e.g. "offset X at cpu Y has banks Z,W loaded and A=42"
//        "cpu Y with banks from offset X is code"
//        "write to 8000 at X"

// Working in passes seems like the way to go.
//  - given all known code spots, disassemble
//  - may not know what the banks are tho
//  - need to re-enter passes when we get more info...?
//  - go back and forth?
//  - change JSR $8123 to JSR $08123
//  - "needs bank" flag on code offsets?

function disasm(romFile, cdlFile) {
  const cdlData = new Uint8Array(fs.readFileSync(cdlFile).buffer);
  const cdl = new CodeDataLog();
  cdl.merge(cdlData);
  const rom = new Uint8Array(fs.readFileSync(romFile).buffer);
  const out = disassemble(rom, cdl);
  console.log(out);
}

function dump(file) {
  const data = new Uint8Array(fs.readFileSync(file).buffer);
  const cdl = new CodeDataLog();
  cdl.merge(data);
  function hex(a) {
    return [(a >> 16).toString(16).padStart(2, '0'),
            (a & 0xffff).toString(16).padStart(4, '0')].join(':');
  }
  for (const [addr, rec] of cdl.data) {
    let line = `${hex(addr)}: ${rec.first}..${rec.last} #${rec.count}`;
    if (rec.meta & 1) line += ' entry';
    if (rec.meta & 2) line += ' data';
    if (rec.meta & 4) line += ' immediate';
    if (rec.meta & 8) line += ' nametable';
    if (rec.meta & 16) line += ' oam';
    if (rec.meta & 32) line += ' chr';
    if (rec.meta & 64) line += ' index';
    if (rec.meta & 128) line += ' indirect';
    if (rec.meta & 256) line += ' jump';
    if (rec.meta & 512) line += ' palette';
    if (rec.indirect != null) line += ` (${hex(rec.indirect)})`;
    if (rec.refs.size) line += `\n  Refs: ${[...rec.refs].map(hex).join(', ')}`;
    if (rec.regs.size) line += `\n  Regs: ${[...rec.regs].map(hex).join(', ')}`;
    console.log(line);
  }
}

if (process.argv[2] === '-s') {
  // disassemble, need to read rom file
  disasm(process.argv[3], process.argv[4]);
} else {
  dump(process.argv[2]);
}
