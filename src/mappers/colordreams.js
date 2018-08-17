import {NROM} from './nrom.js';

/**
 * Mapper 011 (Color Dreams)
 *
 * @description http://wiki.nesdev.com/w/index.php/Color_Dreams
 * @example Crystal Mines, Metal Fighter
 * @constructor
 */
export class ColorDreams extends NROM {
  initializeRegisters() {
    super.initializeRegisters();
    this.addRegisterBank('w', 0x8000, 0x10000, 1);
    this.onWrite(0x8000, (value) => {
      // Swap in the given PRG-ROM bank:
      var prgbank1 = ((value & 0xf) * 2) % this.nes.rom.romCount();
      var prgbank2 = ((value & 0xf) * 2 + 1) % this.nes.rom.romCount();

      this.loadPrgPage(0x8000, prgbank1, 0x4000);
      this.loadPrgPage(0xc000, prgbank2, 0x4000);

      if (this.nes.rom.vromCount() > 0) {
        // Swap in the given VROM bank at 0x0000:
        var bank = ((value >> 4) * 2) % this.nes.rom.vromCount();
        this.loadVromBank(bank, 0x0000);
        this.loadVromBank(bank + 1, 0x1000);
      }
    });
  }
}
