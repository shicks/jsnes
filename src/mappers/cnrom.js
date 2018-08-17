import {NROM} from './nrom.js';

/**
 * Mapper 003 (CNROM)
 *
 * @constructor
 * @example Solomon's Key, Arkanoid, Arkista's Ring, Bump 'n' Jump, Cybernoid
 * @description http://wiki.nesdev.com/w/index.php/INES_Mapper_003
 */
export class CNROM extends NROM {
  initializeRegisters() {
    super.initializeRegisters();
    this.addRegisterBank('w', 0x8000, 0x10000, 1);
    this.onWrite(0x8000, (value) => {
      // This is a VROM bank select command.
      // Swap in the given VROM bank at 0x0000:
      var bank = (value % (this.nes.rom.vromCount() / 2)) * 2;
      this.loadVromBank(bank, 0x0000);
      this.loadVromBank(bank + 1, 0x1000);
      this.load8kVromBank(value * 2, 0x0000);
    });
  }
}
