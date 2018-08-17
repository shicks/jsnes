import {NROM} from './nrom.js';

// NOTE: it doesn't look like this actually works yet.  There's WAY too much missing!

/**
 * Mapper005 (MMC5,ExROM)
 *
 * @example Castlevania 3, Just Breed, Uncharted Waters, Romance of the 3 Kingdoms 2, Laser Invasion, Metal Slader Glory, Uchuu Keibitai SDF, Shin 4 Nin Uchi Mahjong - Yakuman Tengoku
 * @description http://wiki.nesdev.com/w/index.php/INES_Mapper_005
 * @constructor
 */
export class MMC5 extends NROM {

  initializeRam() {
    super.initializeRam();
      // if (address >= 0x6000 && address <= 0x7fff) {
      //   if (this.sram_we_a === 2 && this.sram_we_b === 1) {
      //     // additional ram write
      //   }
      // }
  }

  initializePrgRom() {
    this.loadPrgPage(0x8000, -1, 0x2000);
    this.loadPrgPage(0xa000, -1, 0x2000);
    this.loadPrgPage(0xc000, -1, 0x2000);
    this.loadPrgPage(0xe000, -1, 0x2000);
  }

  initializeRegisters() {
    super.initializeRegisters();
    this.onWrite(0x5100, (value) => this.prg_size = value & 3);
    this.onWrite(0x5101, (value) => this.chr_size = value & 3);
    this.onWrite(0x5102, (value) => this.sram_we_a = value & 3);
    this.onWrite(0x5103, (value) => this.sram_we_b = value & 3);
    this.onWrite(0x5104, (value) => this.graphic_mode = value & 3);
    this.onWrite(0x5105, (value) => {
      this.nametable_mode = value;
      this.nametable_type[0] = value & 3;
      this.load1kVromBank(value & 3, 0x2000);
      value >>= 2;
      this.nametable_type[1] = value & 3;
      this.load1kVromBank(value & 3, 0x2400);
      value >>= 2;
      this.nametable_type[2] = value & 3;
      this.load1kVromBank(value & 3, 0x2800);
      value >>= 2;
      this.nametable_type[3] = value & 3;
      this.load1kVromBank(value & 3, 0x2c00);
    });
    this.onWrite(0x5106, (value) => this.fill_chr = value);
    this.onWrite(0x5107, (value) => this.fill_pal = value & 3);
    this.onWrite(0x5113, (value) => this.SetBank_SRAM(3, value & 3));
    for (let address = 0x5114; address <= 0x5117; address++) {
      this.onWrite(address, (value) => this.SetBank_CPU(address, value));
    }
    for (let address = 0x5120; address <= 0x5127; address++) {
      this.onWrite(address, (value) => {
        this.chr_mode = 0;
        this.chr_page[0][address & 7] = value;
        this.SetBank_PPU();
      });
    }
    for (let address = 0x5128; address <= 0x512b; address++) {
      this.onWrite(address, (value) => {
        this.chr_mode = 1;
        this.chr_page[1][(address & 3) + 0] = value;
        this.chr_page[1][(address & 3) + 4] = value;
        this.SetBank_PPU();
      });
    }
    this.onWrite(0x5200, (value) => this.split_control = value);
    this.onWrite(0x5201, (value) => this.split_scroll = value);
    this.onWrite(0x5202, (value) => this.split_page = value & 0x3f);
    this.onWrite(0x5203, (value) => {
      this.irq_line = value;
      this.nes.cpu.ClearIRQ();
    });
    this.onWrite(0x5204, (value) => {
      this.irq_enable = value;
      this.nes.cpu.ClearIRQ();
    });
    this.onWrite(0x5205, (value) => this.mult_a = value);
    this.onWrote(0x5206, (value) => this.mult_b = value);
    for (let address = 0x5000; address <= 0x5015; address++) {
      this.onWrite(address, (value, nes) => nes.papu.exWrite(address, value));
    }
    for (let address = 0x5c00; address <= 0x5fff; address++) {
      this.onWrite(address, (value) => {
        if (this.graphic_mode === 2) {
          // ExRAM
          // vram write
        } else if (this.graphic_mode !== 3) {
          // Split,ExGraphic
          if (this.irq_status & 0x40) {
            // vram write
          } else {
            // vram write
          }
        }
      });
    }
  }

  loadROM() {
    if (!this.nes.rom.valid) {
      throw new Error("UNROM: Invalid ROM! Unable to load.");
    }

    // Load PRG-ROM:
    this.load8kRomBank(this.nes.rom.romCount * 2 - 1, 0x8000);
    this.load8kRomBank(this.nes.rom.romCount * 2 - 1, 0xa000);
    this.load8kRomBank(this.nes.rom.romCount * 2 - 1, 0xc000);
    this.load8kRomBank(this.nes.rom.romCount * 2 - 1, 0xe000);

    // Load CHR-ROM:
    this.loadCHRROM();

    // Do Reset-Interrupt:
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }
}
