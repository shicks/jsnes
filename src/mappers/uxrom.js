import {NROM} from './nrom.js';

// Mapper 2
export class UxROM extends NROM {
  initializeMapperState() {
    this.swapPrg8k(0, 0, 2);
    this.swapPrg8k(2, 0xfe, 2);
  }

  write8000(value) {
    // This is a ROM bank select command.
    // Swap in the given ROM bank at 0x8000:
    this.swapPrg8k(0, value << 1, 2);
  }
}
