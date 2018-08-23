import {NROM} from './nrom.js';

const BANK_SELECT_CHR_INVERTED = 0x80;
const BANK_SELECT_PRG_INVERTED = 0x40;
const BANK_SELECT_ADDRESS_MASK = 0x07;

// Mapper 4: MMC3 and MMC6
export class MMC3 extends NROM {
  constructor(nes) {
    super(nes);

    // State
    this.bankSelect = 0;                   // Register $8000
    this.banks = [0, 0, 0, 0, 0, 0, 0, 0]; // Register $8001
    this.irqLatchValue = 0;                // Register $C000
    this.irqCounter = 0;
    this.irqEnable = true;                 // Register $E000, $E001
  }

  initializePrgRom() {
    this.loadPrgPage(0xe000, -1, 0x2000);
    // All other initial pages are unspecified
  }

  write8(addr, value) {
    addr &= 0xe001;

    if (addr < 0xc000) {
      if (addr < 0xa000) {
        if (addr == 0x8000) {
          // 8000: Address Select register
          this.bankSelect = value;
          this.updateBanks();
        } else {
          // 8001: Page number for command
          this.banks[this.bankSelect & BANK_SELECT_ADDRESS_MASK] = value;
          this.updateBanks();
        }
      } else {
        if (addr == 0xa000) {
          // A000: Mirroring select
          if ((value & 1) !== 0) {
            this.nes.ppu.setMirroring(this.nes.rom.HORIZONTAL_MIRRORING);
          } else {
            this.nes.ppu.setMirroring(this.nes.rom.VERTICAL_MIRRORING);
          }
        } else {
          // A001: SaveRAM Toggle
          // TODO
          //nes.getRom().setSaveState((value&1)!=0);
        }
      }
    } else {
      if (addr < 0xe000) {
        if (addr == 0xc000) {
          // C000: IRQ Latch
          this.irqCounter = this.irqLatchValue = value;
          //nes.ppu.mapperIrqCounter = 0;
        } else {
          // C001: IRQ Reload
          this.irqCounter = this.irqLatchValue;
        }
      } else {
        if (addr == 0xe000) {
          // E000: IRQ Control Reg 0 (disable)
          //irqCounter = irqLatchValue;
          this.irqEnable = 0;
        } else {
          // E001: IRQ Control Reg 1 (enable)
          this.irqEnable = 1;
        }
      }
    }
  }

  updateBanks() {
    const chrInvert = this.bankSelect & BANK_SELECT_CHR_INVERTED ? 0x1000 : 0;
    const prgInvert = this.bankSelect & BANK_SELECT_CHR_INVERTED ? 0x4000 : 0;
    this.loadChrPages(
        [0x0000 ^ chrInvert, this.banks[0] >>> 1, 0x0800],
        [0x0800 ^ chrInvert, this.banks[1] >>> 1, 0x0800],
        [0x1000 ^ chrInvert, this.banks[2], 0x0400],
        [0x1400 ^ chrInvert, this.banks[3], 0x0400],
        [0x1800 ^ chrInvert, this.banks[4], 0x0400],
        [0x1c00 ^ chrInvert, this.banks[5], 0x0400]);
    this.loadPrgPages(
        [0x8000 ^ prgInvert, this.banks[6], 0x2000],
        [0xa000,             this.banks[7], 0x2000],
        [0xc000 ^ prgInvert, -2,            0x2000],
        [0xe000,             -1,            0x2000]);
  }

  clockIrqCounter() {
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

  buildSavestate(table) {
    super.buildSavestate(table);
    table['mmc3'] = Uint8Array.of(
        this.bankSelect,
        this.irqCounter,
        this.irqLatchValue,
        this.irqEnable,
        ...this.banks);
  }

  parseSavestate(table) {
    super.parseSavestate(table);
    ((sel, counter, latch, irq, ...banks) => {
      this.bankSelect = sel;
      this.irqCounter = counter;
      this.irqLatchValue = latch;
      this.irqEnable = irq;
      this.banks = banks;
    })(...new Uint8Array(table['mmc3']));
  }
}
