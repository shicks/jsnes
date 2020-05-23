import {Mappers} from './mappers.js';
//import {Tile} from './tile.js';

export function ROM(nes) {
  this.nes = nes;

  // TODO(sdh): consider computing a hash/checksum for indexing save
  // states in localstorage.  Note that this will blow up when we reload
  // tons of different versions of hacked roms, so for now we can just
  // key off of something simpler? like nothing?  definitely need a way
  // to uncorrupt in case of mismatch - button to clear localstorage and reset?

  this.hash = 0;

  this.mapperName = new Array(92);

  for (var i = 0; i < 92; i++) {
    this.mapperName[i] = "Unknown Mapper";
  }
  this.mapperName[0] = "Direct Access";
  this.mapperName[1] = "Nintendo MMC1";
  this.mapperName[2] = "UNROM";
  this.mapperName[3] = "CNROM";
  this.mapperName[4] = "Nintendo MMC3";
  this.mapperName[5] = "Nintendo MMC5";
  this.mapperName[6] = "FFE F4xxx";
  this.mapperName[7] = "AOROM";
  this.mapperName[8] = "FFE F3xxx";
  this.mapperName[9] = "Nintendo MMC2";
  this.mapperName[10] = "Nintendo MMC4";
  this.mapperName[11] = "Color Dreams Chip";
  this.mapperName[12] = "FFE F6xxx";
  this.mapperName[15] = "100-in-1 switch";
  this.mapperName[16] = "Bandai chip";
  this.mapperName[17] = "FFE F8xxx";
  this.mapperName[18] = "Jaleco SS8806 chip";
  this.mapperName[19] = "Namcot 106 chip";
  this.mapperName[20] = "Famicom Disk System";
  this.mapperName[21] = "Konami VRC4a";
  this.mapperName[22] = "Konami VRC2a";
  this.mapperName[23] = "Konami VRC2a";
  this.mapperName[24] = "Konami VRC6";
  this.mapperName[25] = "Konami VRC4b";
  this.mapperName[32] = "Irem G-101 chip";
  this.mapperName[33] = "Taito TC0190/TC0350";
  this.mapperName[34] = "32kB ROM switch";

  this.mapperName[64] = "Tengen RAMBO-1 chip";
  this.mapperName[65] = "Irem H-3001 chip";
  this.mapperName[66] = "GNROM switch";
  this.mapperName[67] = "SunSoft3 chip";
  this.mapperName[68] = "SunSoft4 chip";
  this.mapperName[69] = "SunSoft5 FME-7 chip";
  this.mapperName[71] = "Camerica chip";
  this.mapperName[78] = "Irem 74HC161/32-based";
  this.mapperName[91] = "Pirate HK-SF3 chip";
}

