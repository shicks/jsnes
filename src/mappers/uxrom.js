import {NROM} from './nrom.js';

// Mapper 2
export class UxROM extends NROM {
  initializePrgRom() {
    this.addRomBank(0x8000, 0xc000, this.nes.rom.prgPage(0, 0x4000));
    this.addRomBank(0xc000, 0x10000, this.nes.rom.prgPage(-1, 0x4000));
  }

  initializeRegisters() {
    super.initializeRegisters();
    this.addRegisterBank('w', 0x8000, 0x10000, 1);
    this.onWrite(0x8000, (value) => {
      // This is a ROM bank select command.
      // Swap in the given ROM bank at 0x8000:
      this.loadRomBank(0x8000, value, 0x4000);
    });
  }
}
