import * as utils from './utils.js';

// TODO - pull out all the prototype properties into module constants.
// Consider just making this a few simple exported tables?

// Generates and provides an array of details about instructions
export const OpMeta = function() {
  this.opdata = new Uint32Array(256);

  // Set all to invalid instruction (to detect crashes):
  for (var i = 0; i < 256; i++) this.opdata[i] = 0xff;

  // Now fill in all valid opcodes:
  // TODO(sdh): we can derive the size from the addressing mode,
  // so remove the parameter and instead look up in a table.

  // ADC:
  this.setOp(this.INS_ADC, 0x69, this.ADDR_IMM, 2, 2);
  this.setOp(this.INS_ADC, 0x65, this.ADDR_ZP, 2, 3);
  this.setOp(this.INS_ADC, 0x75, this.ADDR_ZPX, 2, 4);
  this.setOp(this.INS_ADC, 0x6d, this.ADDR_ABS, 3, 4);
  this.setOp(this.INS_ADC, 0x7d, this.ADDR_ABSX, 3, 4);
  this.setOp(this.INS_ADC, 0x79, this.ADDR_ABSY, 3, 4);
  this.setOp(this.INS_ADC, 0x61, this.ADDR_PREIDXIND, 2, 6);
  this.setOp(this.INS_ADC, 0x71, this.ADDR_POSTIDXIND, 2, 5);

  // AND:
  this.setOp(this.INS_AND, 0x29, this.ADDR_IMM, 2, 2);
  this.setOp(this.INS_AND, 0x25, this.ADDR_ZP, 2, 3);
  this.setOp(this.INS_AND, 0x35, this.ADDR_ZPX, 2, 4);
  this.setOp(this.INS_AND, 0x2d, this.ADDR_ABS, 3, 4);
  this.setOp(this.INS_AND, 0x3d, this.ADDR_ABSX, 3, 4);
  this.setOp(this.INS_AND, 0x39, this.ADDR_ABSY, 3, 4);
  this.setOp(this.INS_AND, 0x21, this.ADDR_PREIDXIND, 2, 6);
  this.setOp(this.INS_AND, 0x31, this.ADDR_POSTIDXIND, 2, 5);

  // ASL:
  this.setOp(this.INS_ASL, 0x0a, this.ADDR_ACC, 1, 2);
  this.setOp(this.INS_ASL, 0x06, this.ADDR_ZP, 2, 5);
  this.setOp(this.INS_ASL, 0x16, this.ADDR_ZPX, 2, 6);
  this.setOp(this.INS_ASL, 0x0e, this.ADDR_ABS, 3, 6);
  this.setOp(this.INS_ASL, 0x1e, this.ADDR_ABSX, 3, 7);

  // BCC:
  this.setOp(this.INS_BCC, 0x90, this.ADDR_REL, 2, 2);

  // BCS:
  this.setOp(this.INS_BCS, 0xb0, this.ADDR_REL, 2, 2);

  // BEQ:
  this.setOp(this.INS_BEQ, 0xf0, this.ADDR_REL, 2, 2);

  // BIT:
  this.setOp(this.INS_BIT, 0x24, this.ADDR_ZP, 2, 3);
  this.setOp(this.INS_BIT, 0x2c, this.ADDR_ABS, 3, 4);

  // BMI:
  this.setOp(this.INS_BMI, 0x30, this.ADDR_REL, 2, 2);

  // BNE:
  this.setOp(this.INS_BNE, 0xd0, this.ADDR_REL, 2, 2);

  // BPL:
  this.setOp(this.INS_BPL, 0x10, this.ADDR_REL, 2, 2);

  // BRK:
  this.setOp(this.INS_BRK, 0x00, this.ADDR_IMP, 1, 7);

  // BVC:
  this.setOp(this.INS_BVC, 0x50, this.ADDR_REL, 2, 2);

  // BVS:
  this.setOp(this.INS_BVS, 0x70, this.ADDR_REL, 2, 2);

  // CLC:
  this.setOp(this.INS_CLC, 0x18, this.ADDR_IMP, 1, 2);

  // CLD:
  this.setOp(this.INS_CLD, 0xd8, this.ADDR_IMP, 1, 2);

  // CLI:
  this.setOp(this.INS_CLI, 0x58, this.ADDR_IMP, 1, 2);

  // CLV:
  this.setOp(this.INS_CLV, 0xb8, this.ADDR_IMP, 1, 2);

  // CMP:
  this.setOp(this.INS_CMP, 0xc9, this.ADDR_IMM, 2, 2);
  this.setOp(this.INS_CMP, 0xc5, this.ADDR_ZP, 2, 3);
  this.setOp(this.INS_CMP, 0xd5, this.ADDR_ZPX, 2, 4);
  this.setOp(this.INS_CMP, 0xcd, this.ADDR_ABS, 3, 4);
  this.setOp(this.INS_CMP, 0xdd, this.ADDR_ABSX, 3, 4);
  this.setOp(this.INS_CMP, 0xd9, this.ADDR_ABSY, 3, 4);
  this.setOp(this.INS_CMP, 0xc1, this.ADDR_PREIDXIND, 2, 6);
  this.setOp(this.INS_CMP, 0xd1, this.ADDR_POSTIDXIND, 2, 5);

  // CPX:
  this.setOp(this.INS_CPX, 0xe0, this.ADDR_IMM, 2, 2);
  this.setOp(this.INS_CPX, 0xe4, this.ADDR_ZP, 2, 3);
  this.setOp(this.INS_CPX, 0xec, this.ADDR_ABS, 3, 4);

  // CPY:
  this.setOp(this.INS_CPY, 0xc0, this.ADDR_IMM, 2, 2);
  this.setOp(this.INS_CPY, 0xc4, this.ADDR_ZP, 2, 3);
  this.setOp(this.INS_CPY, 0xcc, this.ADDR_ABS, 3, 4);

  // DEC:
  this.setOp(this.INS_DEC, 0xc6, this.ADDR_ZP, 2, 5);
  this.setOp(this.INS_DEC, 0xd6, this.ADDR_ZPX, 2, 6);
  this.setOp(this.INS_DEC, 0xce, this.ADDR_ABS, 3, 6);
  this.setOp(this.INS_DEC, 0xde, this.ADDR_ABSX, 3, 7);

  // DEX:
  this.setOp(this.INS_DEX, 0xca, this.ADDR_IMP, 1, 2);

  // DEY:
  this.setOp(this.INS_DEY, 0x88, this.ADDR_IMP, 1, 2);

  // EOR:
  this.setOp(this.INS_EOR, 0x49, this.ADDR_IMM, 2, 2);
  this.setOp(this.INS_EOR, 0x45, this.ADDR_ZP, 2, 3);
  this.setOp(this.INS_EOR, 0x55, this.ADDR_ZPX, 2, 4);
  this.setOp(this.INS_EOR, 0x4d, this.ADDR_ABS, 3, 4);
  this.setOp(this.INS_EOR, 0x5d, this.ADDR_ABSX, 3, 4);
  this.setOp(this.INS_EOR, 0x59, this.ADDR_ABSY, 3, 4);
  this.setOp(this.INS_EOR, 0x41, this.ADDR_PREIDXIND, 2, 6);
  this.setOp(this.INS_EOR, 0x51, this.ADDR_POSTIDXIND, 2, 5);

  // INC:
  this.setOp(this.INS_INC, 0xe6, this.ADDR_ZP, 2, 5);
  this.setOp(this.INS_INC, 0xf6, this.ADDR_ZPX, 2, 6);
  this.setOp(this.INS_INC, 0xee, this.ADDR_ABS, 3, 6);
  this.setOp(this.INS_INC, 0xfe, this.ADDR_ABSX, 3, 7);

  // INX:
  this.setOp(this.INS_INX, 0xe8, this.ADDR_IMP, 1, 2);

  // INY:
  this.setOp(this.INS_INY, 0xc8, this.ADDR_IMP, 1, 2);

  // JMP:
  this.setOp(this.INS_JMP, 0x4c, this.ADDR_ABS, 3, 3);
  this.setOp(this.INS_JMP, 0x6c, this.ADDR_INDABS, 3, 5);

  // JSR:
  this.setOp(this.INS_JSR, 0x20, this.ADDR_ABS, 3, 6);

  // LDA:
  this.setOp(this.INS_LDA, 0xa9, this.ADDR_IMM, 2, 2);
  this.setOp(this.INS_LDA, 0xa5, this.ADDR_ZP, 2, 3);
  this.setOp(this.INS_LDA, 0xb5, this.ADDR_ZPX, 2, 4);
  this.setOp(this.INS_LDA, 0xad, this.ADDR_ABS, 3, 4);
  this.setOp(this.INS_LDA, 0xbd, this.ADDR_ABSX, 3, 4);
  this.setOp(this.INS_LDA, 0xb9, this.ADDR_ABSY, 3, 4);
  this.setOp(this.INS_LDA, 0xa1, this.ADDR_PREIDXIND, 2, 6);
  this.setOp(this.INS_LDA, 0xb1, this.ADDR_POSTIDXIND, 2, 5);

  // LDX:
  this.setOp(this.INS_LDX, 0xa2, this.ADDR_IMM, 2, 2);
  this.setOp(this.INS_LDX, 0xa6, this.ADDR_ZP, 2, 3);
  this.setOp(this.INS_LDX, 0xb6, this.ADDR_ZPY, 2, 4);
  this.setOp(this.INS_LDX, 0xae, this.ADDR_ABS, 3, 4);
  this.setOp(this.INS_LDX, 0xbe, this.ADDR_ABSY, 3, 4);

  // LDY:
  this.setOp(this.INS_LDY, 0xa0, this.ADDR_IMM, 2, 2);
  this.setOp(this.INS_LDY, 0xa4, this.ADDR_ZP, 2, 3);
  this.setOp(this.INS_LDY, 0xb4, this.ADDR_ZPX, 2, 4);
  this.setOp(this.INS_LDY, 0xac, this.ADDR_ABS, 3, 4);
  this.setOp(this.INS_LDY, 0xbc, this.ADDR_ABSX, 3, 4);

  // LSR:
  this.setOp(this.INS_LSR, 0x4a, this.ADDR_ACC, 1, 2);
  this.setOp(this.INS_LSR, 0x46, this.ADDR_ZP, 2, 5);
  this.setOp(this.INS_LSR, 0x56, this.ADDR_ZPX, 2, 6);
  this.setOp(this.INS_LSR, 0x4e, this.ADDR_ABS, 3, 6);
  this.setOp(this.INS_LSR, 0x5e, this.ADDR_ABSX, 3, 7);

  // NOP:
  this.setOp(this.INS_NOP, 0xea, this.ADDR_IMP, 1, 2);

  // ORA:
  this.setOp(this.INS_ORA, 0x09, this.ADDR_IMM, 2, 2);
  this.setOp(this.INS_ORA, 0x05, this.ADDR_ZP, 2, 3);
  this.setOp(this.INS_ORA, 0x15, this.ADDR_ZPX, 2, 4);
  this.setOp(this.INS_ORA, 0x0d, this.ADDR_ABS, 3, 4);
  this.setOp(this.INS_ORA, 0x1d, this.ADDR_ABSX, 3, 4);
  this.setOp(this.INS_ORA, 0x19, this.ADDR_ABSY, 3, 4);
  this.setOp(this.INS_ORA, 0x01, this.ADDR_PREIDXIND, 2, 6);
  this.setOp(this.INS_ORA, 0x11, this.ADDR_POSTIDXIND, 2, 5);

  // PHA:
  this.setOp(this.INS_PHA, 0x48, this.ADDR_IMP, 1, 3);

  // PHP:
  this.setOp(this.INS_PHP, 0x08, this.ADDR_IMP, 1, 3);

  // PLA:
  this.setOp(this.INS_PLA, 0x68, this.ADDR_IMP, 1, 4);

  // PLP:
  this.setOp(this.INS_PLP, 0x28, this.ADDR_IMP, 1, 4);

  // ROL:
  this.setOp(this.INS_ROL, 0x2a, this.ADDR_ACC, 1, 2);
  this.setOp(this.INS_ROL, 0x26, this.ADDR_ZP, 2, 5);
  this.setOp(this.INS_ROL, 0x36, this.ADDR_ZPX, 2, 6);
  this.setOp(this.INS_ROL, 0x2e, this.ADDR_ABS, 3, 6);
  this.setOp(this.INS_ROL, 0x3e, this.ADDR_ABSX, 3, 7);

  // ROR:
  this.setOp(this.INS_ROR, 0x6a, this.ADDR_ACC, 1, 2);
  this.setOp(this.INS_ROR, 0x66, this.ADDR_ZP, 2, 5);
  this.setOp(this.INS_ROR, 0x76, this.ADDR_ZPX, 2, 6);
  this.setOp(this.INS_ROR, 0x6e, this.ADDR_ABS, 3, 6);
  this.setOp(this.INS_ROR, 0x7e, this.ADDR_ABSX, 3, 7);

  // RTI:
  this.setOp(this.INS_RTI, 0x40, this.ADDR_IMP, 1, 6);

  // RTS:
  this.setOp(this.INS_RTS, 0x60, this.ADDR_IMP, 1, 6);

  // SBC:
  this.setOp(this.INS_SBC, 0xe9, this.ADDR_IMM, 2, 2);
  this.setOp(this.INS_SBC, 0xe5, this.ADDR_ZP, 2, 3);
  this.setOp(this.INS_SBC, 0xf5, this.ADDR_ZPX, 2, 4);
  this.setOp(this.INS_SBC, 0xed, this.ADDR_ABS, 3, 4);
  this.setOp(this.INS_SBC, 0xfd, this.ADDR_ABSX, 3, 4);
  this.setOp(this.INS_SBC, 0xf9, this.ADDR_ABSY, 3, 4);
  this.setOp(this.INS_SBC, 0xe1, this.ADDR_PREIDXIND, 2, 6);
  this.setOp(this.INS_SBC, 0xf1, this.ADDR_POSTIDXIND, 2, 5);

  // SEC:
  this.setOp(this.INS_SEC, 0x38, this.ADDR_IMP, 1, 2);

  // SED:
  this.setOp(this.INS_SED, 0xf8, this.ADDR_IMP, 1, 2);

  // SEI:
  this.setOp(this.INS_SEI, 0x78, this.ADDR_IMP, 1, 2);

  // STA:
  this.setOp(this.INS_STA, 0x85, this.ADDR_ZP, 2, 3);
  this.setOp(this.INS_STA, 0x95, this.ADDR_ZPX, 2, 4);
  this.setOp(this.INS_STA, 0x8d, this.ADDR_ABS, 3, 4);
  this.setOp(this.INS_STA, 0x9d, this.ADDR_ABSX, 3, 5);
  this.setOp(this.INS_STA, 0x99, this.ADDR_ABSY, 3, 5);
  this.setOp(this.INS_STA, 0x81, this.ADDR_PREIDXIND, 2, 6);
  this.setOp(this.INS_STA, 0x91, this.ADDR_POSTIDXIND, 2, 6);

  // STX:
  this.setOp(this.INS_STX, 0x86, this.ADDR_ZP, 2, 3);
  this.setOp(this.INS_STX, 0x96, this.ADDR_ZPY, 2, 4);
  this.setOp(this.INS_STX, 0x8e, this.ADDR_ABS, 3, 4);

  // STY:
  this.setOp(this.INS_STY, 0x84, this.ADDR_ZP, 2, 3);
  this.setOp(this.INS_STY, 0x94, this.ADDR_ZPX, 2, 4);
  this.setOp(this.INS_STY, 0x8c, this.ADDR_ABS, 3, 4);

  // TAX:
  this.setOp(this.INS_TAX, 0xaa, this.ADDR_IMP, 1, 2);

  // TAY:
  this.setOp(this.INS_TAY, 0xa8, this.ADDR_IMP, 1, 2);

  // TSX:
  this.setOp(this.INS_TSX, 0xba, this.ADDR_IMP, 1, 2);

  // TXA:
  this.setOp(this.INS_TXA, 0x8a, this.ADDR_IMP, 1, 2);

  // TXS:
  this.setOp(this.INS_TXS, 0x9a, this.ADDR_IMP, 1, 2);

  // TYA:
  this.setOp(this.INS_TYA, 0x98, this.ADDR_IMP, 1, 2);

  // prettier-ignore
  this.cycTable = new Array(
    /*0x00*/ 7,6,2,8,3,3,5,5,3,2,2,2,4,4,6,6,
    /*0x10*/ 2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7,
    /*0x20*/ 6,6,2,8,3,3,5,5,4,2,2,2,4,4,6,6,
    /*0x30*/ 2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7,
    /*0x40*/ 6,6,2,8,3,3,5,5,3,2,2,2,3,4,6,6,
    /*0x50*/ 2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7,
    /*0x60*/ 6,6,2,8,3,3,5,5,4,2,2,2,5,4,6,6,
    /*0x70*/ 2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7,
    /*0x80*/ 2,6,2,6,3,3,3,3,2,2,2,2,4,4,4,4,
    /*0x90*/ 2,6,2,6,4,4,4,4,2,5,2,5,5,5,5,5,
    /*0xA0*/ 2,6,2,6,3,3,3,3,2,2,2,2,4,4,4,4,
    /*0xB0*/ 2,5,2,5,4,4,4,4,2,4,2,4,4,4,4,4,
    /*0xC0*/ 2,6,2,8,3,3,5,5,2,2,2,2,4,4,6,6,
    /*0xD0*/ 2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7,
    /*0xE0*/ 2,6,3,8,3,3,5,5,2,2,2,2,4,4,6,6,
    /*0xF0*/ 2,5,2,8,4,4,6,6,2,4,2,7,4,4,7,7
  );

  this.instname = new Array(56);

  // Instruction Names:
  this.instname[0] = "ADC";
  this.instname[1] = "AND";
  this.instname[2] = "ASL";
  this.instname[3] = "BCC";
  this.instname[4] = "BCS";
  this.instname[5] = "BEQ";
  this.instname[6] = "BIT";
  this.instname[7] = "BMI";
  this.instname[8] = "BNE";
  this.instname[9] = "BPL";
  this.instname[10] = "BRK";
  this.instname[11] = "BVC";
  this.instname[12] = "BVS";
  this.instname[13] = "CLC";
  this.instname[14] = "CLD";
  this.instname[15] = "CLI";
  this.instname[16] = "CLV";
  this.instname[17] = "CMP";
  this.instname[18] = "CPX";
  this.instname[19] = "CPY";
  this.instname[20] = "DEC";
  this.instname[21] = "DEX";
  this.instname[22] = "DEY";
  this.instname[23] = "EOR";
  this.instname[24] = "INC";
  this.instname[25] = "INX";
  this.instname[26] = "INY";
  this.instname[27] = "JMP";
  this.instname[28] = "JSR";
  this.instname[29] = "LDA";
  this.instname[30] = "LDX";
  this.instname[31] = "LDY";
  this.instname[32] = "LSR";
  this.instname[33] = "NOP";
  this.instname[34] = "ORA";
  this.instname[35] = "PHA";
  this.instname[36] = "PHP";
  this.instname[37] = "PLA";
  this.instname[38] = "PLP";
  this.instname[39] = "ROL";
  this.instname[40] = "ROR";
  this.instname[41] = "RTI";
  this.instname[42] = "RTS";
  this.instname[43] = "SBC";
  this.instname[44] = "SEC";
  this.instname[45] = "SED";
  this.instname[46] = "SEI";
  this.instname[47] = "STA";
  this.instname[48] = "STX";
  this.instname[49] = "STY";
  this.instname[50] = "TAX";
  this.instname[51] = "TAY";
  this.instname[52] = "TSX";
  this.instname[53] = "TXA";
  this.instname[54] = "TXS";
  this.instname[55] = "TYA";

  this.addrDesc = [
    "Zero Page           ",
    "Relative            ",
    "Implied             ",
    "Absolute            ",
    "Accumulator         ", // note: this is not a real mode, it should be imp
    "Immediate           ",
    "Zero Page,X         ",
    "Zero Page,Y         ",
    "Absolute,X          ",
    "Absolute,Y          ",
    "Preindexed Indirect ",
    "Postindexed Indirect",
    "Indirect Absolute   ",
  ];

  this.addrFmt = [
    (pc, a) => utils.hex(2, a),                       // zp   $34
    (pc, a) => utils.hex(4, pc + ((a<<24)>>24) + 1),  // r    $c15f
    (pc, a) => '',                                    // imp
    (pc, a) => utils.hex(4, a),                       // a    $c13f
    (pc, a) => '',                                    // (acc)
    (pc, a) => '#' + utils.hex(2, a),                 // imm  #$12
    (pc, a) => utils.hex(2, a) + ',x',                // zp,x $12,x
    (pc, a) => utils.hex(2, a) + ',y',                // zp,y $12,y
    (pc, a) => utils.hex(4, a) + ',x',                // a,x $1234,x
    (pc, a) => utils.hex(4, a) + ',y',                // a,y $1234,y
    (pc, a) => `(${utils.hex(2, a)},x)`,              // (zp,x) ($12,x)
    (pc, a) => `(${utils.hex(2, a)}),y`,              // (zp),y ($12),y
    (pc, a) => `(${utils.hex(4, a)})`,                // ind-abs ($1234)
  ];

  // number of extra bytes to read
  this.addrSize = [1, 1, 0, 2, 0, 1, 1, 1, 2, 2, 1, 1, 2];
};


