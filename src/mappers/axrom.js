import {NROM} from './nrom.js';

/**
 * Mapper007 (AxROM)
 * @example Battletoads, Time Lord, Marble Madness
 * @description http://wiki.nesdev.com/w/index.php/INES_Mapper_007
 * @constructor
 */
export class AxROM extends NROM {
  loadBatteryRam() {}

  write8(address, value) {
    this.loadPrgPage(0x8000, value & 7, 0x8000);
    this.nes.ppu.setMirroring(
        value & 0x10 ?
            this.nes.rom.SINGLESCREEN_MIRRORING2 :
            this.nes.rom.SINGLESCREEN_MIRRORING);
  }
}
