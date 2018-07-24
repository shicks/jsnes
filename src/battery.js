import * as utils from './utils.js';

// Uses localstorage for NES battery backup

export class Battery {
  constructor(nes) {
    this.nes = nes;
    this.timeout = null;
  }

  load() {
    // if we're using a hash, consider adding a "patch overlay" file so that
    // we compute hash based on original rom but we can simply edit a text file
    // and load it on the fly for alterations
    const data = localStorage.getItem(this.nes.rom.hash);
    if (data) {
      const arr = Array.from(data, x => x.charCodeAt(0));
      utils.copyArrayElements(arr, 0, this.nes.cpu.mem, 0x6000, 0x2000);
    }
  }

  store() {
    // use a timeout... but keep track of it!
    if (this.timeout) return;
    this.timeout = setTimeout(() => {
      this.timeout = null;
      const arr = new Array(0x2000);
      utils.copyArrayElements(this.nes.cpu.mem, 0x6000, arr, 0, 0x2000);
      const str = String.fromCharCode(...arr);
      localStorage.setItem(this.nes.rom.hash, str);
    }, 1000); // wait roughly three frames
  }

  reset() {
    localStorage.removeItem(this.nes.rom.hash);
    for (let i = 0x6000; i < 0x8000; i++) {
      this.nes.cpu.mem[i] = 0;
    }
  }

  // NOTE: clears all batteries *and* save states!
  static clear() {
    localStorage.clear();
  }
}
