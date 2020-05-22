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
  write8000(value, address) {
    // Swap in the given PRG-ROM bank at 0x8000:
    this.swapPrg8k(0, (value >> 2) & 0xc, 4);

    // Swap in the given VROM bank at 0x0000:
    this.swapChr1k(0, (value & 3) << 3, 8);
  }
}
