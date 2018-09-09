import * as utils from '../utils.js';
import {Savestate} from '../wire.js';

const countBits = (mask) => {
  let count = 0;
  while (mask) {
    if (!(mask & 1)) throw new Error('Invalid mask');
    mask >>>= 1;
    count++;
  }
  return count;
};

/** Mask for a PRG bank. */
export const PRG_BANK_MASK = 0x7ff;
/** Bits in a PRG bank. */
export const PRG_BANK_SIZE = countBits(PRG_BANK_MASK);

export const SIZE_64K = 0x10000;
export const SIZE_32K = 0x8000;
export const SIZE_16K = 0x4000;
export const SIZE_8K = 0x2000;
export const SIZE_4K = 0x1000;
export const SIZE_2K = 0x0800;
export const SIZE_1K = 0x0400;

// TODO - CHR banks?

const NULL_READ = () => 0;
const NULL_WRITE = () => {};

// Mapper 0 - base class for all others.
export class NROM {
  constructor(nes) {
    this.nes = nes;
    this.joy1StrobeState = 0;
    this.joy2StrobeState = 0;
    this.joypadLastWrite = 0;
    this.zapperFired = false;
    this.zapperX = null;
    this.zapperY = null;

    // Included verbatim in snapshots.
    this.prgRam = null;
    this.chrRam = null;

    this.prgRomSwitcher = null;
    this.chrRomSwitcher = null;

    // Array of the four currently selected 8k banks for PRG ROM.  Anything else
    // (swappable PRG RAM, smaller ROM banks, etc) requires special handler for
    // proper snapshooting.
    // this.cpuBanks = null;

    // NOTE: we don't worry about storing the PPU banks.  Since CHR-RAM is pretty
    // common in many mappers, we just support it by default, which means that
    // snapshots need to include the full contents of VRAM anyway.  If a mapper
    // has CHR RAM swapping, it will need special support anyway.
  }

  /**
   * Handles register loads.  Loads from CPU RAM or PRG ROM will not
   * work correctly and should instead be handled by CPU.prototype.load.
   */
  load(address) {
    if (address < 0x6000) {
      if (address < 0x4000) {
        return this.load2(address);
      }
      return this.load4(address);
    }
    return this.prgRam[address & 0x1fff];
  }

  /**
   * Handles register writes.  Writes to CPU RAM will not work correctly and
   * should instead be handled by CPU.prototype.load.
   */
  write(address, value) {
    if (address < 0x6000) {
      if (address < 0x4000) {
        this.write2(address, value);
      } else {
        this.write4(address, value);
      }
    } else if (address < 0x8000) {
      this.prgRam[address & 0x1fff] = value;
    } else {
      this.write8(address, value);
    } 
  }

  /** Handles all loads from $2000 .. $3fff. */
  load2(address) {
    address &= 0x7;
    if (address < 4) {
      if (address < 2) {
        return address ?
            // 2001 PPUMASK (PPU Control Register 2)
            this.nes.ppu.readPpuMask() :
            // 2000 PPUCTRL (PPU Control Register 1)
            this.nes.ppu.readPpuCtrl();
      } else if (address == 2) {
        // 2002 PPUSTATUS (PPU Status Register)
        return this.nes.ppu.readStatusRegister();
      }
    } else {
      if (address == 4) {
        // 2004 OAMDATA (Sprite memory read/write)
        return this.nes.ppu.sramLoad();
      } else if (address == 7) {
        // 2007 PPUDATA (VRAM read/write)
        return this.nes.ppu.vramLoad();
      }
    }
    return 0;
  }

  /** Handles all writes to $2000 .. $3fff. */
  write2(address, value) {
    address &= 0x7;
    if (address < 4) {
      if (address < 2) {
        if (address) {
          // 2001 PPUMASK (PPU Control Register 2)
          this.nes.ppu.writePpuMask(value);
        } else {
          // 2000 PPUCTRL (PPU Control Register 1)
          this.nes.ppu.writePpuCtrl(value);
        }
      } else if (address == 3) {
        // 2003 OAMADDR (Sprite RAM address)
        this.nes.ppu.writeSRAMAddress(value);
      }
    } else {
      if (address < 6) {
        if (address == 4) {
          // 2004 OAMDATA (Sprite memory read/write)
          this.nes.ppu.sramWrite(value);
        } else {
          // 2005 PPUSCROLL (Screen scroll offsets)
          this.nes.ppu.scrollWrite(value);
        }
      } else {
        if (address == 6) {
          // 2006 PPUADDR (VRAM address)
          this.nes.ppu.writeVRAMAddress(value);
        } else {
          // 2007 PPUDATA (VRAM read/write)
          this.nes.ppu.vramWrite(value);
        }
      }
    }
  }

