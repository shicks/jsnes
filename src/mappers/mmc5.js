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

  constructor(nes) {
    super(nes);
    this.irqPixel = 4;

    this.reg5 = new Uint16Array(0x1000); // last write; need 16 bits...

    // this.prgMode = 0; // 0|1|2|3
    // this.chrMode = 0; // 0|1|2|3
    // this.
    // this.mulA = 0; // multiplier A
    // this.mulB = 0; // multiplier B

    this.reg5[0x100] = 3;    // default to mode 3
    this.reg5[0x101] = 3;    // default to mode 3
    this.reg5[0x113] = 0x00; // 6000..7fff bank
    this.reg5[0x114] = 0xff; // 8000..9fff bank
    this.reg5[0x115] = 0xff; // a000..bfff bank
    this.reg5[0x116] = 0xff; // c000..dfff bank
    this.reg5[0x117] = 0xff; // e000..ffff bank
    this.reg5[0x205] = 0xff; // multiplier init
    this.reg5[0x206] = 0xff; //  "   "   "   "
    this.enableSram = false;

    this.irqEnabled = 0;
    this.irqCounter = 0;

    // initialize exram as extra nametable
    this.exramNametable = this.reg5.subarray(0xc00, 0x1000);
    this.zeroNametable = new FillNametable();
    nes.ppu.nametable2 = this.exramNametable;
    this.fillNametable = new FillNametable();
    nes.ppu.nametable3 = this.fillNametable;

    // initialize hardware timer
    this.hardwareTimer = 0;
  }

  initializeChrRomBanks() {
    super.initializeChrRomBanks();
    this.updateChrBanks();
  }

  //   // NOTE: we actually need three rom switchers: one for data, one for
  //   // tile rom, and one for 8x16 sprites.
  //   if (this.nes.rom.vrom.length) {
  //     this.nes.ppu.importChrRom(this.nes.rom.vrom);
  //     this.ppuDataSwitcher = 
  //         new utils.RomBankSwitcher(this.nes.ppu.patternTableFull, 0x2000, 512);
  //     this.chrRomSwitcher =
  //         new utils.RomBankSwitcher(this.nes.ppu.patternTableFull, 0x2000, 512);
  //   } else {
  //     this.chrRam = new Uint16Array(0x2000);
  //     this.nes.ppu.patternTableFull = this.nes.ppu.patternTable = this.chrRam;
  //   }
  // }

  initializePrgRam() {
    this.prgRam = new Uint8Array(0x2000);
    this.allPrgPages[0] = this.prgRam.subarray(0, 0x2000);
    this.fillPrgMirror([[0x6000, this.bankedPrgWrite, 0],
                        [0x8000, this.bankedPrgWrite, 1],
                        [0xa000, this.bankedPrgWrite, 2],
                        [0xc000, this.bankedPrgWrite, 3]],
                       0x2000, 1, this.prgWrite);
  }
  initializePrgRomMapping() {
    this.fillPrgMirror([[0x6000, this.bankedPrgRead, 0],
                        [0x8000, this.bankedPrgRead, 1],
                        [0xa000, this.bankedPrgRead, 2],
                        [0xc000, this.bankedPrgRead, 3],
                        [0xe000, this.bankedPrgRead, 4]],
                       0x2000, 1, this.prgLoad);
    this.prgLoad[0xfffa] = this.prgLoad[0xfffb] = (addr) => {
      // NMI - clear in-frame, acknowledge IRQ, etc.
      this.irqCounter = this.reg5[0x204] = 0;
      return this.bankedPrgRead(4, addr);
    }
  }

  bankedPrgRead(bank, addr) {
    return this.prgBanks[bank][addr & 0x1fff];
  }
  bankedPrgWrite(bank, value, addr) {
    const prg = this.prgBanks[bank];
    if (this.enableSram && prg.buffer === this.prgRam.buffer) {
      prg[addr & 0x1fff] = value;
    }
  }

  initializePpuRegisters() {
    super.initializePpuRegisters();
    // Need to keep track of sprite height
    const updatePpuCtrl = (value) => {
      this.nes.ppu.writePpuCtrl(value);
      this.updateSpriteHeight();
    };
    for (let a = 0x2000; a < 0x4000; a += 8) {
      this.prgWrite[a] = updatePpuCtrl;
    }
  }

  updateSpriteHeight() {
    const ppu = this.nes.ppu;
    if (ppu.f_tallSprites) {
      // TODO - should these be populated from a different set?
      ppu.tallSpritePatternTableBanks = [...ppu.patternTableBanks];
    } else {
      ppu.tallSpritePatternTableBanks = null;
      ppu.ppuDataBanks = null;
    }
    this.updateChrBanks();
  }

  initializePrgRegisterMapping() {
    const writeRegs = [
      [[0x5100, 0x5113, 0x5114, 0x5115, 0x5116, 0x5117], this.setPrgMode],
      [[0x5101], this.setChrMode],
      [[0x5102, 0x5103], this.setPrgRamProtect],
      [[0x5104], this.setExramMode],
      [[0x5105], this.setNametableMapping],
      [[0x5106, 0x5107], this.setFillMode],
      [[0x5120, 0x5121, 0x5122, 0x5123, 0x5124, 0x5125, 0x5126, 0x5127,
        0x5128, 0x5129, 0x512a, 0x512b], this.setChrBank],
      [[0x5130, // chr upper bank bits
//        0x5203, // irq compare
        0x5205, 0x5206, // multiplier
       ], this.storeReg5],
      [[0x5203], this.setIrqCompare],
      // TODO - vertical split will require special PPU treatment
      [[0x5204], this.enableIrq],
      [[0x5209, 0x520a], this.setHardwareTimer],
    ];
    const readRegs = [
      [[0x5204], this.readIrqStatus],
      [[0x5205, 0x5206], this.readMultiplier],
      [[0x5209], this.readHardwareTimer],      
    ];
    for (const [addrs, reg] of writeRegs) {
      const bound = reg.bind(this);
      for (const addr of addrs) {
        this.prgWrite[addr] = bound;
      }
    }
    for (const [addrs, reg] of readRegs) {
      const bound = reg.bind(this);
      for (const addr of addrs) {
        this.prgLoad[addr] = bound;
      }
    }
    // define the exram
    const readExram = this.readExram.bind(this);
    const writeExram = this.writeExram.bind(this);
    for (let a = 0x5c00; a < 0x6000; a++) {
      this.prgLoad[a] = readExram;
      this.prgWrite[a] = writeExram;
    }
  }

  readExram(addr) {
    if (this.reg5[0x104] & 2) return this.reg5[addr & 0xfff];
    return 0;
  }

  writeExram(value, addr) {
    const mode = this.reg5[0x104] & 3;
    if (mode === 3) return;
    if (mode === 2 || this.nes.ppu.isRendering()) {
      this.reg5[addr & 0xfff] = value;
    }
  }

  setExramMode(value) {
    this.reg5[0x104] = value;
    this.nes.ppu.nametable2 =
        value & 2 ? this.zeroNametable : this.exramNametable;
    this.nes.ppu.extendedAttributes =
        (value & 3) === 1 ? this.exramNametable : null;
  }

  setNametableMapping(value) {
    this.nes.ppu.setMirroring(value);
  }
  setFillMode(value) {
    this.fillNametable.tile = this.reg5[0x106];
    let attr = this.reg5[0x107] & 3;
    attr |= attr << 2;
    attr |= attr << 4;
    this.fillNametable.attr = attr;
  }

  storeReg5(value, addr) {
    // Misc - store the value, but don't do anything with it
    this.reg5[addr & 0xfff] = value;
  }

  setPrgMode(value, addr) {
    // 5100 PRG mode, 5113..5117 PRG bankswitching
    this.reg5[addr & 0xfff] = value;
    this.updatePrgBanks();
  }

  swapPrg8k(bank, page, count = 1) {
    if (page < 0x80) {
      // maybe resize this.prgRam.
      page = page & 0x0f; // only 16 pages allowed
      if (this.prgRam.length < ((page + count) << 13)) {
        const old = this.prgRam;
        this.prgRam = new Uint8Array((page + count) << 13);
        this.prgRam.subarray(0, old.length).set(old);
        for (let i = 0; i < this.prgRam.length; i += 0x2000) {
          // rebuild the table of all pages.
          this.allPrgPages[i >>> 13] = this.prgRam.subarray(i, i + 0x2000);
        }
      }
    }

    // If the page is > the max, we need a little more work to normalize it.
    if (page >= this.allPrgPages.length) {
      const z = Math.clz32((this.allPrgPages.length & 0x7f) - 1);
      page = 0x80 | page & ((1 << (32 - z)) - 1);
    }

    super.swapPrg8k(bank, page, count);
  }

  swapChr1k(bank, page, count = 1, table = undefined) {
    // NOTE: CHR banking is in terms of the currently selected size!
    super.swapChr1k(bank, page * count, count, table);
  }

  updatePrgBanks() {
    const mode = this.reg5[0x100] & 3;
    this.swapPrg8k(0, this.reg5[0x113] & 0x7f, 1);
    switch (mode) {
    case 3: // 8k pages
      this.swapPrg8k(1, this.reg5[0x114], 1);
      this.swapPrg8k(2, this.reg5[0x115], 1);
      this.swapPrg8k(3, this.reg5[0x116], 1);
      this.swapPrg8k(4, this.reg5[0x117] | 0x80, 1); // always rom
      break;
    case 2: // 16k lower, 8k upper
      this.swapPrg8k(1, this.reg5[0x115], 2);
      this.swapPrg8k(3, this.reg5[0x116], 1);
      this.swapPrg8k(4, this.reg5[0x117] | 0x80, 1);
      break;
    case 1: // 16k pages
      this.swapPrg8k(1, this.reg5[0x115], 2);
      this.swapPrg8k(3, this.reg5[0x117] | 0x80, 2);
      break;
    case 0: // 32k page
      this.swapPrg8k(1, this.reg5[0x117] | 0x80, 4);
      break;
    default:
      throw new Error(`Impossible: ${mode}`);
    }
  }

  setChrMode(value, addr) {
    // 5101 CHR mode
    this.reg5[addr & 0xfff] = value;
    this.updateChrBanks();
  }

  setChrBank(value, addr) {
    // 5120..512b CHR bankswitching
    this.reg5[addr & 0xfff] = value | (this.reg5[0x130] << 8);
    const ppu = this.nes.ppu;
    const group = addr & 0xfff8;
    ppu.ppuDataBanks =
        ppu.f_tallSprites && group === 0x5120 ?
            ppu.tallSpritePatternTableBanks :
            ppu.patternTableBanks;
    this.updateChrBanks();
  }

  updateChrBanks() {
    const ppu = this.nes.ppu;
    const mode = this.reg5[0x101] & 3;
    const size = 1 << (3 - mode);
    const tall = ppu.f_tallSprites;
    const lo = tall ? ppu.tallSpritePatternTableBanks : ppu.patternTableBanks;
    const hi = tall ? ppu.patternTableBanks : null;
    for (let i = 0; i < 8; i += size) {
      this.swapChr1k(i, this.reg5[0x120 | (size - 1) | i], size, lo);
      if (!hi) continue;
      this.swapChr1k(i, this.reg5[0x128 | ((size - 1) | i) & 3], size, hi);
    }
  }

  setPrgRamProtect(value, addr) {
    // 5102, 5013 PRG RAM Protect
    this.reg5[addr & 0xfff] = value & 3;
    this.enableSram = (this.reg5[0x102] === 2) && (this.reg5[0x103] === 1);
    this.updatePrgBanks();
  }

  initializePrgRomBanks() {
    const rom = this.nes.rom.rom;
    for (let i = 0; i < rom.length; i += 8192) {
      this.allPrgPages[0x80 | i >> 13] = rom.subarray(i, i + 8192);
    }
    this.updatePrgBanks();
  }

  clockHardwareTimer(cycles) {
    if (this.hardwareTimer > 0) {
      const clocked = this.hardwareTimer -= cycles;
      if (clocked <= 0) {
        this.reg5[0x209] = 0x80;
        this.hardwareTimer = 0;
        this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NORMAL);
      }
    }      
  }

  readMultiplier(addr) {
    const product = this.reg5[0x205] * this.reg5[0x206];
    return addr === 0x5205 ? product & 0xff : product >>> 8;
  }

  clockIrqCounter(scanline, dot) {
    if (!this.nes.ppu.f_bgVisibility && !this.nes.ppu.f_fgVisibility) {
      // no rendering
      this.reg5[0x204] &= ~0x40;
      return;
    }
    const compare = this.reg5[0x203];
    if (scanline === 261) {
      this.reg5[0x204] &= ~0x40;
    } else if (!(this.reg5[0x204] & 0x40)) {
      this.reg5[0x204] |= 0x40;
      this.irqCounter = 0;
    } else if (/*++this.irqCounter /**/scanline-21/**/ === compare) {
      this.reg5[0x204] |= 0x80;
      if (this.irqEnabled) {
        this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NORMAL);
      }
    }
  }

  enableIrq(value) {
    if (this.irqEnabled = value & 0x80) {
      this.irqCounter = 0;
    }    
  }

  setIrqCompare(value) {
    this.reg5[0x203] = value;
  }

  readIrqStatus() {
    const value = this.reg5[0x204];
    this.reg5[0x204] &= 0x7f;
    return value;
  }

  readHardwareTimer() {
    const result = this.hardwareTimer > 0 ? 0 : this.reg5[0x209];
    this.reg5[0x209] = 0;
    return result;
  }

  setHardwareTimer(value, addr) {
    if (addr === 0x520a) {
      if (this.hardwareTimer > 0) {
        this.hardwareTimer = this.hardwareTimer & 0xff | value << 8;
      } else {
        this.reg5[0x20a] = value;
      }
    } else {
      if (this.hardwareTimer > 0) {
        this.hardwareTimer = this.hardwareTimer & 0xff00 | value;
      } else {
        this.reg5[0x209] = 0;
        this.hardwareTimer = this.reg5[0x20a] << 8 | value;
      }
    }
  }

  // NOTE: the page switcher needs to be $A000 instead of $8000
  // Loads a page of PRG ROM
  loadPrgPage(address, bank, size) {
    this.prgRomSwitcher.swap(address & 0x7fff, bank, size);
    this.nes.cpu.prgRom = this.prgRomSwitcher.buffer();
  }

  // Effectively makes repeated calls to loadPrgPage
  loadPrgPages(...pages) {
    for (const [address, bank, size] of pages) {
      this.prgRomSwitcher.swap(address - 0x6000, bank, size);
    }
    this.prgRom = this.prgRomSwitcher.buffer();
  }

  // initializePrgRom() {
  //   this.loadPrgPage(0x8000, 0xff, 0x2000);
  //   this.loadPrgPage(0xa000, 0xff, 0x2000);
  //   this.loadPrgPage(0xc000, 0xff, 0x2000);
  //   this.loadPrgPage(0xe000, 0xff, 0x2000);
  // }

  // initializeRegisters() {
  //   // NOTE: Using a lookup table here may be less efficient than
  //   // a bunch of nested if's, but there are so many that it might
  //   // actually have broken even already.
  //   this.write5[0x104] = (value) => this.updateExram();
  //   this.write5[0x105] = (value) => {
  //     this.nametable_mode = value;
  //     this.nametable_type[0] = value & 3;
  //     this.load1kVromBank(value & 3, 0x2000);
  //     value >>= 2;
  //     this.nametable_type[1] = value & 3;
  //     this.load1kVromBank(value & 3, 0x2400);
  //     value >>= 2;
  //     this.nametable_type[2] = value & 3;
  //     this.load1kVromBank(value & 3, 0x2800);
  //     value >>= 2;
  //     this.nametable_type[3] = value & 3;
  //     this.load1kVromBank(value & 3, 0x2c00);
  //   };
  //   // this.write5[0x106] = (value) => this.fill_chr = value;
  //   // this.write5[0x107] = (value) => this.fill_pal = value & 3;
  //   this.write5[0x113] = () => this.updatePrg();
  //   this.write5[0x114] = () => this.updatePrg();
  //   this.write5[0x115] = () => this.updatePrg();
  //   this.write5[0x116] = () => this.updatePrg();
  //   this.write5[0x117] = () => this.updatePrg();
  //   // this.write5[0x113] = (value) => this.SetBank_SRAM(3, value & 3);
  //   for (let address = 0x5114; address <= 0x5117; address++) {
  //     this.write5[address & 0xfff] = (value) => this.SetBank_CPU(address, value);
  //   }
  //   for (let address = 0x5120; address <= 0x5127; address++) {
  //     this.write5[address & 0xfff] = (value) => {
  //       this.chr_mode = 0;
  //       this.chr_page[0][address & 7] = value;
  //       this.SetBank_PPU();
  //     };
  //   }
  //   for (let address = 0x5128; address <= 0x512b; address++) {
  //     this.write5[address & 0xfff] = (value) => {
  //       this.chr_mode = 1;
  //       this.chr_page[1][(address & 3) + 0] = value;
  //       this.chr_page[1][(address & 3) + 4] = value;
  //       this.SetBank_PPU();
  //     };
  //   }
  //   this.write5[0x200] = (value) => this.split_control = value;
  //   this.write5[0x201] = (value) => this.split_scroll = value;
  //   this.write5[0x202] = (value) => this.split_page = value & 0x3f;
  //   this.write5[0x203] = (value) => {
  //     this.irq_line = value;
  //     this.nes.cpu.ClearIRQ();
  //   };
  //   this.write5[0x204] = (value) => {
  //     this.irq_enable = value;
  //     this.nes.cpu.ClearIRQ();
  //   };
  //   this.write5[0x205] = (value) => this.mult_a = value;
  //   this.write5[0x206] = (value) => this.mult_b = value;
  //   for (let address = 0x5000; address <= 0x5015; address++) {
  //     this.write5[address & 0xfff] =
  //         (value) => this.nes.papu.exWrite(address, value);
  //   }
  //   for (let address = 0x5c00; address <= 0x5fff; address++) {
  //     this.write5[address & 0xfff] = (value) => {
  //       if (this.graphic_mode === 2) {
  //         // ExRAM
  //         // vram write
  //       } else if (this.graphic_mode !== 3) {
  //         // Split,ExGraphic
  //         if (this.irq_status & 0x40) {
  //           // vram write
  //         } else {
  //           // vram write
  //         }
  //       }
  //     };
  //   }
  // }

  // Update this because 6000 is bank 0.
  prgRomBank(addr) {
    // TODO - handle ram and exram better?
    if (addr < 0x6000) return null;
    return this.prgBanks[(addr - 0x6000) >>> 13].byteOffset >>> 13;
  }
  prgRomAddress(bank, addr) {
    if (bank == null) bank = this.prgRomBank(addr);
    const a = (bank << 13) | (addr & 0x1fff);
    return a;
  }

  writeExtSavestate() {
    return ExtSavestate.of({
      reg5: this.reg5,
      enableSram: this.enableSram,
      hardwareTimer: this.hardwareTimer,
      irqEnabled: this.irqEnabled,
      irqCounter: this.irqCounter,
    }).serialize();
  }

  restoreExtSavestate(ext) {
    const mmc5 = ExtSavestate.parse(ext);
    this.reg5 = mmc5.reg5;
    this.enableSram = mmc5.enableSram;
    this.hardwareTimer = mmc5.hardwareTimer;
    this.irqEnabled = mmc5.irqEnabled;
    this.irqCounter = mmc5.irqCounter;
  }
}

const ExtSavestate = Proto.message('Mmc5', {
  reg5: Proto.bytes(1).array(Uint8Array),
  enableSram: Proto.uint32(2),
  hardwareTimer: Proto.uint32(3),
  irqEnabled: Proto.uint32(4),
  irqCounter: Proto.uint32(5),
});

class FillNametable {
  constructor() {
    this.tile = 0;
    this.attr = 0;
    const tileProp = {get() { return this.tile; }};
    const attrProp = {get() { return this.attr; }};
    const props = {};
    for (let i = 0; i < 0x400; i++) {
      props[i] = i < 0x3c0 ? tileProp : attrProp;
    }
    Object.defineProperties(this, props);
  }
}
