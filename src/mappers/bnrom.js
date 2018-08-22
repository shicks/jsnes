import {NROM} from './nrom.js';

/**
 * Mapper 034 (BNROM, NINA-01)
 *
 * @description http://wiki.nesdev.com/w/index.php/INES_Mapper_034
 * @example Darkseed, Mashou, Mission Impossible 2
 * @constructor
 */
export class BNROM extends NROM {
  write8(address, value) {
    this.loadPrgPage(0x8000, value, 0x8000);
  }
}
