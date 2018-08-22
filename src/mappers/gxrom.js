import {NROM} from './nrom.js';

/**
 * Mapper 066 (GxROM)
 *
 * @description http://wiki.nesdev.com/w/index.php/INES_Mapper_066
 * @example Doraemon, Dragon Power, Gumshoe, Thunder & Lightning,
 * Super Mario Bros. + Duck Hunt
 * @constructor
 */
export class GxROM extends NROM {
  write8(address, value) {
    // Swap in the given PRG-ROM bank at 0x8000:
    this.loadPrgPage(0x8000, (value >> 4) & 3, 0x8000);

    // Swap in the given VROM bank at 0x0000:
    this.loadChrPage(0x0000, value & 3, 0x2000);
  }
}
