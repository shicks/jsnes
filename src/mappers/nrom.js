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
    this.prgRam = null;
    // Array of Uint8Arrays and ordinary Arrays of functions.  When
    // taking snapshot, the source (ram or rom) and the offset are
    // recorded.  Initialized to a no-op so that uninitialized regions
    // don't blow up.
    this.prgBanks = [[undefined]];

    // Memory mapping.  Values are indexes into this.prgBanks, of which
    // there should certainly not be more than 255, since we will be
    // swapping arrays into those banks.  These two arrays are the
    // individually swappable regions of memory, and are initialized
    // once in initialize() and never mutated.
    this.prgRead = new Uint8Array(0x10000); // filled with zeros
    this.prgWrite = new Uint8Array(0x10000);
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
    this.defineRegister(this.prgBanks[this.prgRead[reg]], reg, getter);
  }

  onWrite(reg, setter) {
    this.defineRegister(this.prgBanks[this.prgWrite[reg]], reg, setter);
  }

  addBankInternal(prg, start, end, bank) {
    const index = this.prgBanks.length;
    this.prgBanks.push(bank);
    prg.fill(index, start, end);
    return index;
  }

  addRamBank(start, end, bank) {
    this.prgWrite.fill(this.prgBanks.length, start, end);
    return this.addBankInternal(this.prgRead, start, end, bank);
  }

  addRomBank(start, end, bank) {
    return this.addBankInternal(this.prgRead, start, end, bank);
  }

  addRegisterBank(readOrWrite, start, end, size = end - start) {
    if (readOrWrite.includes('r')) {
      readOrWrite = readOrWrite.replace('r', '');
      this.addBankInternal(this.prgRead, start, end, new Array(size));
    }
    if (readOrWrite.includes('w')) {
      readOrWrite = readOrWrite.replace('w', '');
      this.addBankInternal(this.prgWrite, start, end, new Array(size));
    }
    if (readOrWrite) {
      throw new Error(`bad readOrWrite value: ${readOrWrite}`);
    }
  }

  initializeRam() {
    this.ram = new Uint8Array(0x800).fill(0xff);
    this.ram[0x8] = 0xf7; // just call reset()?
    this.ram[0x9] = 0xef;
    this.ram[0xa] = 0xdf;
    this.ram[0xf] = 0xbf;
    this.addRamBank(0, 0x2000, this.ram);
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

    if (this.ram) {
      this.ram.fill(0);
      // CPU RAM apparently resets to all $ff?
      this.ram.fill(0xff);
      this.ram[0x8] = 0xf7;
      this.ram[0x9] = 0xef;
      this.ram[0xa] = 0xdf;
      this.ram[0xf] = 0xbf;
    }
    
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
    const bank = this.prgBanks[this.prgWrite[address]];
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
    const bank = this.prgBanks[this.prgRead[address]];
    if (!bank) return;
    const index = address & (bank.length - 1);
    const value = bank[index];
    if (value >= 0) return value;
    return typeof value == 'function' ? value(this.nes) : 0;
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

    // // Load ROM into memory:
    // this.loadPRGROM();

    // Load CHR-ROM:
    this.loadCHRROM();

    // Load Battery RAM (if present):
    this.loadBatteryRam();

    // Reset IRQ:
    //nes.getCpu().doResetInterrupt();
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);

    // Ensure super.initializeRegisters was called!
    if (!this.prgWrite[0x4015]) {
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

  loadPrgPage(address, bank, size) {
    this.prgBanks[this.prgRead[address]] = this.nes.rom.prgPage(bank, size);
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
    const bank = this.prgBanks[this.prgRead[addr]];
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
      ram: this.ram,
      prg: this.serializeBanks(this.prgBanks),
    };
  }

  fromJSON(s) {
    this.joy1StrobeState = s.joy1StrobeState;
    this.joy2StrobeState = s.joy2StrobeState;
    this.joypadLastWrite = s.joypadLastWrite;
    this.ram = s.ram;
    this.deserializeBanks(this.prgBanks, s.prg);
  }

  serializeBanks(banks) {
    return banks.map(bank => {
      let source;
      if (bank.buffer == this.nes.rom.rom.buffer) {
        source = 'prg-rom';
      } else if (bank.buffer == this.prgRam.buffer) {
        source = 'prg-ram';
      } else if (bank.buffer == this.ram.buffer) {
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
      'ram': this.ram.buffer,
      'chr': this.nes.rom.vrom.buffer,
    };
    for (let i = 0; i < data.length; i++) {
      if (!data[i]) continue;
      banks[i] = sources[data[i][0]].subarray(data[i][1], data[i][2]);
    }
  }
}
