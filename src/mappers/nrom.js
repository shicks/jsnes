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
    this.ram = null;
    // Array of Uint8Arrays and ordinary Arrays of functions.  When
    // taking snapshot, the source (ram or rom) and the offset are
    // recorded.
    this.prgBanks = [];

    // Memory mapping.  Lower 8 bits is an index into a banks variable.
    // The length of the bank must be a power of two and is used to mask
    // out irrelevant offsets.  These are initialized once in initialize()
    // and never mutated.  The banks may contain functions, which will be
    // used as appropriate.
    this.prgRead = new Uint16Array(0x10000);
    this.prgWrite = new Uint16Array(0x10000);
   }

  // Helper method for implementing initializeRegisters.
  onloadWrite(registers) {
    return {
      onLoad(reg, getter) {
        registers[reg] = registers[reg] || {load: NULL_READ, write: NULL_WRITE};
        registers[reg].load = getter;
      },
      onWrite(reg, setter) {
        registers[reg] = registers[reg] || {load: NULL_READ, write: NULL_WRITE};
        registers[reg].write = setter;
      },
    };
  }

  // Helper method for implementing initializeRegisters.
  mirror(array, start, end, mirrorEnd) {
    for (let addr = end; addr < mirrorEnd; addr++) {
      array[addr] = array[start + ((addr - start) % (end - start))];
    }
  }

  initializePrgRam(registers) {
    // May be overridden by mappers that have PRG RAM paging.
    // TODO - may need to rethink ordering wrt. loading from disk and clobbering
    this.prgRam = new Uint8Array(0x2000);
    for (let address = 0x6000; address < 0x8000; address++) {
      const prgRamAddr = address & 0x1fff;
      onLoad(address, () => this.prgRam[prgRamAddr]);
      onWrite(address, (value) => {
        this.prgRam[prgRamAddr] = value;
        this.nes.opts.onBatteryRamWrite(address, value);
      });
    }
  }

  initializeBanks() {
    this.prgBanks.add
  }

  // Overridable method for special handling of certain read/writes.
  initializeRegisters(registers) {
    const {onLoad, onWrite} = this.onLoadWrite(registers);
    // ==== Set up APU Registers ====
    // Note: 0x4014 and 0x4016 are not APU registers and will be overwritten
    // later in this function.
    const apuWrite = (value) => this.nes.papu.writeReg(address, value);
    for (let address = 0x4000; address <= 0x4017; address++) {
      onWrite(address, apuWrite);
    }
    // APU Status
    onLoad(0x4015, () => this.nes.papu.readReg(0x4015));

    // ==== Set up PPU Registers ====
    // PPUCTRL (PPU Control Register 1)
    onLoad(0x2000, () => this.nes.ppu.reg1);
    onWrite(0x2000, (value) => this.nes.ppu.updateControlReg1(value));
    // PPUMASK (PPU Control Register 2)
    onLoad(0x2001, () => this.nes.ppu.reg2);
    onWrite(0x2001, (value) => this.nes.ppu.updateControlReg2(value));
    // PPUSTATUS (PPU Status Register)
    onLoad(0x2002, () => this.nes.ppu.readStatusRegister());
    // OAMADDR (Sprite RAM address)
    onWrite(0x2003, (value) => this.nes.ppu.writeSRAMAddress(value));
    // OAMDATA (Sprite memory read/write)
    onLoad(0x2004, () => this.nes.ppu.sramLoad());
    onWrite(0x2004, (value) => this.nes.ppu.sramWrite(value));
    // PPUSCROLL (Screen scroll offsets)
    onWrite(0x2005, (value) => this.nes.ppu.scrollWrite(value));
    // PPUADDR (VRAM address)
    onWrite(0x2006, (value) => this.nes.ppu.writeVRAMAddress(value));
    // PPUDATA (VRAM read/write)
    onLoad(0x2007, () => this.nes.ppu.vramLoad());
    onWrite(0x2007, (value) => this.nes.ppu.vramWrite(value));
    // OAMDMA (Sprite memory DMA access)
    onWrite(0x4014, (value) => this.nes.ppu.sramDMA(value));
    // Mirrors
    this.mirror(registers, 0x2000, 0x2008, 0x4000);
    
    // ==== Joystick ====
    onWrite(0x4016, (value) => this.writeJoystickStrobe(value));
    onLoad(0x4016, () => this.joy1Read());
    // Joystick 2 + Strobe - 
    onLoad(0x4017, () => this.joy2ReadWithZapper());

    // ==== RAM Mirroring ====
    for (let address = 0x800; address < 0x2000; address++) {
      const mirrored = address & 0x7ff;
      onLoad(address, () => this.nes.cpu.mem[mirrored]);
      onWrite(address, (value) => this.nes.cpu.mem[mirrored] = value);
    }

    // ==== Battery ====
  }

  reset() {
    this.joy1StrobeState = 0;
    this.joy2StrobeState = 0;
    this.joypadLastWrite = 0;

    this.zapperFired = false;
    this.zapperX = null;
    this.zapperY = null;
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
    if (address < 0x2000) {
      // Mirroring of RAM:
      this.nes.cpu.mem[address & 0x7ff] = value;
    } else if (address > 0x4017 && address < 0x8000) {
      this.nes.cpu.mem[address] = value;
      if (address >= 0x6000 && address < 0x8000) {
        // Write to persistent RAM
        this.nes.opts.onBatteryRamWrite(address, value);
      }
    } else if (address > 0x2007 && address < 0x4000) {
      this.regWrite(0x2000 + (address & 0x7), value);
    } else {
      this.regWrite(address, value);
    }
  }

  load(address) {
    // Wrap around:
    address &= 0xffff;

    // Check address range:
    if (address > 0x4017) {
      // ROM:
      return this.nes.cpu.mem[address];
    } else if (address >= 0x2000) {
      // I/O Ports.
      return this.regLoad(address);
    } else {
      // RAM (mirrored)
      return this.nes.cpu.mem[address & 0x7ff];
    }
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
    if (!this.nes.rom.valid || this.nes.rom.romCount < 1) {
      throw new Error("NoMapper: Invalid ROM! Unable to load.");
    }

    // Load ROM into memory:
    this.loadPRGROM();

    // Load CHR-ROM:
    this.loadCHRROM();

    // Load Battery RAM (if present):
    this.loadBatteryRam();

    // Reset IRQ:
    //nes.getCpu().doResetInterrupt();
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }

  loadPRGROM() {
    if (this.nes.rom.romCount > 1) {
      // Load the two first banks into memory.
      this.loadRomBank(0, 0x8000);
      this.loadRomBank(1, 0xc000);
    } else {
      // Load the one bank into both memory locations:
      this.loadRomBank(0, 0x8000);
      this.loadRomBank(0, 0xc000);
    }
  }

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
        utils.copyArrayElements(ram, 0, this.nes.cpu.mem, 0x6000, 0x2000);
      }
    }
  }

  loadRomBank(bank, address) {
    // Loads a ROM bank into the specified address.
    bank %= this.nes.rom.romCount;
    //var data = this.nes.rom.rom[bank];
    //cpuMem.write(address,data,data.length);
    utils.copyArrayElements(
      this.nes.rom.rom[bank],
      0,
      this.nes.cpu.mem,
      address,
      16384
    );
    // keep track of which banks are loaded
    const num = address >> 13;
    this.nes.banks[num] = bank * 2;
    this.nes.banks[num + 1] = bank * 2 + 1;
    //console.log(`Load 16k bank ${(bank << 14).toString(16)} at ${address.toString(16)}`);
  }

  loadVromBank(bank, address) {
    if (this.nes.rom.vromCount === 0) {
      return;
    }
    this.nes.ppu.triggerRendering();

    utils.copyArrayElements(
      this.nes.rom.vrom[bank % this.nes.rom.vromCount],
      0,
      this.nes.ppu.vramMem,
      address,
      4096
    );

    var vromTile = this.nes.rom.vromTile[bank % this.nes.rom.vromCount];
    utils.copyArrayElements(
      vromTile,
      0,
      this.nes.ppu.ptTile,
      address >> 4,
      256
    );
  }

  load32kRomBank(bank, address) {
    this.loadRomBank((bank * 2) % this.nes.rom.romCount, address);
    this.loadRomBank((bank * 2 + 1) % this.nes.rom.romCount, address + 16384);
  }

  load8kVromBank(bank4kStart, address) {
    if (this.nes.rom.vromCount === 0) {
      return;
    }
    this.nes.ppu.triggerRendering();

    this.loadVromBank(bank4kStart % this.nes.rom.vromCount, address);
    this.loadVromBank(
      (bank4kStart + 1) % this.nes.rom.vromCount,
      address + 4096
    );
  }

  load1kVromBank(bank1k, address) {
    if (this.nes.rom.vromCount === 0) {
      return;
    }
    this.nes.ppu.triggerRendering();

    var bank4k = Math.floor(bank1k / 4) % this.nes.rom.vromCount;
    var bankoffset = (bank1k % 4) * 1024;
    utils.copyArrayElements(
      this.nes.rom.vrom[bank4k],
      0,
      this.nes.ppu.vramMem,
      bankoffset,
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
    if (this.nes.rom.vromCount === 0) {
      return;
    }
    this.nes.ppu.triggerRendering();

    var bank4k = Math.floor(bank2k / 2) % this.nes.rom.vromCount;
    var bankoffset = (bank2k % 2) * 2048;
    utils.copyArrayElements(
      this.nes.rom.vrom[bank4k],
      bankoffset,
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

  load8kRomBank(bank8k, address) {
    var bank16k = Math.floor(bank8k / 2) % this.nes.rom.romCount;
    var offset = (bank8k % 2) * 8192;

    //this.nes.cpu.mem.write(address,this.nes.rom.rom[bank16k],offset,8192);
    utils.copyArrayElements(
      this.nes.rom.rom[bank16k],
      offset,
      this.nes.cpu.mem,
      address,
      8192
    );

    // keep track of which banks are loaded
    const num = address >> 13;
    this.nes.banks[num] = bank8k;
    //if((bank8k&1)!=(num&1))  // only log for misaligned pages?
    //console.log(`Load 8k bank ${(bank8k << 13).toString(16)} at ${address.toString(16)}`);
  }

  clockIrqCounter() {
    // Does nothing. This is used by the MMC3 mapper.
  }

  // eslint-disable-next-line no-unused-vars
  latchAccess(address) {
    // Does nothing. This is used by MMC2.
  }

  toJSON() {
    return {
      joy1StrobeState: this.joy1StrobeState,
      joy2StrobeState: this.joy2StrobeState,
      joypadLastWrite: this.joypadLastWrite
    };
  }

  fromJSON(s) {
    this.joy1StrobeState = s.joy1StrobeState;
    this.joy2StrobeState = s.joy2StrobeState;
    this.joypadLastWrite = s.joypadLastWrite;
  }
}
