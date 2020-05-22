import {NROM} from './nrom.js';
import {Proto} from '../proto.js';

const CTRL_MIRROR_MASK       = 0b00011;
const CTRL_MIRROR_ONE_LOWER  = 0b00000;
const CTRL_MIRROR_ONE_UPPER  = 0b00001;
const CTRL_MIRROR_VERTICAL   = 0b00010;
const CTRL_MIRROR_HORIZONTAL = 0b00011;

const CTRL_PRG_16K    = 0b01000;  // else 32K
const CTRL_PRG_MASK   = 0b01100;
const CTRL_PRG_16K_LO = 0b01100;
const CTRL_PRG_16K_HI = 0b01000;

const CTRL_CHR_4K = 0b10000;  // else 8K

// Mapper 1
export class MMC1 extends NROM {
  constructor(nes) {
    super(nes);
    // 5-bit buffer
    this.shiftRegister = 0xf8;
    // $8000
    this.control = CTRL_MIRROR_ONE_LOWER | CTRL_PRG_16K_LO; // | CTRL_CHR_8K;
    // $A000
    this.chrLo = 0;
    // $C000 -- only matters in 4K mode
    this.chrHi = 0;
    // $E000
    this.prgPage = 0;

    // NOTE: this is hideous, we need to pull these constants into a static
    this.mirrorTypes = {
      [CTRL_MIRROR_ONE_LOWER]: this.nes.rom.SINGLESCREEN_MIRRORING,
      [CTRL_MIRROR_ONE_UPPER]: this.nes.rom.SINGLESCREEN_MIRRORING2,
      [CTRL_MIRROR_HORIZONTAL]: this.nes.rom.HORIZONTAL_MIRRORING,
      [CTRL_MIRROR_VERTICAL]: this.nes.rom.VERTICAL_MIRRORING,
    };
  }

  reset() {
    super.reset();
    this.shiftRegister = 0xf8;
    this.control = CTRL_MIRROR_ONE_LOWER | CTRL_PRG_16K_LO; // | CTRL_CHR_8K;
    this.chrLo = 0;
    this.chrHi = 0;
    this.prgPage = 0;
    this.update();
  }

  initializePrgRom() {
    this.update();
  }

  initializePrgRegisterMapping() {
    this.fillPrgMirror([[0x8000, this.write8000],
                        [0xa000, this.writeA000],
                        [0xc000, this.writeC000],
                        [0xe000, this.writeE000]],
                       0x2000, 1);
  }

  shift(value) {
    // TODO(sdh): consider storing the cycle of the last write and ignoring
    // if it was too recent (cf. Bill and Ted)
    if (value & 0x80) {
      // High bit in written value resets and locks PRG mode to 3.
      this.shiftRegister = 0xf8;
      this.control = this.control | CTRL_PRG_16K_LO;
      this.update();
      return false;
    }
    this.shiftRegister <<= 1;
    this.shiftRegister &= value & 1;
    if (this.shiftRegister & 0x80) return false;
    return true;
  }

  write8000(value) {
    if (!this.shift(value)) return;
    this.control = this.shiftRegister;
    this.update();
  }

  writeA000(value) {
    // This is the fifth write, so shiftRegister now contains the value
    if (!this.shift(value)) return;
    this.chrLo = this.shiftRegister;
    this.update();
  }

  writeC000(value) {
    if (!this.shift(value)) return;
    this.chrHi = this.shiftRegister;
    this.update();
  }

  writeE000(value) {
    if (!this.shift(value)) return;
    this.prgPage = this.shiftRegister;
    this.update();
  }

  update() {
    const ctrl = this.control;
    this.nes.ppu.setMirroring(this.mirrorTypes[ctrl & CTRL_MIRROR_MASK]);
    if (ctrl & CTRL_PRG_16K) {
      if ((ctrl & CTRL_PRG_MASK) == CTRL_PRG_16K_LO) {
        this.swapPrg8k(0, this.prgPage << 1, 2);
        this.swapPrg8k(2, 0xf, 2);
      } else {
        this.swapPrg8k(0, 0, 2);
        this.swapPrg8k(2, this.prgPage << 1, 2);
      }
    } else {
      this.swapPrg8k(0, (this.prgPage & ~1) << 1, 4);
    }
    if (ctrl & CTRL_CHR_4K) {
      this.swapChr1k(0, this.chrLo << 2, 4);
      this.swapChr1k(4, this.chrHi << 2, 4);
    } else {
      this.swapChr1k(0, (this.chrLo & ~1) << 2, 8);
    }
  }

  // eslint-disable-next-line no-unused-vars
  switchLowHighPrgRom(oldSetting) {
    // not yet.
  }

  switch16to32() {
    // not yet.
  }

  switch32to16() {
    // not yet.
  }

  writeExtSavestate() {
    return ExtSavestate.of({
      shiftRegister: this.shiftRegister,
      control: this.control,
      chrLo: this.chrLo,
      chrHi: this.chrHi,
      prgPage: this.prgPage,
    });
  }

  restoreExtSavestate(ext) {
    const mmc1 = ExtSavestate.parse(ext);
    this.shiftRegister = mmc1.shiftRegister;
    this.control = mmc1.control;
    this.chrLo = mmc1.chrLo;
    this.chrHi = mmc1.chrHi;
    this.prgPage = mmc1.prgPage
    this.update();
  }
}

const ExtSavestate = Proto.message('Mmc1', {
  shiftRegister: Proto.uint32(1),
  control: Proto.uint32(2),
  chrLo: Proto.uint32(3),
  chrHi: Proto.uint32(4),
  prgPage: Proto.uint32(5),
});
