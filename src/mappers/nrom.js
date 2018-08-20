import * as utils from '../utils.js';

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

    this.prgRomSwitcher = null;
    this.chrRomSwitcher = null;
    
    // TODO - chrRam?

    // Array of the four currently selected 8k banks for PRG ROM.  Anything else
    // (swappable PRG RAM, smaller ROM banks, etc) requires special handler for
    // proper snapshooting.
    // this.cpuBanks = null;

    // NOTE: we don't worry about storing the PPU banks.  Since CHR-RAM is pretty
    // common in many mappers, we just support it by default, which means that
    // snapshots need to include the full contents of VRAM anyway.  If a mapper
    // has CHR RAM swapping, it will need special support anyway.
  }

  load(address) {
    if (address < 0x6000) {
      if (address < 0x4000) {
        return this.load2(address);
      }
      return this.load4(address);
    }
    return this.prgRam[address & 0x1fff];
  }

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

  load2(address) {
    address &= 0x7;
    if (address < 4) {
      if (address < 2) {
        return address ?
            // 2001 PPUMASK (PPU Control Register 2)
            this.nes.ppu.reg2 :
            // 2000 PPUCTRL (PPU Control Register 1)
            this.nes.ppu.reg1;
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

  write2(address, value) {
    address &= 0x7;
    if (address < 4) {
      if (address < 2) {
        if (address) {
          // 2001 PPUMASK (PPU Control Register 2)
          this.nes.ppu.updateControlReg2(value));
        } else {
          // 2000 PPUCTRL (PPU Control Register 1)
          this.nes.ppu.updateControlReg1(value));
        }
      } else if (address == 3) {
        // 2003 OAMADDR (Sprite RAM address)
        this.nes.ppu.writeSRAMAddress(value));
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

  load4(address) {
    if (address == 0x4015) {
      // 4015 APU Status
      return this.nes.papu.readReg(0x4015);
    } else if (address == 0x4016) {
      // 4016 Joystick 1 + Strobe -
      return this.joy1Read();
    } else if (address == 0x4017) {
      // 4017 Joystick 2 + Strobe - with zapper
      return this.joy2ReadWithZapper();
    }
    return 0;
  }

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

  write8(address, value) {}

  initializePrgRam() {
    // May be overwritten to handle paging, etc.
    this.prgRam = new Uint8Array(0x2000);
  }

  initializePrgRom() {
    // May be overwritten to handle paging, etc.
    this.prgRomSwitcher = new utils.RomBankSwitcher(this.nes.rom.rom, 0x8000);
    this.nes.cpu.prgRom = this.prgRomSwitcher.buffer();

    // this.nes.cpu.prgRom8 = this.nes.rom.page(0, 0x2000);
    // this.nes.cpu.prgRomA = this.nes.rom.page(1, 0x2000);
    // this.nes.cpu.prgRomC = this.nes.rom.page(2, 0x2000);
    // this.nes.cpu.prgRomE = this.nes.rom.page(3, 0x2000);
  }

  initializeNametables() {
    // this.setNametableMapping(this.nes.ppu.vram, 0, 1, 2, 3);

    // this.ppuMap.fill(this.ppuMap[0x2000], 0x3000, 0x3400);
    // this.ppuMap.fill(this.ppuMap[0x2400], 0x3400, 0x3800);
    // this.ppuMap.fill(this.ppuMap[0x2800], 0x3800, 0x3c00);
    // this.ppuMap.fill(this.ppuMap[0x2c00], 0x3c00, 0x3f00);
  }

  initializePatternTables() {
    if (this.nes.rom.vrom && this.nes.rom.vrom.length) {
      this.nes.ppu.importChrRom(this.nes.rom.vrom);
      this.nes.ppu.usingChrRam = false;
    }
    this.chrRomSwitcher =
        new utils.RomBankSwitcher(this.nes.ppu.patternTableFull, 0x2000);
    this.nes.ppu.patternTable = this.chrRomSwitcher.buffer();
  }

  // setNametableMapping(vram, n1, n2, n3, n4) {
  //   n1 <<= 10;
  //   n2 <<= 10;
  //   n3 <<= 10;
  //   n4 <<= 10;
  //   this.ppuBanks[this.ppuMap[0x2000]] = vram.subarray(n1, n1 + 0x400);
  //   this.ppuBanks[this.ppuMap[0x2400]] = vram.subarray(n2, n2 + 0x400);
  //   this.ppuBanks[this.ppuMap[0x2800]] = vram.subarray(n3, n3 + 0x400);
  //   this.ppuBanks[this.ppuMap[0x2c00]] = vram.subarray(n4, n4 + 0x400);
  // }

  reset() {
    this.joy1StrobeState = 0;
    this.joy2StrobeState = 0;
    this.joypadLastWrite = 0;

    this.zapperFired = false;
    this.zapperX = null;
    this.zapperY = null;

    this.loadBatteryRam();
  }

  // New plan:
  //   rewrite all reads/writes of mem[x] to mem[x >> PRG_BANK_SIZE][x & PRG_BANK_MASK]
  //   bank switching is just copying a few array refs
  //   mirroring is just copying the same ref
  //   registers are just getters/setters on some special non-array banks
  //   add an extra (1<<PRG_BANK_SIZE) element to the bank to keep track of where
  //     it came from?
  // problem - simply copying in the banks is not quite right, since they need
  // different write behaviors depending on where they are.  instead, do a getter
  // indirection where paged roms' getters look up the current bank and return that.

  write(address, value) {
    const bank = this.cpuBanks[this.cpuWrite[address]];
    if (!bank) return;
    const index = address & (bank.length - 1);
    const oldValue = bank[index];
    if (oldValue >= 0) { // is it a number, rather than undefined or a function?
      bank[index] = value;
    } else if (typeof oldValue == 'function') {
      oldValue(value, this.nes);
    }
    if (address >= 0x6000 && address < 0x8000) {
      this.nes.battery.store(address);
    }
  }

  load(address) {
    const bank = this.cpuBanks[this.cpuRead[address]];
    if (!bank) return 0;
    const index = address & (bank.length - 1);
    const value = bank[index];
    if (value >= 0) return value;
    return typeof value == 'function' ? value(this.nes) : 0;
  }

  // loadPpu(address) {
  //   address &= 0x3fff;
  //   const bank = this.ppuBanks[this.ppuMap[address]];
  //   if (!bank) return 0;
  //   return bank[address & (bank.length - 1)];
  // }

  // loadPalette(address) {
  //   // Returns a 16-byte array based on the bank of the first element.
  //   // address should be either 0x3f00 or 0x3f10.
  //   const bank = this.ppuBanks[this.ppuMap[address]];
  //   if (!bank) return this.nes.ppu.vram.subarray(address - 0x2e00, address - 0x2df0);
  //   const masked = address & (bank.length - 1);
  //   return bank.subarray(masked, masked + 0x10);
  // }

  // loadTileScanline(address, reverse = false) {
  //   // Loads a single tile scanline by looking up the low and the high bytes
  //   // and intercalating them.  Assumes both bytes are in same bank.
  //   const bank = this.ppuBanks[this.ppuMap[address]];
  //   if (!bank) return 0;
  //   const masked = address & (bank.length - 1);
  //   let lo = bank[masked];
  //   let hi = bank[masked | 0x08];
  //   if (reverse) {
  //     lo = utils.reverseBits(lo);
  //     hi = utils.reverseBits(hi);
  //   }
  //   return INTERCALATE_LOW[lo] | INTERCALATE_HIGH[hi];

  //   // alternate version with no lookup table:
  //   // let value = bank[masked] | (bank[masked | 0x08] << 8);
  //   // let tmp = (value ^ (value >> 4)) & 0x00f0;
  //   // value ^= (tmp ^ (tmp << 4));
  //   // tmp = (value ^ (value >> 2)) & 0x0c0c;
  //   // value ^= (tmp ^ (tmp << 2));
  //   // tmp = (value ^ (value >> 1)) & 0x2222;
  //   // return value ^ (tmp ^ (tmp << 1));
  // }

  // writePpu(address, value) {
  //   address &= 0x3fff;
  //   const bank = this.ppuBanks[this.ppuMap[address]];
  //   if (!bank) return;
  //   bank[address & (bank.length - 1)] = value;
  // }

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

    this.initializePrgRam();
    this.initializePrgRom();
    this.initializePatternTables();
    this.initializeNametables();

    // // Load ROM into memory:
    // this.loadPRGROM();

    // Load CHR-ROM:
    //this.loadCHRROM();

    // Load Battery RAM (if present):
    this.loadBatteryRam();

    // Reset IRQ:
    //nes.getCpu().doResetInterrupt();
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);

    // Ensure super.initializeRegisters was called!
    if (!this.cpuWrite[0x4015]) {
      throw new Error('Forgot to call super.initializeRegisters?');
    }
  }

  // loadPRGROM() {
  //   if (this.nes.rom.romCount > 1) {
  //     // Load the two first banks into memory.
  //     this.loadRomBank(0, 0x8000);
  //     this.loadRomBank(1, 0xc000);
  //   } else {
  //     // Load the one bank into both memory locations:
  //     this.loadRomBank(0, 0x8000);
  //     this.loadRomBank(0, 0xc000);
  //   }
  // }

  // loadCHRROM() {
  //   // console.log("Loading CHR ROM..");
  //   if (this.nes.rom.vromCount > 0) {
  //     if (this.nes.rom.vromCount === 1) {
  //       this.loadVromBank(0, 0x0000);
  //       this.loadVromBank(0, 0x1000);
  //     } else {
  //       this.loadVromBank(0, 0x0000);
  //       this.loadVromBank(1, 0x1000);
  //     }
  //   } else {
  //     //System.out.println("There aren't any CHR-ROM banks..");
  //   }
  // }

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

  // loadRomBank(bank, address) {
  //   // Loads a ROM bank into the specified address.
  //   bank %= this.nes.rom.romCount;
  //   //var data = this.nes.rom.rom[bank];
  //   //cpuMem.write(address,data,data.length);
  //   utils.copyArrayElements(
  //     this.nes.rom.rom[bank],
  //     0,
  //     this.nes.cpu.mem,
  //     address,
  //     16384
  //   );
  //   // keep track of which banks are loaded
  //   const num = address >> 13;
  //   this.nes.banks[num] = bank * 2;
  //   this.nes.banks[num + 1] = bank * 2 + 1;
  //   //console.log(`Load 16k bank ${(bank << 14).toString(16)} at ${address.toString(16)}`);
  // }

  loadVromBank(bank, address) {
    if (!this.nes.rom.vrom.length) return;
    this.nes.ppu.triggerRendering();

    utils.copyArrayElements(
      this.nes.rom.vrom, // [bank % this.nes.rom.vromCount],
      (bank * 4096) % (this.nes.rom.vrom.length & ~0xfff),
      this.nes.ppu.vramMem,
      address,
      4096
    );

    var vromTile = this.nes.rom.vromTile[bank % this.nes.rom.vromCount()];
    utils.copyArrayElements(
      vromTile,
      0,
      this.nes.ppu.ptTile,
      address >> 4,
      256
    );
  }

  // load32kRomBank(bank, address) {
  //   this.loadRomBank((bank * 2) % this.nes.rom.romCount, address);
  //   this.loadRomBank((bank * 2 + 1) % this.nes.rom.romCount, address + 16384);
  // }

  load8kVromBank(bank4kStart, address) {
    if (!this.nes.rom.vrom.length) return;
    this.nes.ppu.triggerRendering();

    this.loadVromBank(bank4kStart % this.nes.rom.vromCount(), address);
    this.loadVromBank(
      (bank4kStart + 1) % this.nes.rom.vromCount(),
      address + 4096
    );
  }

  load1kVromBank(bank1k, address) {
    if (!this.nes.rom.vrom.length) return;
    this.nes.ppu.triggerRendering();

    var bank4k = Math.floor(bank1k / 4) % this.nes.rom.vromCount();
    utils.copyArrayElements(
      this.nes.rom.vrom, // [bank4k],
      bank1k * 1024,
      this.nes.ppu.vramMem,
      address,
      1024
    );

    // Update tiles:
    var vromTile = this.nes.rom.vromTile[bank4k];
    var baseIndex = address >> 4;
    for (var i = 0; i < 64; i++) {
      this.nes.ppu.ptTile[baseIndex + i] = vromTile[((bank1k % 4) << 6) + i];
    }
  }

  load2kVromBank(bank2k, address) {
    if (!this.nes.rom.vrom.length) return;
    this.nes.ppu.triggerRendering();

    var bank4k = Math.floor(bank2k / 2) % this.nes.rom.vromCount();
    utils.copyArrayElements(
      this.nes.rom.vrom,
      bank2k * 2048,
      this.nes.ppu.vramMem,
      address,
      2048
    );

    // Update tiles:
    var vromTile = this.nes.rom.vromTile[bank4k];
    var baseIndex = address >> 4;
    for (var i = 0; i < 128; i++) {
      this.nes.ppu.ptTile[baseIndex + i] = vromTile[((bank2k % 2) << 7) + i];
    }
  }

  // Loads a page of PRG ROM
  loadPrgPage(address, bank, size) {
    // this.cpuBanks[this.cpuRead[address]] = this.nes.rom.prgPage(bank, size);

    // what size??? 8k? 16k? 32k?
    // just delegate to CPU or muck with CPU internals here?

    this.nes.cpu.loadPrgPage(address, bank, size);
  }

  // Loads a page of CHR ROM
  loadChrPage(address, bank, size) {
    this.nes.ppu.triggerRendering();
    this.chrRomSwitcher.swap(address, bank, size);
    this.nes.ppu.patternTable = this.chrRomSwitcher.buffer();
    // How to prevent modification?
//     this.ppuBanks[this.ppuMap[address]] = this.nes.rom.chrPage(bank, size);
// if(window.DEBUG)console.log(`load ${size} rom bank ${bank} @ ${address.toString(16).padStart(6,0)}: ${Array.from(this.nes.rom.chrPage(bank, size)).slice(0,20).join(',')}`);
    // this.nes.ppu.loadChrPage(address, bank, size);
  }

  // load8kRomBank(bank8k, address) {
  //   var bank16k = Math.floor(bank8k / 2) % this.nes.rom.romCount;
  //   var offset = (bank8k % 2) * 8192;

  //   //this.nes.cpu.mem.write(address,this.nes.rom.rom[bank16k],offset,8192);
  //   utils.copyArrayElements(
  //     this.nes.rom.rom[bank16k],
  //     offset,
  //     this.nes.cpu.mem,
  //     address,
  //     8192
  //   );

  //   // keep track of which banks are loaded
  //   const num = address >> 13;
  //   this.nes.banks[num] = bank8k;
  //   //if((bank8k&1)!=(num&1))  // only log for misaligned pages?
  //   //console.log(`Load 8k bank ${(bank8k << 13).toString(16)} at ${address.toString(16)}`);
  // }

  clockIrqCounter() {
    // Does nothing. This is used by the MMC3 mapper.
  }

  // eslint-disable-next-line no-unused-vars
  latchAccess(address) {
    // Does nothing. This is used by MMC2.
  }

  // returns a bank number for the given address, or null if it does not come
  // from PRG ROM.  Assumes 8k banks.
  prgRomBank(addr) {
    if (addr >= 0x8000) {
      return this.prgRomSwitcher.

    // TODO - we currently hard-code 8k pages, but this is not necessarily
    // the case; it should be overridden by the particular mapper, or else
    // configure what the page size is in the ctor?
    // const bank = this.cpuBanks[this.cpuRead[addr]];
    // if (bank && bank.buffer == this.nes.rom.rom.buffer) {
    //   return bank.byteOffset >>> 13;
    // }
    // return null;
  }

  // Return the address into the ROM for the given bank and memory address.
  prgRomAddress(bank, addr) {
    return (bank << 13) | (addr & 0x1fff);
  }

  toJSON() {
    return {
      joy1StrobeState: this.joy1StrobeState,
      joy2StrobeState: this.joy2StrobeState,
      joypadLastWrite: this.joypadLastWrite,
      prgRam: Array.from(this.prgRam),
      prg: this.serializeBanks(this.cpuBanks),
    };
  }

  fromJSON(s) {
    this.joy1StrobeState = s.joy1StrobeState;
    this.joy2StrobeState = s.joy2StrobeState;
    this.joypadLastWrite = s.joypadLastWrite;
    this.prgRam = Uint8Array.from(s.prgRam);
    this.deserializeBanks(this.cpuBanks, s.prg);
  }

  serializeBanks(banks) {
    return banks.map(bank => {
      let source;
      if (bank.buffer == this.nes.rom.rom.buffer) {
        source = 'prg-rom';
      } else if (bank.buffer == this.prgRam.buffer) {
        source = 'prg-ram';
      } else if (bank.buffer == this.nes.cpu.ram.buffer) {
        source = 'ram';
      } else if (bank.buffer == this.nes.rom.vrom.buffer) {
        source = 'chr';
      }
      return source ? [source, bank.byteOffset, bank.byteLength] : null;
    });
  }

  deserializeBanks(banks, data) {
    const sources = {
      'prg-rom': this.nes.rom.rom.buffer,
      'prg-ram': this.prgRam.buffer,
      'ram': this.nes.cpu.ram.buffer,
      'chr': this.nes.rom.vrom.buffer,
    };
    for (let i = 0; i < data.length; i++) {
      if (!data[i]) continue;
      banks[i] = sources[data[i][0]].subarray(data[i][1], data[i][2]);
    }
  }
}

// Look up tables for intercalated zeros in a number
// abcdefgh -> 0a0b0c0d0e0f0g0h or a0b0c0d0e0f0g0h0
const [INTERCALATE_LOW, INTERCALATE_HIGH] = (() => {
  const lo = new Uint16Array(256);
  const hi = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    let value = 0;
    let shift = 0;
    let x = i;
    while (x) {
      if (x & 1) {
        value |= (1 << shift);
      }
      x >>>= 1;
      shift += 2;
    }
    lo[i] = value;
    hi[i] = value << 1;
  }
  return [lo, hi];
})();
