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

    // Battery-backed RAM, if any.  If non-null, will be backed up
    // across resets.  Should be a view of a subset of RAM.
    // TODO - this is probably just a method?
    this.battery = null;
    // Included verbatim in snapshots.
    this.prgRam = null;
    
    // TODO - chrRam?

    // Array of Uint8Arrays and ordinary Arrays of functions.  When
    // taking snapshot, the source (ram or rom) and the offset are
    // recorded.  Initialized to a no-op so that uninitialized regions
    // don't blow up.
    this.cpuBanks = [[]];
    // Array of Uint8Arrays - we might combine this with cpuBanks?
    this.ppuBanks = [];

    // Memory mapping.  Values are indexes into this.cpuBanks, of which
    // there should certainly not be more than 255, since we will be
    // swapping arrays into those banks.  These two arrays are the
    // individually swappable regions of memory, and are initialized
    // once in initialize() and never mutated.
    this.cpuRead = new Uint8Array(SIZE_64K); // filled with zeros
    this.cpuWrite = new Uint8Array(SIZE_64K);
    this.ppuMap = new Uint8Array(SIZE_16K);
  }

  defineRegister(bank, reg, handler) {
    if (!bank) throw new Error(`No bank defined: ${reg}`);
    if (!(bank instanceof Array)) throw new Error(`Non-register bank: ${reg}`);
    const index = reg & (bank.length - 1);
    if (bank[index]) throw new Error(`Register already defined: ${reg}`);
    bank[index] = handler;
  }

  // Helper method for implementing initializeRegisters.
  onLoad(reg, getter) {
    this.defineRegister(this.cpuBanks[this.cpuRead[reg]], reg, getter);
  }

  onWrite(reg, setter) {
    this.defineRegister(this.cpuBanks[this.cpuWrite[reg]], reg, setter);
  }

  addBankInternal(prg, start, end, bank) {
    const banks = prg == this.ppuMap ? this.ppuBanks : this.cpuBanks;
    const index = banks.length;
    banks.push(bank);
    prg.fill(index, start, end);
  }

  addRamBank(start, end, bank) {
    this.cpuWrite.fill(this.cpuBanks.length, start, end);
    this.addBankInternal(this.cpuRead, start, end, bank);
  }

  addRomBank(start, end, bank) {
    this.addBankInternal(this.cpuRead, start, end, bank);
  }

  addRegisterBank(readOrWrite, start, end, size = end - start) {
    if (readOrWrite.includes('r')) {
      readOrWrite = readOrWrite.replace('r', '');
      this.addBankInternal(this.cpuRead, start, end, new Array(size));
    }
    if (readOrWrite.includes('w')) {
      readOrWrite = readOrWrite.replace('w', '');
      this.addBankInternal(this.cpuWrite, start, end, new Array(size));
    }
    if (readOrWrite) {
      throw new Error(`bad readOrWrite value: ${readOrWrite}`);
    }
  }

  addVramBank(start, end, bank) {
    this.addBankInternal(this.ppuMap, start, end, bank);
  }

  // NOTE: Just assume pattern tables are CHR RAM, since I don't
  // think it's necessarily clear from the mapper alone.
  // addVromBank(start, end, bank) {
  //   this.addBankInternal(this.ppuMap, start, end, bank);
  // }

  initializeRam() {
    this.addRamBank(0, 0x2000, this.nes.cpu.ram);
  }

  initializePrgRam() {
    // May be overwritten to handle paging, etc.
    this.prgRam = new Uint8Array(0x2000);
    this.addRamBank(0x6000, 0x8000, this.prgRam.subarray(0, 0x2000));
  }

  initializePrgRom() {
    // May be overwritten to handle paging, etc.
    this.addRomBank(0x8000, 0x10000, this.nes.rom.prgPage(0, 0x8000));
  }

  initializePalettes() {
    this.addVramBank(0x3f00, 0x4000, this.nes.ppu.vram.subarray(0x1100, 0x1120));
  }

  initializeNametables() {
    this.addVramBank(0x2000, 0x2400);
    this.addVramBank(0x2400, 0x2800);
    this.addVramBank(0x2800, 0x2c00);
    this.addVramBank(0x2c00, 0x3000);
    this.setNametableMapping(this.nes.ppu.vram, 0, 1, 2, 3);

    this.ppuMap.fill(this.ppuMap[0x2000], 0x3000, 0x3400);
    this.ppuMap.fill(this.ppuMap[0x2400], 0x3400, 0x3800);
    this.ppuMap.fill(this.ppuMap[0x2800], 0x3800, 0x3c00);
    this.ppuMap.fill(this.ppuMap[0x2c00], 0x3c00, 0x3f00);
  }

  initializePatternTableBanks() {
    this.addVramBank(0x0000, 0x1000);
    this.addVramBank(0x1000, 0x2000);
  }

  initializePatternTables() {
    const vromCount = this.nes.rom.vromCount();
    if (vromCount > 0) {
      this.loadChrPage(0x0000, 0, 0x1000);
      this.loadChrPage(0x1000, Math.min(vromCount - 1, 1), 0x1000);
    }
  }

  setNametableMapping(vram, n1, n2, n3, n4) {
    n1 <<= 10;
    n2 <<= 10;
    n3 <<= 10;
    n4 <<= 10;
    this.ppuBanks[this.ppuMap[0x2000]] = vram.subarray(n1, n1 + 0x400);
    this.ppuBanks[this.ppuMap[0x2400]] = vram.subarray(n2, n2 + 0x400);
    this.ppuBanks[this.ppuMap[0x2800]] = vram.subarray(n3, n3 + 0x400);
    this.ppuBanks[this.ppuMap[0x2c00]] = vram.subarray(n4, n4 + 0x400);
  }

  // Overridable method for special handling of certain read/writes.
  initializeRegisters() {
    this.addRegisterBank('rw', 0x2000, 0x4000, 8);
    this.addRegisterBank('rw', 0x4000, 0x6000);

    // ==== Set up APU Registers ====
    // 4000..4013, 4015, 4017: APU Control registers
    for (let address = 0x4000; address <= 0x4017; address++) {
      if (address == 0x4014 || address == 0x4016) continue;
      this.onWrite(address, (value, nes) => nes.papu.writeReg(address, value));
    }
    // 4015 read: APU Status
    this.onLoad(0x4015, (nes) => nes.papu.readReg(0x4015));

    // ==== Set up PPU Registers ====
    // 2000 PPUCTRL (PPU Control Register 1)
    this.onLoad(0x2000, (nes) => nes.ppu.reg1);
    this.onWrite(0x2000, (value, nes) => nes.ppu.updateControlReg1(value));
    // 2001 PPUMASK (PPU Control Register 2)
    this.onLoad(0x2001, (nes) => nes.ppu.reg2);
    this.onWrite(0x2001, (value, nes) => nes.ppu.updateControlReg2(value));
    // 2002 PPUSTATUS (PPU Status Register)
    this.onLoad(0x2002, (nes) => nes.ppu.readStatusRegister());
    // 2003 OAMADDR (Sprite RAM address)
    this.onWrite(0x2003, (value, nes) => nes.ppu.writeSRAMAddress(value));
    // 2004 OAMDATA (Sprite memory read/write)
    this.onLoad(0x2004, (nes) => nes.ppu.sramLoad());
    this.onWrite(0x2004, (value, nes) => nes.ppu.sramWrite(value));
    // 2005 PPUSCROLL (Screen scroll offsets)
    this.onWrite(0x2005, (value, nes) => nes.ppu.scrollWrite(value));
    // 2006 PPUADDR (VRAM address)
    this.onWrite(0x2006, (value, nes) => nes.ppu.writeVRAMAddress(value));
    // 2007 PPUDATA (VRAM read/write)
    this.onLoad(0x2007, (nes) => nes.ppu.vramLoad());
    this.onWrite(0x2007, (value, nes) => nes.ppu.vramWrite(value));
    // 4014 OAMDMA (Sprite memory DMA access)
    this.onWrite(0x4014, (value, nes) => nes.ppu.sramDMA(value));
    
    // ==== Joystick ====
    this.onWrite(0x4016, (value) => this.writeJoystickStrobe(value));
    this.onLoad(0x4016, () => this.joy1Read());
    // Joystick 2 + Strobe - 
    this.onLoad(0x4017, () => this.joy2ReadWithZapper());

    // ==== Battery ====
    // Hard-code this separately.
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

  loadPpu(address) {
    address &= 0x3fff;
    const bank = this.ppuBanks[this.ppuMap[address]];
    if (!bank) return 0;
    return bank[address & (bank.length - 1)];
  }

  loadPalette(address) {
    // Returns a 16-byte array based on the bank of the first element.
    // address should be either 0x3f00 or 0x3f10.
    const bank = this.ppuBanks[this.ppuMap[address]];
    if (!bank) return this.nes.ppu.vram.subarray(address - 0x2e00, address - 0x2df0);
    const masked = address & (bank.length - 1);
    return bank.subarray(masked, masked + 0x10);
  }

  loadTileScanline(address, reverse = false) {
    // Loads a single tile scanline by looking up the low and the high bytes
    // and intercalating them.  Assumes both bytes are in same bank.
    const bank = this.ppuBanks[this.ppuMap[address]];
    if (!bank) return 0;
    const masked = address & (bank.length - 1);
    let lo = bank[masked];
    let hi = bank[masked | 0x08];
    if (reverse) {
      lo = utils.reverseBits(lo);
      hi = utils.reverseBits(hi);
    }
    return INTERCALATE_LOW[lo] | INTERCALATE_HIGH[hi];

    // alternate version with no lookup table:
    // let value = bank[masked] | (bank[masked | 0x08] << 8);
    // let tmp = (value ^ (value >> 4)) & 0x00f0;
    // value ^= (tmp ^ (tmp << 4));
    // tmp = (value ^ (value >> 2)) & 0x0c0c;
    // value ^= (tmp ^ (tmp << 2));
    // tmp = (value ^ (value >> 1)) & 0x2222;
    // return value ^ (tmp ^ (tmp << 1));
  }

  writePpu(address, value) {
    address &= 0x3fff;
    const bank = this.ppuBanks[this.ppuMap[address]];
    if (!bank) return;
    bank[address & (bank.length - 1)] = value;
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

    this.initializeRam();
    this.initializePrgRam();
    this.initializePrgRom();
    this.initializeRegisters();
    this.initializePatternTableBanks();
    this.initializePatternTables();
    this.initializeNametables();
    this.initializePalettes();

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

  loadCHRROM() {
    // console.log("Loading CHR ROM..");
    if (this.nes.rom.vromCount > 0) {
      if (this.nes.rom.vromCount === 1) {
        this.loadVromBank(0, 0x0000);
        this.loadVromBank(0, 0x1000);
      } else {
        this.loadVromBank(0, 0x0000);
        this.loadVromBank(1, 0x1000);
      }
    } else {
      //System.out.println("There aren't any CHR-ROM banks..");
    }
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
    this.cpuBanks[this.cpuRead[address]] = this.nes.rom.prgPage(bank, size);
  }

  // Loads a page of CHR ROM
  loadChrPage(address, bank, size) {
    // How to prevent modification?
    this.ppuBanks[this.ppuMap[address]] = this.nes.rom.chrPage(bank, size);
if(window.DEBUG)console.log(`load ${size} rom bank ${bank} @ ${address.toString(16).padStart(6,0)}: ${Array.from(this.nes.rom.chrPage(bank, size)).slice(0,20).join(',')}`);
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
  // from PRG ROM.
  prgRomBank(addr) {
    // TODO - we currently hard-code 8k pages, but this is not necessarily
    // the case; it should be overridden by the particular mapper, or else
    // configure what the page size is in the ctor?
    const bank = this.cpuBanks[this.cpuRead[addr]];
    if (bank && bank.buffer == this.nes.rom.rom.buffer) {
      return bank.byteOffset >>> 13;
    }
    return null;
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