OpMeta.prototype = {
  INS_ADC: 0,
  INS_AND: 1,
  INS_ASL: 2,

  INS_BCC: 3,
  INS_BCS: 4,
  INS_BEQ: 5,
  INS_BIT: 6,
  INS_BMI: 7,
  INS_BNE: 8,
  INS_BPL: 9,
  INS_BRK: 10,
  INS_BVC: 11,
  INS_BVS: 12,

  INS_CLC: 13,
  INS_CLD: 14,
  INS_CLI: 15,
  INS_CLV: 16,
  INS_CMP: 17,
  INS_CPX: 18,
  INS_CPY: 19,

  INS_DEC: 20,
  INS_DEX: 21,
  INS_DEY: 22,

  INS_EOR: 23,

  INS_INC: 24,
  INS_INX: 25,
  INS_INY: 26,

  INS_JMP: 27,
  INS_JSR: 28,

  INS_LDA: 29,
  INS_LDX: 30,
  INS_LDY: 31,
  INS_LSR: 32,

  INS_NOP: 33,

  INS_ORA: 34,

  INS_PHA: 35,
  INS_PHP: 36,
  INS_PLA: 37,
  INS_PLP: 38,

  INS_ROL: 39,
  INS_ROR: 40,
  INS_RTI: 41,
  INS_RTS: 42,

  INS_SBC: 43,
  INS_SEC: 44,
  INS_SED: 45,
  INS_SEI: 46,
  INS_STA: 47,
  INS_STX: 48,
  INS_STY: 49,

  INS_TAX: 50,
  INS_TAY: 51,
  INS_TSX: 52,
  INS_TXA: 53,
  INS_TXS: 54,
  INS_TYA: 55,

  INS_DUMMY: 56, // dummy instruction used for 'halting' the processor some cycles

  // -------------------------------- //

  // Addressing modes:
  ADDR_ZP: 0,
  ADDR_REL: 1,
  ADDR_IMP: 2,
  ADDR_ABS: 3,
  ADDR_ACC: 4,
  ADDR_IMM: 5,
  ADDR_ZPX: 6,
  ADDR_ZPY: 7,
  ADDR_ABSX: 8,
  ADDR_ABSY: 9,
  ADDR_PREIDXIND: 10,
  ADDR_POSTIDXIND: 11,
  ADDR_INDABS: 12,

  setOp: function(inst, op, addr, size, cycles) {
    this.opdata[op] =
      (inst & 0xff) |
      ((addr & 0xff) << 8) |
      ((size & 0xff) << 16) |
      ((cycles & 0xff) << 24);
  }
};

export const opmeta = new OpMeta();
export const opdata = opmeta.opdata;
