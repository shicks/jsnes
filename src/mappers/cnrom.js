import {NROM} from './nrom.js';

/**
 * Mapper 003 (CNROM)
 *
 * @constructor
 * @example Solomon's Key, Arkanoid, Arkista's Ring, Bump 'n' Jump, Cybernoid
 * @description http://wiki.nesdev.com/w/index.php/INES_Mapper_003
 */
export class CNROM extends NROM {
  write8000(value, address) {
    // This is a VROM bank select command.
    // Swap in the given VROM bank at 0x0000:
    this.swapChr1k(0, value << 3, 8);
  }
}
