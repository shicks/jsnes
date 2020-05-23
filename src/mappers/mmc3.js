import {NROM} from './nrom.js';
import {Proto} from '../proto.js';

const BANK_SELECT_CHR_INVERTED = 0x80;
const BANK_SELECT_PRG_INVERTED = 0x40;
const BANK_SELECT_ADDRESS_MASK = 0x07;

// Mapper 4: MMC3 and MMC6
export class MMC3 extends NROM {
  constructor(nes) {
    super(nes);
    this.irqPixel = 260;

    // State
    this.bankSelect = 0;                   // Register $8000
    this.banks = [0, 0, 0, 0, 0, 0, 0, 0]; // Register $8001
    this.irqLatchValue = 0;                // Register $C000
    this.irqCounter = 0;
    this.irqEnable = true;                 // Register $E000, $E001
    this.prgRom = null;
  }

  initializePrgRomBanks() {
    super.initializePrgRomBanks();
    // All other initial pages are unspecified
    this.swapPrg8k(0, 0);
    this.swapPrg8k(1, 0);
    this.swapPrg8k(2, 0xfe);
    this.swapPrg8k(3, 0xff);
  }

  initializePrgRegisterMapping() {
    this.fillPrgMirror([[0x8000, this.write8000],
                        [0x8001, this.write8001],
                        [0xa000, this.writeA000],
                        [0xa001, this.writeA001],
                        [0xc000, this.writeC000],
                        [0xc001, this.writeC001],
                        [0xe000, this.writeE000],
                        [0xe001, this.writeE001]],
                       0x2000, 2);
  }

  

  write8000(value) {
    // 8000: Address Select register
    this.bankSelect = value;
    this.updateBanks();
  }

  write8001(value) {
    // 8001: Page number for command
    this.banks[this.bankSelect & BANK_SELECT_ADDRESS_MASK] = value;
    this.updateBanks();
  }

  writeA000(value) {
    // A000: Mirroring select
    if ((value & 1) !== 0) {
      this.nes.ppu.setMirroring(this.nes.rom.HORIZONTAL_MIRRORING);
    } else {
      this.nes.ppu.setMirroring(this.nes.rom.VERTICAL_MIRRORING);
    }
  }

  writeA001(value) {
    // A001: SaveRAM Toggle
    // TODO
    //nes.getRom().setSaveState((value&1)!=0);
  }

  writeC000(value) {
    // C000: IRQ Latch
    this.irqCounter = this.irqLatchValue = value;
    //nes.ppu.mapperIrqCounter = 0;
  }

  writeC001(value) {
    // C001: IRQ Reload
    this.irqCounter = this.irqLatchValue;
  }

  writeE000(value) {
    // E000: IRQ Control Reg 0 (disable)
    //irqCounter = irqLatchValue;
    this.irqEnable = 0;
  }

  writeE001(value) {
    // E001: IRQ Control Reg 1 (enable)
    this.irqEnable = 1;
  }

  updateBanks() {
    if (!this.nes.ppu.usingChrRam) {
      const chrInvert = this.bankSelect & BANK_SELECT_CHR_INVERTED ? 4 : 0;
      const ppu = this.nes.ppu;
      ppu.triggerRendering();
      this.swapChr1k(0 ^ chrInvert, this.banks[0], 2);
      this.swapChr1k(2 ^ chrInvert, this.banks[1], 2);
      this.swapChr1k(4 ^ chrInvert, this.banks[2]);
      this.swapChr1k(5 ^ chrInvert, this.banks[3]);
      this.swapChr1k(6 ^ chrInvert, this.banks[4]);
      this.swapChr1k(7 ^ chrInvert, this.banks[5]);
    }
    const prgInvert = this.bankSelect & BANK_SELECT_PRG_INVERTED ? 0x4000 : 0;
    this.swapPrg8k(0 ^ prgInvert, this.banks[6]);
    this.swapPrg8k(1,             this.banks[7]);
    this.swapPrg8k(2 ^ prgInvert, 0xfe);
  }

  clockIrqCounter(scanline, dot) {
    const ppu = this.nes.ppu;
    if ((!ppu.f_bgVisibility && !ppu.f_fgVisibility) || scanline == 261) {
      // no irq in these cases
      return;
    }
    // console.log(`clockIrqCounter: enabled: ${this.irqEnable}, counter: ${this.irqCounter}`);
    if (this.irqEnable === 1) {
      this.irqCounter--;
      if (this.irqCounter < 0) {
        // Trigger IRQ:
        //nes.getCpu().doIrq();
        //console.log(`  => requesting IRQ`);
        this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NORMAL);
        this.irqCounter = this.irqLatchValue;
      }
    }
  }

  writeExtSavestate() {
    return ExtSavestate.of({
      bankSelect: this.bankSelect,
      irqCounter: this.irqCounter,
      irqLatchValue: this.irqLatchValue,
      irqEnable: this.irqEnable,
      banks: this.banks,
    }).serialize();
  }

  restoreExtSavestate(ext) {
    const mmc3 = ExtSavestate.parse(ext);
    this.bankSelect = mmc3.bankSelect;
    this.irqCounter = mmc3.irqCounter;
    this.irqLatchValue = mmc3.irqLatchValue;
    this.irqEnable = mmc3.irqEnable;
    this.banks = mmc3.banks;
  }
}

const ExtSavestate = Proto.message('Mmc3', {
  bankSelect: Proto.uint32(1),
  irqCounter: Proto.uint32(2),
  irqLatchValue: Proto.uint32(3),
  irqEnable: Proto.uint32(5),
  banks: Proto.uint32(6).repeated(),
});