ROM.prototype = {
  // Mirroring types:
  VERTICAL_MIRRORING: 0x44,      // [0, 1, 0, 1]
  HORIZONTAL_MIRRORING: 0x50,    // [0, 0, 1, 1]
  FOURSCREEN_MIRRORING: 0xe4,    // [0, 1, 2, 3]
  SINGLESCREEN_MIRRORING: 0x00,  // [0, 0, 0, 0]
  SINGLESCREEN_MIRRORING2: 0x55, // [1, 1, 1, 1]
  SINGLESCREEN_MIRRORING3: 0xaa, // [2, 2, 2, 2]
  SINGLESCREEN_MIRRORING4: 0xff, // [3, 3, 3, 3]
  //CHRROM_MIRRORING: 7,

  header: null,
  rom: null,
  vrom: null,
  vromTile: null,

  mirroring: null,
  batteryRam: null,
  trainer: null,
  fourScreen: null,
  mapperType: null,
  valid: false,

  load: function(data) {
    if (data[0] != 0x4e || data[1] != 0x45 ||
        data[2] != 0x53 || data[3] != 0x1a) {
      // Needs to start with 'NES\x1a'.
      throw new Error("Not a valid NES ROM.");
    }
    this.header = new Array(16);
    for (let i = 0; i < 16; i++) {
      this.header[i] = data[i];
    }
    const romCount = this.header[4];
    const vromCount = this.header[5] * 2; // Get the number of 4kB banks, not 8kB
    this.mirroring = (this.header[6] & 1) !== 0 ? 1 : 0;
    this.batteryRam = (this.header[6] & 2) !== 0;
    this.trainer = (this.header[6] & 4) !== 0;
    this.fourScreen = (this.header[6] & 8) !== 0;
    this.mapperType = (this.header[6] >> 4) | (this.header[7] & 0xf0);

    // Check whether byte 8-15 are zero's:
    var foundError = false;
    for (let i = 8; i < 16; i++) {
      if (this.header[i] !== 0) {
        foundError = true;
        break;
      }
    }

    if (foundError) {
      this.mapperType &= 0xf; // Ignore byte 7
    }
    // Load PRG-ROM banks:
    const romBytes = romCount << 14;
    const romStart = 16; // after header
    this.rom = new Uint8Array(romBytes);
    for (let i = 0; i < romBytes; i++) {
      if (romStart + i >= data.length) {
        break;
      }
      const x = this.rom[i] = data[romStart + i];
      this.hash = ((this.hash * 31 >>> 0) + x) >>> 0;
    }
    // Load CHR-ROM banks:
    const vromStart = romStart + romBytes;
    const vromBytes = vromCount << 12;
    this.vrom = new Uint8Array(vromBytes);
    for (let i = 0; i < vromBytes; i++) {
      if (vromStart + i >= data.length) {
        break;
      }
      const x = this.vrom[i] = data[vromStart + i];
      this.hash = ((this.hash * 31 >>> 0) + x) >>> 0;
    }

    // // Create VROM tiles:
    // this.vromTile = new Array(vromCount);
    // for (let i = 0; i < vromCount; i++) {
    //   this.vromTile[i] = new Array(256);
    //   for (let j = 0; j < 256; j++) {
    //     this.vromTile[i][j] = new Tile();
    //   }
    // }

    // // Convert CHR-ROM banks to tiles:
    // var tileIndex;
    // var leftOver;
    // for (let v = 0; v < vromCount; v++) {
    //   for (let i = 0; i < 4096; i++) {
    //     tileIndex = i >> 4;
    //     leftOver = i % 16;
    //     if (leftOver < 8) {
    //       this.vromTile[v][tileIndex].setScanline(
    //         leftOver,
    //         this.vrom[(v << 12) | i],
    //         this.vrom[(v << 12) | (i + 8)]
    //       );
    //     } else {
    //       this.vromTile[v][tileIndex].setScanline(
    //         leftOver - 8,
    //         this.vrom[(v << 12) | (i - 8)],
    //         this.vrom[(v << 12) | i]
    //       );
    //     }
    //   }
    // }

    this.valid = true;
    this.hash = this.hash.toString(36);
  },

  chrPage: function(page, size) {
    if (page < 0) page += Math.floor(this.vrom.length / size);
    const offset = page * size % (this.vrom.length & ~(size - 1));
    return this.vrom.subarray(offset, offset + size);
  },

  prgPage: function(page, size) {
    if (page < 0) page += Math.floor(this.rom.length / size);
    const offset = page * size % (this.rom.length & ~(size - 1));
    return this.rom.subarray(offset, offset + size);
  },

  vromCount: function(size = 0x1000) {
    return Math.floor(this.vrom.length / size);
  },

  romCount: function(size = 0x4000) {
    return Math.floor(this.rom.length / size);
  },

  getMirroringType: function() {
    if (this.fourScreen) {
      return this.FOURSCREEN_MIRRORING;
    }
    if (this.mirroring === 0) {
      return this.HORIZONTAL_MIRRORING;
    }
    return this.VERTICAL_MIRRORING;
  },

  getMapperName: function() {
    if (this.mapperType >= 0 && this.mapperType < this.mapperName.length) {
      return this.mapperName[this.mapperType];
    }
    return "Unknown Mapper, " + this.mapperType;
  },

  mapperSupported: function() {
    return typeof Mappers[this.mapperType] !== "undefined";
  },

  createMapper: function() {
    if (this.mapperSupported()) {
      return new Mappers[this.mapperType](this.nes);
    }
    throw new Error(
      "This ROM uses a mapper not supported by JSNES: " +
        this.getMapperName() +
        "(" +
        this.mapperType +
        ")"
    );
  }
};
