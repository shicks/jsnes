import {NROM} from './nrom.js';

/**
 * Mapper 011 (Color Dreams)
 *
 * @description http://wiki.nesdev.com/w/index.php/Color_Dreams
 * @example Crystal Mines, Metal Fighter
 * @constructor
 */
export class ColorDreams extends NROM {
  write8(address, value) {
    // Swap in the given PRG-ROM bank:
    this.loadPrgPage(0x8000, value & 0xf, 0x8000);

    // Swap in the given VROM bank at 0x0000:
    this.loadChrPage(0x0000, value >>> 4, 0x2000);
  }
}