  /** Handles all loads from $4000 .. $5fff. */
  load4(address) {
    if (address == 0x4015) {
      // 4015 APU Status
      return this.nes.papu.readStatus();
    } else if (address == 0x4016) {
      // 4016 Joystick 1 + Strobe -
      return this.joy1Read();
    } else if (address == 0x4017) {
      // 4017 Joystick 2 + Strobe - with zapper
      return this.joy2ReadWithZapper();
    }
    return 0;
  }

  /** Handles all writes to $4000 .. $5fff. */
  write4(address, value) {
    if (address < 0x4016) {
      if (address == 0x4014) {
        // 4014 OAMDMA (Sprite memory DMA access)
        this.nes.ppu.sramDMA(value);
      } else {
        this.nes.papu.writeReg(address, value);
      }
    } else if (address == 0x4016) {
      this.writeJoystickStrobe(value);
    } else if (address == 0x4017) {
      this.nes.papu.writeReg(address, value);
    }
  }

  /** Handles all writes to $8000 .. $ffff. */
  write8(address, value) {}

  initializePrgRam() {
    // May be overwritten to handle paging, etc.
    this.prgRam = new Uint8Array(0x2000);
  }

  initializePrgRomSwitcher() {
    // May be overwritten to handle paging, etc.
    this.prgRomSwitcher = new utils.RomBankSwitcher(this.nes.rom.rom, 0x8000);
  }

  initializePrgRom() {
    this.nes.cpu.prgRom = this.prgRomSwitcher.buffer();
  }

  initializeChrRomSwitcher() {
    if (this.nes.rom.vrom.length) {
      this.nes.ppu.importChrRom(this.nes.rom.vrom);
      this.chrRomSwitcher =
          new utils.RomBankSwitcher(this.nes.ppu.patternTableFull, 0x2000);
    } else {
      this.chrRam = new Uint16Array(0x2000);
      this.nes.ppu.patternTableFull = this.nes.ppu.patternTable = this.chrRam;
    }
  }

  initializePatternTables() {
    this.nes.ppu.patternTable = this.chrRomSwitcher.buffer();
  }

  reset() {
    this.joy1StrobeState = 0;
    this.joy2StrobeState = 0;
    this.joypadLastWrite = 0;

    this.zapperFired = false;
    this.zapperX = null;
    this.zapperY = null;

    this.loadBatteryRam();
  }

  writeJoystickStrobe(value) {
    // Joystick 1 + Strobe
    if ((value & 1) === 0 && (this.joypadLastWrite & 1) === 1) {
      this.joy1StrobeState = 0;
      this.joy2StrobeState = 0;
    }
    this.joypadLastWrite = value;
  }

  joy1Read() {
    let ret;

    if (this.joy1StrobeState < 8) {
      ret = this.nes.controllers[1].state[this.joy1StrobeState];
    } else {
      ret = this.joy1StrobeState == 19 ? 1 : 0;
    }
    this.joy1StrobeState++;
    if (this.joy1StrobeState === 24) {
      this.joy1StrobeState = 0;
    }

    return ret;
  }

  joy2Read() {
    let ret;

    if (this.joy2StrobeState < 8) {
      ret = this.nes.controllers[2].state[this.joy2StrobeState];
    } else {
      ret = this.joy2StrobeState == 19 ? 1 : 0;
    }

    this.joy2StrobeState++;
    if (this.joy2StrobeState === 24) {
      this.joy2StrobeState = 0;
    }

    return ret;
  }

  joy2ReadWithZapper() {
    // https://wiki.nesdev.com/w/index.php/Zapper
    let w;
    if (this.zapperX !== null &&
        this.zapperY !== null &&
        this.nes.ppu.isPixelWhite(this.zapperX, this.zapperY)) {
      w = 0;
    } else {
      w = 0x8;
    }
    if (this.zapperFired) {
      w |= 0x10;
    }
    return (this.joy2Read() | w) & 0xffff;
  }

  loadROM() {
    if (!this.nes.rom.valid || this.nes.rom.rom.length < 8192) {
      throw new Error("Invalid ROM! Unable to load.");
    }

    // TODO - if some of these are never overridden then simplify/hardcode
    this.initializePrgRomSwitcher();
    this.initializeChrRomSwitcher();
    this.initializePrgRam();
    this.initializePrgRom();
    if (this.chrRomSwitcher) {
      this.initializePatternTables();
    }

    this.loadBatteryRam();

    // Reset IRQ:
    //nes.getCpu().doResetInterrupt();
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }

