import {NROM} from './nrom.js';

/**
 * Mapper007 (AxROM)
 * @example Battletoads, Time Lord, Marble Madness
 * @description http://wiki.nesdev.com/w/index.php/INES_Mapper_007
 * @constructor
 */
export class AxROM extends NROM {
  loadBatteryRam() {}

  write8000(value, address) {
    this.swapPrg8k(0, (value & 7) << 2, 4);
    this.nes.ppu.setMirroring(
        value & 0x10 ?
            this.nes.rom.SINGLESCREEN_MIRRORING2 :
            this.nes.rom.SINGLESCREEN_MIRRORING);
  }
}
