import {NROM} from './nrom.js';

/**
 * Mapper007 (AxROM)
 * @example Battletoads, Time Lord, Marble Madness
 * @description http://wiki.nesdev.com/w/index.php/INES_Mapper_007
 * @constructor
 */
export class AxROM extends NROM {
  loadBatteryRam() {}

  initializeRam() {
    this.ram = new Uint8Array(0x800);
    this.addRamBank(0, 0x2000, this.ram);
    // No PRG RAM
  }

  initializeRegisters() {
    super.initializeRegisters();
    this.addRegisterBank('w', 0x8000, 0x10000, 1);
    this.onWrite(0x8000, (value) => {
      this.loadPrgPage(0x8000, value & 7, 0x8000);
      this.nes.ppu.setMirroring(
          value & 0x10 ?
              this.nes.rom.SINGLESCREEN_MIRRORING2 :
              this.nes.rom.SINGLESCREEN_MIRRORING);
    });
  }
}
