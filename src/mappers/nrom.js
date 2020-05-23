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
    this.irqPixel = undefined;
    this.joy1StrobeState = 0;
    this.joy2StrobeState = 0;
    this.joypadLastWrite = 0;
    this.zapperFired = false;
    this.zapperX = null;
    this.zapperY = null;

    // Included verbatim in snapshots.
    this.prgRom = null;
    this.prgRam = null;
    this.chrRam = null;

    this.prgBanks = []; // array of actually-paged-in pages

    this.allChrPages = []; // array of minimum-sized subarrays
    this.allPrgPages = [];

    const nullFunc = () => 0;
    this.prgLoad = new Array(0x10000).fill(nullFunc);
    this.prgWrite = new Array(0x10000).fill(nullFunc);
    this.initializeCpuRam();
    this.initializePpuRegisters();
    this.initializeApuRegisters();
    this.initializePrgRomMapping();
    this.initializePrgRegisterMapping();

    // Array of the four currently selected 8k banks for PRG ROM.  Anything else
    // (swappable PRG RAM, smaller ROM banks, etc) requires special handler for
    // proper snapshooting.
    // this.cpuBanks = null;

    // NOTE: we don't worry about storing the PPU banks.  Since CHR-RAM is pretty
    // common in many mappers, we just support it by default, which means that
    // snapshots need to include the full contents of VRAM anyway.  If a mapper
    // has CHR RAM swapping, it will need special support anyway.
  }

  swapChr1k(bank, page, count = 1, table = this.nes.ppu.patternTableBanks) {
    for (let i = 0; i < count; i++) {
      table[bank + i] =
          this.allChrPages[(page + i) & mask(this.allChrPages.length)];
    }
  }

  swapPrg8k(bank, page, count = 1) {
    for (let i = 0; i < count; i++) {
      this.prgBanks[bank + i] =
          this.allPrgPages[(page + i) & mask(this.allPrgPages.length)];
    }
  }

  initializeCpuRam() {
    const ram = this.nes.cpu;
    const load = (x) => ram[x & 0x7ff];
    const write = (v, x) => ram[x & 0x7ff] = v;
    for (let i = 0; i < 0x2000; i++) {
      this.prgLoad[i] = load;
      this.prgWrite[i] = write;
    }
  }

  initializePpuRegisters() {
    const ppu = this.nes.ppu;
    // 2000 PPUCTRL (PPU Control Register 1)
    const load2000 = ppu.readPpuCtrl.bind(ppu);
    const write2000 = ppu.writePpuCtrl.bind(ppu);
    // 2001 PPUMASK (PPU Control Register 2)
    const load2001 = ppu.readPpuMask.bind(ppu);
    const write2001 = ppu.writePpuMask.bind(ppu);
    // 2002 PPUSTATUS (PPU Status Register)
    const load2002 = ppu.readStatusRegister.bind(ppu);
    // 2003 OAMADDR (Sprite RAM address)
    const write2003 = ppu.writeSRAMAddress.bind(ppu);
    // 2004 OAMDATA (Sprite memory read/write)
    const load2004 = ppu.sramLoad.bind(ppu);
    const write2004 = ppu.sramWrite.bind(ppu);
    // 2005 PPUSCROLL (Screen scroll offsets)
    const write2005 = ppu.scrollWrite.bind(ppu);
    // 2006 PPUADDR (VRAM address)
    const write2006 = ppu.writeVRAMAddress.bind(ppu);
    // 2007 PPUDATA (VRAM read/write)
    const load2007 = ppu.vramLoad.bind(ppu);
    const write2007 = ppu.vramWrite.bind(ppu);
    for (let i = 0x2000; i < 0x4000; i += 8) {
      this.prgLoad[i | 0] = load2000;
      this.prgWrite[i | 0] = write2000;
      this.prgLoad[i | 1] = load2001;
      this.prgWrite[i | 1] = write2001;
      this.prgLoad[i | 2] = load2002;
      this.prgWrite[i | 3] = write2003;
      this.prgLoad[i | 4] = load2004;
      this.prgWrite[i | 4] = write2004;
      this.prgWrite[i | 5] = write2005;
      this.prgWrite[i | 6] = write2006;
      this.prgLoad[i | 7] = load2007;
      this.prgWrite[i | 7] = write2007;
    }
    // 4014 OAMDMA (Sprite memory DMA access)
    this.prgWrite[0x4014] = ppu.sramDMA.bind(ppu);
  }

  initializeApuRegisters() {
    // 4016 Joystick write
    this.prgWrite[0x4016] = this.writeJoystickStrobe.bind(this);
    // 4016 Joystick 1 + Strobe -
    this.prgLoad[0x4016] = this.joy1Read.bind(this);
    // 4017 Joystick 2 + Strobe - with zapper
    this.prgLoad[0x4017] = this.joy2ReadWithZapper.bind(this);

    const papu = this.nes.papu;
    // APU registers
    for (let a = 0x4000; a < 0x4016; a++) {
      if (a === 0x4014) continue; 
      this.prgWrite[a] = papu.writeReg.bind(papu, a);
    }
    // 4015 APU Status
    this.prgLoad[0x4015] = papu.readStatus.bind(papu);
  }

  initializePrgRomMapping() {
    const load = (addr) => this.prgBanks[(addr & 0x7fff) >>> 13][addr & 0x1fff];
    for (let a = 0x8000; a < 0x10000; a++) {
      this.prgLoad[a] = load;
    }
  }

  initializePrgRegisterMapping() {
    const write = this.write8000.bind(this);
    for (let a = 0x8000; a < 0x10000; a++) {
      this.prgWrite[a] = write;
    }
  }

  fillPrgMirror(mapping, size = 0x8000, delta = 1, data = this.prgWrite) {
    for (let i = 0; i < mapping.length; i++) {
      mapping[i][1] = mapping[i][1].bind(this, ...mapping[i].slice(2));
    }
    for (let a = 0; a < size; a += delta) {
      for (const [r, f] of mapping) {
        data[r + a] = f;
      }
    }
  }

  initializePrgRegisterMapping() {
    this.fillPrgMirror([[0x8000, this.write8000]]);
  }

  write8000(val, addr) {}

  /**
   * Handles register loads.  Loads from CPU RAM or PRG ROM will not
   * work correctly and should instead be handled by CPU.prototype.load.
   */
  load(address) {
    return this.prgLoad[address](address);
  }

  /**
   * Handles register writes.  Writes to CPU RAM will not work correctly and
   * should instead be handled by CPU.prototype.load.
   */
  write(address, value) {
    this.prgWrite[address](value, address);
  }

  initializePrgRam() {
    // May be overwritten to handle paging, etc.
    this.prgRam = new Uint8Array(0x2000);
    const write = (val, addr) => this.prgRam[addr & 0x1fff] = val;
    const load = (addr) => this.prgRam[addr & 0x1fff];
    for (let a = 0x6000; a < 0x8000; a++) {
      this.prgWrite[a] = write;
      this.prgLoad[a] = load;
    }
  }

  initializePrgRomBanks() {
    const rom = this.nes.rom.rom;
    for (let i = 0; i < rom.length; i += 8192) {
      this.allPrgPages.push(rom.subarray(i, i + 8192));
    }
    for (let i = 0; i < 3; i++) {
      this.prgBanks[i] = this.allPrgPages[this.allPrgPages.length - 4 + i];
    }
  }

  initializeChrRomBanks() {
    const ppu = this.nes.ppu;
    const vrom = this.nes.rom.vrom;
    if (vrom.length) {
      ppu.importChrRom(vrom);
    } else {
      this.chrRam = new Uint16Array(0x2000);
      ppu.patternTableFull = this.chrRam;
    }
    for (let i = 0; i < ppu.patternTableFull.length; i += 1024) {
      this.allChrPages.push(ppu.patternTableFull.subarray(i, i + 1024));
    }
    this.swapChr1k(0, 0, 8);
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
    this.initializePrgRam();
    this.initializePrgRomBanks();
    this.initializeChrRomBanks();
    this.loadBatteryRam();
    this.initializeMapperState();

    // Reset IRQ:
    //nes.getCpu().doResetInterrupt();
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_RESET);
  }

  initializeMapperState() {}

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

  // // Loads a page of PRG ROM
  // loadPrgPage(address, bank, size) {
  //   this.prgRomSwitcher.swap(address & 0x7fff, bank, size);
  //   this.prgRom = this.prgRomSwitcher.buffer();
  // }

  // // Effectively makes repeated calls to loadPrgPage
  // loadPrgPages(...pages) {
  //   for (const [address, bank, size] of pages) {
  //     this.prgRomSwitcher.swap(address & 0x7fff, bank, size);
  //   }
  //   this.prgRom = this.prgRomSwitcher.buffer();
  // }

  // // Loads a page of CHR ROM
  // loadChrPage(address, bank, size) {
  //   if (this.nes.ppu.usingChrRam) return; // do nothing
  //   this.nes.ppu.triggerRendering();
  //   this.chrRomSwitcher.swap(address, bank, size);
  //   this.nes.ppu.patternTable = this.chrRomSwitcher.buffer();
  // }

  // // Effectively makes multiple calls to loadChrPage
  // loadChrPages(...pages) {
  //   if (this.nes.ppu.usingChrRam) return; // do nothing
  //   this.nes.ppu.triggerRendering();
  //   for (const [address, bank, size] of pages) {
  //     this.chrRomSwitcher.swap(address, bank, size);
  //   }
  //   this.nes.ppu.patternTable = this.chrRomSwitcher.buffer();
  // }

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
    return this.prgBanks[(addr & 0x7fff) >>> 13].byteOffset >>> 13;
  }

  // Return the address into the ROM for the given bank and memory address.  This
  // is used for reconstructing CPU logs from traces.
  prgRomAddress(bank, addr) {
    if (bank == null) bank = this.prgRomBank(addr);
    const a = (bank << 13) | (addr & 0x1fff);
//    if (a == 0x383c6) debugger;
    return a;
  }

  // Maps the PPU memory address to CHR ROM, or returns null if not in CHR ROM.
  mapChr(addr) {
    if (addr >= 0x2000) return null;
    const subarray = this.nes.ppu.patternTableBanks[addr >>> 10];
    return (subarray.byteOffset >> 1) | (addr & 0x3ff);
  }

  bankSources(reverse = false) {
    return new Map([
      ['prgrom', this.nes.rom.rom.buffer],
      ['prgram', this.prgRam.buffer]
      ['chr', this.ppu.patternTableFull.buffer],
    ].map(a => reverse ? [a[1], a[0]] : a));
  }

  writeExtSavestate() {}

  writeSavestate() {
    const buffers = this.bankSources(true);
    function serializeBanks(banks) {
      if (banks == null) return null;
      return banks.map(a => {
        const b = buffers.get(a.buffer);
        if (!b) throw new Error(`Missing buffer`);
        return {buffer: b, offset: a.byteOffset, length: a.length};
      });
    }
    return Savestate.Mmap.of({
      joy1StrobeState: this.joy1StrobeState,
      joy2StrobeState: this.joy2StrobeState,
      joypadLastWrite: this.joypadLastWrite,
      prgRam: this.prgRam,
      chrRam: this.chrRam,
      prgBanks: serializeBanks(this.prgBanks),
      chrBanks: serializeBanks(this.nes.ppu.patternTableBanks),
      chrBanksData: serializeBanks(this.nes.ppu.ppuDataBanks),
      chrBanksTall: serializeBanks(this.nes.ppu.tallSpritePatternTableBanks),
      ext: this.writeExtSavestate(),
    });
  }

  restoreExtSavestate(ext) {}

  restoreSavestate(mmap) {
    const buffers = this.bankSources();
    function deserializeBanks(banks) {
      if (banks == null) return null;
      return banks.map(({buffer, offset, length}) => {
        // TODO - could be better
        const ctor = buffer === 'chr' ? Uint16Array : Uint8Array;
        const b = buffers.get(buffer);
        if (!b) throw new Error(`Missing buffer`);
        return new ctor(b, offset, length);
      });
    }
    this.joy1StrobeState = mmap.joy1StrobeState;
    this.joy2StrobeState = mmap.joy2StrobeState;
    this.joypadLastWrite = mmap.joypadLastWrite;
    if (mmap.prgRam) this.prgRam.set(mmap.prgRam);
    if (mmap.chrRam) this.chrRam.set(mmap.chrRam);
    if (mmap.prgBanks) this.prgBanks = deserializeBanks(mmap.prgBanks);
    if (mmap.chrBanks) {
      this.nes.ppu.patternTableBanks = deserializeBanks(mmap.chrBanks);
    }
    if (mmap.chrBanksTall) {
      this.nes.ppu.tallSpritePatternTableBanks =
          deserializeBanks(mmap.chrBanksTall);
    }
    if (mmap.chrBanksData) {
      this.nes.ppu.ppuDataBanks = deserializeBanks(mmap.chrBanksData);
    }
    if (mmap.ext) {
      this.restoreExtSavestate(mmap.ext);
    }
  }

  clearCache() {
    this.restoreSavestate(this.writeSavestate());
  }
}

function mask(powerOfTwo) {
  // note: degrade gracefully if not a power of two.
  const z = Math.clz32(powerOfTwo - 1);
  return (1 << (32 - z)) - 1;
}