  loadBatteryRam() {
    if (this.nes.rom.batteryRam) {
      var ram = this.nes.rom.batteryRam;
      if (ram !== null && ram.length === 0x2000) {
        // Load Battery RAM into memory:
        // utils.copyArrayElements(ram, 0, this.nes.cpu.mem, 0x6000, 0x2000);
        utils.copyArrayElements(ram, 0, this.prgRam, 0, 0x2000);

        // TODO - we can do better than this now that it's its own array
      }
    }
  }

  // Loads a page of PRG ROM
  loadPrgPage(address, bank, size) {
    this.prgRomSwitcher.swap(address & 0x7fff, bank, size);
    this.nes.cpu.prgRom = this.prgRomSwitcher.buffer();
  }

  // Effectively makes repeated calls to loadPrgPage
  loadPrgPages(...pages) {
    for (const [address, bank, size] of pages) {
      this.prgRomSwitcher.swap(address & 0x7fff, bank, size);
    }
    this.nes.cpu.prgRom = this.prgRomSwitcher.buffer();
  }

  // Loads a page of CHR ROM
  loadChrPage(address, bank, size) {
    if (this.nes.ppu.usingChrRam) return; // do nothing
    this.nes.ppu.triggerRendering();
    this.chrRomSwitcher.swap(address, bank, size);
    this.nes.ppu.patternTable = this.chrRomSwitcher.buffer();
  }

  // Effectively makes multiple calls to loadChrPage
  loadChrPages(...pages) {
    if (this.nes.ppu.usingChrRam) return; // do nothing
    this.nes.ppu.triggerRendering();
    for (const [address, bank, size] of pages) {
      this.chrRomSwitcher.swap(address, bank, size);
    }
    this.nes.ppu.patternTable = this.chrRomSwitcher.buffer();
  }

  clockIrqCounter() {
    // Does nothing. This is used by the MMC3 mapper.
  }

  // eslint-disable-next-line no-unused-vars
  latchAccess(address) {
    // Does nothing. This is used by MMC2.
  }

  // Returns an 8k bank number for the given address, or null if it does not come
  // from PRG ROM.  We could shrink this to 4k or 2k if needed - as long as (1) the
  // size is not larger than the smallest switchable page, and (2) the bank number
  // still fits within a byte, it does not matter that this is the same bank size
  // actually used by the switcher.  This is used for building CPU traces.
  prgRomBank(addr) {
    if (addr < 0x8000) return null;
    const fullAddr = this.prgRomSwitcher.map(addr & 0x7fff);
    return fullAddr >>> 13;
  }

  // Return the address into the ROM for the given bank and memory address.  This
  // is used for reconstructing CPU logs from traces.
  prgRomAddress(bank, addr) {
    const a = (bank << 13) | (addr & 0x1fff);
//    if (a == 0x383c6) debugger;
    return a;
  }

  writeExtSavestate() {}

  writeSavestate() {
    return Savestate.Mmap.of({
      joy1StrobeState: this.joy1StrobeState,
      joy2StrobeState: this.joy2StrobeState,
      joypadLastWrite: this.joypadLastWrite,
      prgRam: this.prgRam,
      chrRam: this.chrRam,
      prgRom: this.prgRomSwitcher && this.prgRomSwitcher.snapshot(),
      chrRom: this.chrRomSwitcher && this.chrRomSwitcher.snapshot(),
      ext: this.writeExtSavestate(),
    });
  }

  restoreExtSavestate(ext) {}

  restoreSavestate(mmap) {
    this.joy1StrobeState = mmap.joy1StrobeState;
    this.joy2StrobeState = mmap.joy2StrobeState;
    this.joypadLastWrite = mmap.joypadLastWrite;
    if (mmap.prgRam) this.prgRam.set(mmap.prgRam);
    if (mmap.chrRam) this.chrRam.set(mmap.chrRam);
    if (mmap.prgRom) {
      this.prgRomSwitcher.restore(mmap.prgRom);
      this.nes.cpu.prgRom = this.prgRomSwitcher.buffer();
    }
    if (mmap.chrRom) {
      this.chrRomSwitcher.restore(mmap.chrRom);
      this.nes.ppu.patternTable = this.chrRomSwitcher.buffer();
    }
    if (mmap.ext) {
      this.restoreExtSavestate(mmap.ext);
    }
  }

  clearCache() {
    if (this.prgRomSwitcher) this.prgRomSwitcher.cache.clear();
    if (this.chrRomSwitcher) this.chrRomSwitcher.cache.clear();
    this.restoreSavestate(this.writeSavestate());
  }
}
