import {NROM} from './nrom.js';

// Mapper 2
export class UxROM extends NROM {
  initializePrgRom() {
    this.loadPrgPage(0x8000, 0, 0x4000);
    this.loadPrgPage(0xc000, -1, 0x4000);
  }

  write8(address, value) {
    // This is a ROM bank select command.
    // Swap in the given ROM bank at 0x8000:
    this.loadPrgPage(0x8000, value, 0x4000);
  }
}
