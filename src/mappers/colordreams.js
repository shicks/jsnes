import {NROM} from './nrom.js';

/**
 * Mapper 011 (Color Dreams)
 *
 * @description http://wiki.nesdev.com/w/index.php/Color_Dreams
 * @example Crystal Mines, Metal Fighter
 * @constructor
 */
export class ColorDreams extends NROM {
  write8000(value, address) {
    // Swap in the given PRG-ROM bank:
    this.swapPrg8k(0, (value & 0xf) << 2, 4);

    // Swap in the given VROM bank at 0x0000:
    this.swapChr1k(0, (value >>> 4) << 3, 8);
  }
}
