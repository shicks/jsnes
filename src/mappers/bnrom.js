import {NROM} from './nrom.js';

/**
 * Mapper 034 (BNROM, NINA-01)
 *
 * @description http://wiki.nesdev.com/w/index.php/INES_Mapper_034
 * @example Darkseed, Mashou, Mission Impossible 2
 * @constructor
 */
export class BNROM extends NROM {
  write8000(value, address) {
    this.swapPrg8k(0, value << 2, 4);
  }
}
