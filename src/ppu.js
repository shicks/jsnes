//import {Tile} from './tile.js';
import * as utils from './utils.js';

// Status flags:
const STATUS_VRAMWRITE = 0x10;
const STATUS_SLSPRITECOUNT = 0x20;
const STATUS_SPRITE0HIT = 0x40;
const STATUS_VBLANK = 0x80;

export function PPU(nes) {
  this.nes = nes;

  // Keep Chrome happy
  this.vram = null;
  // this.etteRam = null;
  // this.spriteMem = null;
  this.vramAddress = null;
  this.vramTmpAddress = null;
  this.vramBufferedReadValue = null;
  this.firstWrite = null;
  this.sramAddress = null;
  this.currentMirroring = null;
  this.requestEndFrame = null;
  this.nmiOk = null;
  this.dummyCycleToggle = null;
  this.nmiCounter = null;
  this.scanlineAlreadyRendered = null;
  this.f_nmiOnVblank = null;
  this.f_tallSprites = null;
  this.f_bgPatternTable = null;
  this.f_spPatternTable = null;
  this.f_addrInc = null;
  this.f_nTblAddress = null;
  this.f_color = null;
  this.f_spVisibility = null;
  this.f_bgVisibility = null;
  this.f_spClipping = null;
  this.f_bgClipping = null;
  this.status = null;
  this.cntFV = null;
  this.cntV = null;
  this.cntH = null;
  this.cntVT = null;
  this.cntHT = null;
  this.reg1 = null;
  this.reg2 = null;
  this.regFV = null;
  this.regV = null;
  this.regH = null;
  this.regVT = null;
  this.regHT = null;
  this.regFH = null;
  this.attrib = null;
  this.buffer = null;
  this.bgbuffer = null;
  this.pixrendered = null;

  this.scanline = null;
  this.lastRenderedScanline = null;
  this.curX = null;
  this.sprX = null;
  this.sprY = null;
  this.sprTile = null;
  this.sprCol = null;
  this.vertFlip = null;
  this.horiFlip = null;
  this.bgPriority = null;
  this.spr0HitX = null;
  this.spr0HitY = null;
  this.hitSpr0 = null;
  this.sprPalette = null;
  this.ptTile = null;
  this.currentMirroring = null;

  // Rendering Options:
  this.showSpr0Hit = false;
  this.clipToTvSize = true;
  this.frame = 0;

  this.reset();
};

PPU.prototype = {
  reset: function() {
    var i;

    // PPU Memory:
    // This is compressed down to the minimum amount of writable
    // memory by eliminating the regions that are normally mirrored.
    //   $0000 .. $0fff is the four nametables (normally $2000 .. $2fff)
    //   $1000 .. $10ff is OAM (sprite) memory (normally separate)
    //   $1100 .. $111f is palette memory (normally $3f00 .. $3f1f)
    this.vram = new Uint8Array(0x1120);
    //   new Uint8Array(0x400),
    //   new Uint8Array(0x400),
    //   new Uint8Array(0x400),
    //   new Uint8Array(0x400),
    // ];
    // this.paletteRam = new Uint8Array(0x20);
    // this.spriteMem = new Uint8Array(0x100);

    // VRAM I/O:
    this.vramAddress = null;
    this.vramTmpAddress = null;
    this.vramBufferedReadValue = 0;
    this.firstWrite = true; // VRAM/Scroll Hi/Lo latch

    // SPR-RAM I/O:
    this.sramAddress = 0; // 8-bit only.

    this.currentMirroring = -1;
    this.requestEndFrame = false;
    this.nmiOk = false;
    this.dummyCycleToggle = false;
    this.nmiCounter = 0;
    this.scanlineAlreadyRendered = null;

    // Control Flags Register 1:
    this.f_nmiOnVblank = 0; // NMI on VBlank. 0=disable, 1=enable
    this.f_tallSprites = 0; // Sprite size. 0=8x8, 1=8x16
    this.f_bgPatternTable = 0; // Background Pattern Table address. 0x0000 or 0x1000
    this.f_spPatternTable = 0; // Sprite Pattern Table address. 0x0000 or 0x1000
    this.f_addrInc = 0; // PPU Address Increment. 0=1,1=32
    this.f_nTblAddress = 0; // Name Table Address. 0=0x2000,1=0x2400,2=0x2800,3=0x2C00

    // Control Flags Register 2:
    this.f_color = 0; // Color mode (emph bits 1=red, 2=green, 4=blue; 8=greyscale)
    this.f_spVisibility = 0; // Sprite visibility. 0=not displayed,1=displayed
    this.f_bgVisibility = 0; // Background visibility. 0=Not Displayed,1=displayed
    this.f_spClipping = 0; // Sprite clipping. 0=Sprites invisible in left 8-pixel column,1=No clipping
    this.f_bgClipping = 0; // Background clipping. 0=BG invisible in left 8-pixel column, 1=No clipping
    this.status = 0; // Status flag.

    // Counters:
    this.cntFV = 0;
    this.cntV = 0;
    this.cntH = 0;
    this.cntVT = 0;
    this.cntHT = 0;

    // Registers:
    this.regFV = 0;
    this.regV = 0;
    this.regH = 0;
    this.regVT = 0;
    this.regHT = 0;
    this.regFH = 0;

    // These are temporary variables used in rendering and sound procedures.
    // Their states outside of those procedures can be ignored.
    // TODO: the use of this is a bit weird, investigate

    // Variables used when rendering:
    this.buffer = new Uint32Array(256 * 240);
    this.bgbuffer = new Uint32Array(256 * 240);
    this.pixrendered = new Uint16Array(256 * 240);

    // Initialize misc vars:
    this.scanline = 0;
    this.frame = 0;
    this.lastRenderedScanline = -1;
    this.curX = 0;

    // Sprite data:
    this.spr0HitX = 0; // Sprite #0 hit X coordinate
    this.spr0HitY = 0; // Sprite #0 hit Y coordinate
    this.hitSpr0 = false;

    // Create nametable buffers:
    // Name table data:
    this.currentMirroring = -1;

    this.updateControlReg1(0);
    this.updateControlReg2(0);
  },

  // Sets Nametable mirroring.
  setMirroring: function(mirroring) {
    if (mirroring === this.currentMirroring) {
      return;
    }

    this.currentMirroring = mirroring;
    this.triggerRendering();

    // // Remove mirroring:
    // if (this.vramMirrorTable === null) {
    //   this.vramMirrorTable = new Array(0x8000);
    // }
    // for (var i = 0; i < 0x8000; i++) {
    //   this.vramMirrorTable[i] = i;
    // }

    // // Palette mirroring:
    // this.defineMirrorRegion(0x3f20, 0x3f00, 0x20);
    // this.defineMirrorRegion(0x3f40, 0x3f00, 0x20);
    // this.defineMirrorRegion(0x3f80, 0x3f00, 0x20);
    // this.defineMirrorRegion(0x3fc0, 0x3f00, 0x20);

    // // Additional mirroring:
    // this.defineMirrorRegion(0x3000, 0x2000, 0xf00);
    // this.defineMirrorRegion(0x4000, 0x0000, 0x4000);

    if (mirroring === this.nes.rom.HORIZONTAL_MIRRORING) {
      // Horizontal mirroring.
      this.nes.mmap.setNametableMapping(this.vram, 0, 0, 1, 1);
    } else if (mirroring === this.nes.rom.VERTICAL_MIRRORING) {
      // Vertical mirroring.
      this.nes.mmap.setNametableMapping(this.vram, 0, 1, 0, 1);
    } else if (mirroring === this.nes.rom.SINGLESCREEN_MIRRORING) {
      // Single Screen mirroring
      this.nes.mmap.setNametableMapping(this.vram, 0, 0, 0, 0);
    } else if (mirroring === this.nes.rom.SINGLESCREEN_MIRRORING2) {
      // Single Screen mirroring with second nametable
      this.nes.mmap.setNametableMapping(this.vram, 1, 1, 1, 1);
    } else {
      // Assume Four-screen mirroring.
      this.nes.mmap.setNametableMapping(this.vram, 0, 1, 2, 3);
    }
  },

  // // Define a mirrored area in the address lookup table.
  // // Assumes the regions don't overlap.
  // // The 'to' region is the region that is physically in memory.
  // defineMirrorRegion: function(fromStart, toStart, size) {
  //   for (var i = 0; i < size; i++) {
  //     this.vramMirrorTable[fromStart + i] = toStart + i;
  //   }
  // },

  startVBlank: function() {
    // Do NMI:
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NMI);

    // Make sure everything is rendered:
    if (this.lastRenderedScanline < 239) {
      this.renderFramePartially(
        this.lastRenderedScanline + 1,
        240 - this.lastRenderedScanline
      );
    }

    // End frame:
    this.endFrame();

    // Reset scanline counter:
    this.lastRenderedScanline = -1;
  },

  endScanline: function() {
    switch (this.scanline) {
      case 19:
        // Dummy scanline.
        // May be variable length:
        if (this.dummyCycleToggle) {
          // Remove dead cycle at end of scanline,
          // for next scanline:
          this.curX = 1;
          this.dummyCycleToggle = !this.dummyCycleToggle;
        }
        break;

      case 20:
        // Clear VBlank flag:
        this.status &= ~STATUS_VBLANK;

        // Clear Sprite #0 hit flag:
        this.status &= ~STATUS_SPRITE0HIT;
        this.hitSpr0 = false;
        this.spr0HitX = -1;
        this.spr0HitY = -1;

        if (this.f_bgVisibility || this.f_spVisibility) {
          // Update counters:
          this.cntFV = this.regFV;
          this.cntV = this.regV;
          this.cntH = this.regH;
          this.cntVT = this.regVT;
          this.cntHT = this.regHT;

          if (this.f_bgVisibility) {
            // Render dummy scanline:
            this.renderBgScanline(false, 0);
          }
        }

        if (this.f_bgVisibility && this.f_spVisibility) {
          // Check sprite 0 hit for first scanline:
          this.checkSprite0(0);
        }

        if (this.f_bgVisibility || this.f_spVisibility) {
          // Clock mapper IRQ Counter:
          this.nes.mmap.clockIrqCounter();
        }
        break;

      case 261:
        // Dead scanline, no rendering.
        // Set VINT:
        this.status |= STATUS_VBLANK;
        this.requestEndFrame = true;
        this.nmiCounter = 9;

        // Wrap around:
        this.scanline = -1; // will be incremented to 0

        break;

      default:
        if (this.scanline >= 21 && this.scanline <= 260) {
          // Render normally:
          if (this.f_bgVisibility) {
            if (!this.scanlineAlreadyRendered) {
              // update scroll:
              this.cntHT = this.regHT;
              this.cntH = this.regH;
              this.renderBgScanline(true, this.scanline + 1 - 21);
            }
            this.scanlineAlreadyRendered = false;

            // Check for sprite 0 (next scanline):
            if (!this.hitSpr0 && this.f_spVisibility) {
              const y0 = this.vram[0x1000];
              const x0 = this.vram[0x1003];
              if (x0 >= -7 &&
                  x0 < 256 &&
                  y0 + 1 <= this.scanline - 20 &&
                  y0 + 1 + (this.f_tallSprites ? 16 : 8) >= this.scanline - 20 &&
                  this.checkSprite0(this.scanline - 20)) {
                this.hitSpr0 = true;
              }
            }
          }

          if (this.f_bgVisibility || this.f_spVisibility) {
            // Clock mapper IRQ Counter:
            this.nes.mmap.clockIrqCounter();
          }
        }
    }

    this.scanline++;
    this.regsToAddress();
    this.cntsToAddress();
  },

  startFrame: function() {
    // Set background color:
    var bgColor = 0;

    // Use first entry of image palette as BG color.
    bgColor = PALETTE[this.f_color | this.nes.mmap.loadPpu(IMG_PALETTE)];
    // TODO - for greyscale, jsnes had a switch on the
    // emphasis mode for the background (0=black, 1=green,
    // 2=blue, 4=red), but I can't find any documentation
    // about this, so I'm going to stick with pal[0].

    this.buffer.fill(bgColor);
    this.pixrendered.fill(65);
  },

  endFrame: function() {
    var i, x, y;
    var buffer = this.buffer;
    this.frame++;

    // Draw spr#0 hit coordinates:
    if (this.showSpr0Hit) {
      const y0 = this.vram[0x1000];
      const x0 = this.vram[0x1003];
      // Spr 0 position:
      if (x0 >= 0 && x0 < 256 && y0 >= 0 && y0 < 240) {
        for (i = 0; i < 256; i++) {
          buffer[(y0 << 8) + i] = 0xff5555;
        }
        for (i = 0; i < 240; i++) {
          buffer[(i << 8) | x0] = 0xff5555;
        }
      }
      // Hit position:
      if (
        this.spr0HitX >= 0 &&
        this.spr0HitX < 256 &&
        this.spr0HitY >= 0 &&
        this.spr0HitY < 240
      ) {
        for (i = 0; i < 256; i++) {
          buffer[(this.spr0HitY << 8) + i] = 0x55ff55;
        }
        for (i = 0; i < 240; i++) {
          buffer[(i << 8) + this.spr0HitX] = 0x55ff55;
        }
      }
    }

    // This is a bit lazy..
    // if either the sprites or the background should be clipped,
    // both are clipped after rendering is finished.
    if (
      this.clipToTvSize ||
      this.f_bgClipping === 0 ||
      this.f_spClipping === 0
    ) {
      // Clip left 8-pixels column:
      for (y = 0; y < 240; y++) {
        for (x = 0; x < 8; x++) {
          buffer[(y << 8) + x] = 0;
        }
      }
    }

    if (this.clipToTvSize) {
      // Clip right 8-pixels column too:
      for (y = 0; y < 240; y++) {
        for (x = 0; x < 8; x++) {
          buffer[(y << 8) + 255 - x] = 0;
        }
      }
    }

    // Clip top and bottom 8 pixels:
    if (this.clipToTvSize) {
      for (y = 0; y < 8; y++) {
        for (x = 0; x < 256; x++) {
          buffer[(y << 8) + x] = 0;
          buffer[((239 - y) << 8) + x] = 0;
        }
      }
    }

    this.nes.ui.writeFrame(buffer);
  },

  updateControlReg1: function(value) {
    this.triggerRendering();

    // NOTE: nmiOnVblank does not appear to ever be used!
    this.f_nmiOnVblank = (value & 0x80) >> 7;     // 0 or 1
    this.f_tallSprites = value & 0x20;            // boolean
    this.f_bgPatternTable = (value & 0x10) << 8;  // 0 or 0x1000
    this.f_spPatternTable = (value & 0x08) << 9;  // 0 or 0x1000
    this.f_addrInc = (value & 0x04) >> 2;         // 0 or 1
    this.f_nTblAddress = value & 3;               // 0, 1, 2, or 3

    this.regV = (value >> 1) & 1;
    this.regH = value & 1;
    this.reg1 = value;
  },

  updateControlReg2: function(value) {
    this.triggerRendering();

    // mbgr000000  (m = monochrome)
    this.f_color = ((value | (value << 8)) & 0x1e0) << 1;
    this.f_spVisibility = (value >> 4) & 1;
    this.f_bgVisibility = (value >> 3) & 1;
    this.f_spClipping = (value >> 2) & 1;
    this.f_bgClipping = (value >> 1) & 1;
    //this.updatePalettes();
    this.reg2 = value;
  },

  // CPU Register $2002:
  // Read the Status Register.
  readStatusRegister: function() {
    // Reset scroll & VRAM Address toggle:
    this.firstWrite = true;

    // Save result before clearing vblank:
    const status = this.status;

    // Clear VBlank flag:
    this.status &= ~STATUS_VBLANK;

    // Fetch status data:
    return status;
  },

  // CPU Register $2003:
  // Write the SPR-RAM address that is used for sramWrite (Register 0x2004 in CPU memory map)
  writeSRAMAddress: function(address) {
    this.sramAddress = address;
  },

  // CPU Register $2004 (R):
  // Read from SPR-RAM (Sprite RAM).
  // The address should be set first.
  sramLoad: function() {
    /*short tmp = sprMem.load(sramAddress);
        sramAddress++; // Increment address
        sramAddress%=0x100;
        return tmp;*/
    return this.vram[0x1000 | (this.sramAddress & 0xff)];
  },

  // CPU Register $2004 (W):
  // Write to SPR-RAM (Sprite RAM).
  // The address should be set first.
  sramWrite: function(value) {
    // this.vram[0x1000 | (this.sramAddress & 0xff)] = value;
    this.spriteRamWriteUpdate(this.sramAddress, value);
    this.sramAddress++; // Increment address
    this.sramAddress %= 0x100;
  },

  // CPU Register $2005:
  // Write to scroll registers.
  // The first write is the vertical offset, the second is the
  // horizontal offset:
  scrollWrite: function(value) {
    this.triggerRendering();

    if (this.firstWrite) {
      // First write, horizontal scroll:
      this.regHT = (value >> 3) & 31;
      this.regFH = value & 7;
    } else {
      // Second write, vertical scroll:
      this.regFV = value & 7;
      this.regVT = (value >> 3) & 31;
    }
    this.firstWrite = !this.firstWrite;
  },

  // CPU Register $2006:
  // Sets the adress used when reading/writing from/to VRAM.
  // The first write sets the high byte, the second the low byte.
  writeVRAMAddress: function(address) {
    if (this.firstWrite) {
      this.regFV = (address >> 4) & 3;
      this.regV = (address >> 3) & 1;
      this.regH = (address >> 2) & 1;
      this.regVT = (this.regVT & 7) | ((address & 3) << 3);
    } else {
      this.triggerRendering();

      this.regVT = (this.regVT & 24) | ((address >> 5) & 7);
      this.regHT = address & 31;

      this.cntFV = this.regFV;
      this.cntV = this.regV;
      this.cntH = this.regH;
      this.cntVT = this.regVT;
      this.cntHT = this.regHT;

      this.checkSprite0(this.scanline - 20);
    }

    this.firstWrite = !this.firstWrite;

    // Invoke mapper latch:
    this.cntsToAddress();
    if (this.vramAddress < 0x2000) {
      this.nes.mmap.latchAccess(this.vramAddress);
    }
  },

  // CPU Register $2007(R):
  // Read from PPU memory. The address should be set first.
  vramLoad: function() {
    this.cntsToAddress();
    this.regsToAddress();

    var result;
    const value = this.nes.mmap.loadPpu(this.vramAddress);
    // Note: reading from [0, $3eff] has weird buffering behavior.
    // https://wiki.nesdev.com/w/index.php/PPU_registers#The_PPUDATA_read_buffer_.28post-fetch.29
    if (this.vramAddress <= 0x3eff) {
      result = this.vramBufferedReadValue;

      // Update buffered value:
      this.vramBufferedReadValue = value;

      // Mapper latch access:
      if (this.vramAddress < 0x2000) {
        this.nes.mmap.latchAccess(this.vramAddress);
      }
    } else {
      // No buffering in this mem range. Read normally.
      result = value;
    }

    // Increment by either 1 or 32, depending on d2 of Control Register 1:
    this.vramAddress += this.f_addrInc === 1 ? 32 : 1;

    this.cntsFromAddress();
    this.regsFromAddress();

    return result;
  },

  // CPU Register $2007(W):
  // Write to PPU memory. The address should be set first.
  vramWrite: function(value) {
    this.triggerRendering();
    this.cntsToAddress();
    this.regsToAddress();

    this.writeMem(this.vramAddress, value);

    // Invoke mapper latch:
    if (this.vramAddress < 0x2000) this.nes.mmap.latchAccess(this.vramAddress);

    // Increment by either 1 or 32, depending on d2 of Control Register 1:
    this.vramAddress += this.f_addrInc === 1 ? 32 : 1;
    this.regsFromAddress();
    this.cntsFromAddress();
  },

  // CPU Register $4014:
  // Write 256 bytes of main memory
  // into Sprite RAM.
  sramDMA: function(value) {
    var baseAddress = value * 0x100;
    var data;
    for (var i = this.sramAddress; i < 256; i++) {
      // TODO(sdh): consider storing the actual CPU RAM on the cpu object
      // and then revert this to cpu.mem - but that's more complicated.
      data = this.nes.mmap.load(baseAddress + i);
      // this.vram[0x1000 | i] = data;
      this.spriteRamWriteUpdate(i, data);
    }

    this.nes.cpu.haltCycles(513);
  },

  // Updates the scroll registers from a new VRAM address.
  regsFromAddress: function() {
    var address = (this.vramTmpAddress >> 8) & 0xff;
    this.regFV = (address >> 4) & 7;
    this.regV = (address >> 3) & 1;
    this.regH = (address >> 2) & 1;
    this.regVT = (this.regVT & 7) | ((address & 3) << 3);

    address = this.vramTmpAddress & 0xff;
    this.regVT = (this.regVT & 24) | ((address >> 5) & 7);
    this.regHT = address & 31;
  },

  // Updates the scroll registers from a new VRAM address.
  cntsFromAddress: function() {
    var address = (this.vramAddress >> 8) & 0xff;
    this.cntFV = (address >> 4) & 3;
    this.cntV = (address >> 3) & 1;
    this.cntH = (address >> 2) & 1;
    this.cntVT = (this.cntVT & 7) | ((address & 3) << 3);

    address = this.vramAddress & 0xff;
    this.cntVT = (this.cntVT & 24) | ((address >> 5) & 7);
    this.cntHT = address & 31;
  },

  regsToAddress: function() {
    var b1 = (this.regFV & 7) << 4;
    b1 |= (this.regV & 1) << 3;
    b1 |= (this.regH & 1) << 2;
    b1 |= (this.regVT >> 3) & 3;

    var b2 = (this.regVT & 7) << 5;
    b2 |= this.regHT & 31;

    this.vramTmpAddress = ((b1 << 8) | b2) & 0x7fff;
  },

  cntsToAddress: function() {
    var b1 = (this.cntFV & 7) << 4;
    b1 |= (this.cntV & 1) << 3;
    b1 |= (this.cntH & 1) << 2;
    b1 |= (this.cntVT >> 3) & 3;

    var b2 = (this.cntVT & 7) << 5;
    b2 |= this.cntHT & 31;

    this.vramAddress = ((b1 << 8) | b2) & 0x7fff;
  },

  incTileCounter: function(count) {
    for (var i = count; i !== 0; i--) {
      this.cntHT++;
      if (this.cntHT === 32) {
        this.cntHT = 0;
        this.cntVT++;
        if (this.cntVT >= 30) {
          this.cntH++;
          if (this.cntH === 2) {
            this.cntH = 0;
            this.cntV++;
            if (this.cntV === 2) {
              this.cntV = 0;
              this.cntFV++;
              this.cntFV &= 0x7;
            }
          }
        }
      }
    }
  },

  // // Reads from memory, taking into account
  // // mirroring/mapping of address ranges.
  // mirroredLoad: function(address) {
  //   return this.vramMem[this.vramMirrorTable[address]];
  // },

  // Writes to memory, taking into account
  // mirroring/mapping of address ranges.
  // mirroredWrite: function(address, value) {
  //   if (address >= 0x3f00 && address < 0x3f20) {
  //     // Palette write mirroring.
  //     if (address === 0x3f00 || address === 0x3f10) {
  //       this.writeMem(0x3f00, value);
  //       this.writeMem(0x3f10, value);
  //     } else if (address === 0x3f04 || address === 0x3f14) {
  //       this.writeMem(0x3f04, value);
  //       this.writeMem(0x3f14, value);
  //     } else if (address === 0x3f08 || address === 0x3f18) {
  //       this.writeMem(0x3f08, value);
  //       this.writeMem(0x3f18, value);
  //     } else if (address === 0x3f0c || address === 0x3f1c) {
  //       this.writeMem(0x3f0c, value);
  //       this.writeMem(0x3f1c, value);
  //     } else {
  //       this.writeMem(address, value);
  //     }
  //   } else {
  //     // Use lookup table for mirrored address:
  //     if (address < this.vramMirrorTable.length) {
  //       this.writeMem(this.vramMirrorTable[address], value);
  //     } else {
  //       throw new Error("Invalid VRAM address: " + address.toString(16));
  //     }
  //   }
  // },

  triggerRendering: function() {
    if (this.scanline >= 21 && this.scanline <= 260) {
      // Render sprites, and combine:
      this.renderFramePartially(
        this.lastRenderedScanline + 1,
        this.scanline - 21 - this.lastRenderedScanline
      );

      // Set last rendered scanline:
      this.lastRenderedScanline = this.scanline - 21;
    }
  },

  renderFramePartially: function(startScan, scanCount) {
    if (this.f_spVisibility) {
      this.renderSpritesPartially(startScan, scanCount, SPRITE_PRIORITY_BG);
    }

    if (this.f_bgVisibility) {
      var si = startScan << 8;
      var ei = (startScan + scanCount) << 8;
      if (ei > 0xf000) {
        ei = 0xf000;
      }
      var buffer = this.buffer;
      var bgbuffer = this.bgbuffer;
      var pixrendered = this.pixrendered;
      for (var destIndex = si; destIndex < ei; destIndex++) {
        if (pixrendered[destIndex] > 0xff) {
          buffer[destIndex] = bgbuffer[destIndex];
        }
      }
    }

    if (this.f_spVisibility) {
      this.renderSpritesPartially(startScan, scanCount, /* bgPri= */ 0);
    }

    ///////this.validTileData = false;
  },

  // renderBgScanline: function(bgbuffer, scan) {
  //   var baseTile = this.regS === 0 ? 0 : 256;
  //   var destIndex = (scan << 8) - this.regFH;

  //   this.curNt = this.ntable1[this.cntV + this.cntV + this.cntH];

  //   this.cntHT = this.regHT;
  //   this.cntH = this.regH;
  //   this.curNt = this.ntable1[this.cntV + this.cntV + this.cntH];

  //   if (scan < 240 && scan - this.cntFV >= 0) {
  //     var tscanoffset = this.cntFV << 3;
  //     var scantile = this.scantile;
  //     var attrib = this.attrib;
  //     var ptTile = this.ptTile;
  //     var nameTable = this.nameTable;
  //     var imgPalette = this.imgPalette;
  //     var pixrendered = this.pixrendered;
  //     var targetBuffer = bgbuffer ? this.bgbuffer : this.buffer;

  //     var t, tpix, att, col;

  //     for (var tile = 0; tile < 32; tile++) {
  //       if (scan >= 0) {
  //         // Fetch tile & attrib data:
  //         if (this.validTileData) {
  //           // Get data from array:
  //           t = scantile[tile];
  //           if (typeof t === "undefined") {
  //             continue;
  //           }
  //           tpix = t.pix;
  //           att = attrib[tile];
  //         } else {
  //           // Fetch data:
  //           t =
  //             ptTile[
  //               baseTile +
  //                 nameTable[this.curNt].getTileIndex(this.cntHT, this.cntVT)
  //             ];
  //           if (typeof t === "undefined") {
  //             continue;
  //           }
  //           tpix = t.pix;
  //           att = nameTable[this.curNt].getAttrib(this.cntHT, this.cntVT);
  //           scantile[tile] = t;
  //           attrib[tile] = att;
  //         }

  //         // Render tile scanline:
  //         var sx = 0;
  //         var x = (tile << 3) - this.regFH;

  //         if (x > -8) {
  //           if (x < 0) {
  //             destIndex -= x;
  //             sx = -x;
  //           }
  //           if (t.opaque[this.cntFV]) {
  //             for (; sx < 8; sx++) {
  //               targetBuffer[destIndex] =
  //                 imgPalette[tpix[tscanoffset + sx] + att];
  //               pixrendered[destIndex] |= 256;
  //               destIndex++;
  //             }
  //           } else {
  //             for (; sx < 8; sx++) {
  //               col = tpix[tscanoffset + sx];
  //               if (col !== 0) {
  //                 targetBuffer[destIndex] = imgPalette[col + att];
  //                 pixrendered[destIndex] |= 256;
  //               }
  //               destIndex++;
  //             }
  //           }
  //         }
  //       }

  //       // Increase Horizontal Tile Counter:
  //       if (++this.cntHT === 32) {
  //         this.cntHT = 0;
  //         this.cntH++;
  //         this.cntH %= 2;
  //         this.curNt = this.ntable1[(this.cntV << 1) + this.cntH];
  //       }
  //     }

  //     // Tile data for one row should now have been fetched,
  //     // so the data in the array is valid.
  //     this.validTileData = true;
  //   }

  //   // update vertical scroll:
  //   this.cntFV++;
  //   if (this.cntFV === 8) {
  //     this.cntFV = 0;
  //     this.cntVT++;
  //     if (this.cntVT === 30) {
  //       this.cntVT = 0;
  //       this.cntV++;
  //       this.cntV %= 2;
  //       this.curNt = this.ntable1[(this.cntV << 1) + this.cntH];
  //     } else if (this.cntVT === 32) {
  //       this.cntVT = 0;
  //     }

  //     // Invalidate fetched data:
  //     this.validTileData = false;
  //   }
  // },

  renderBgScanline: function(bgbuffer, scan) {
    const baseTile = this.f_bgPatternTable;
    var destIndex = (scan << 8) - this.regFH;

    this.cntHT = this.regHT;
    this.cntH = this.regH;
    let nt = 0x2000 | (((this.cntV << 1) | this.cntH) << 10);
    //let nt = this.nameTable[(this.cntV << 1) | this.cntH];

    if (scan < 240 && scan - this.cntFV >= 0) {
      var tscanoffset = this.cntFV << 3;

      // palette with color mode included.
      const pal = PALETTE.subarray(this.f_color, this.f_color + 0x40);
      const imgPalette = this.nes.mmap.loadPalette(IMG_PALETTE);
      var pixrendered = this.pixrendered;
      var targetBuffer = bgbuffer ? this.bgbuffer : this.buffer;

const d=window.DEBUG&&!(scan!=100);
if(d)console.log(`render scanline ${scan}`);

      // tileX is tile index relative to top-left of screen
      // cntHT and cntVT are relative to the top corner of the nametable
      for (let tileX = 0; tileX < 32; tileX++) {
        if (scan >= 0) {
          // Check the current value of the nametable.
          const tile = this.nes.mmap.loadPpu(nt | (this.cntVT << 5) | this.cntHT);
          const tileAddress = baseTile | (tile << 4) | this.cntFV;
          let line = this.nes.mmap.loadTileScanline(tileAddress);
          const attrByte =
              this.nes.mmap.loadPpu(
                  nt | 0x3c0 | ((this.cntVT & 0xfc) << 1) | (tileX >> 2));
          const attrShift = ((this.cntVT & 2) << 1) | (this.cntHT & 2);
          const att = ((attrByte >> attrShift) & 3) << 2;

if(d)console.log(`render tile #${tileX} (${this.cntVT.toString(16)}, ${this.cntHT.toString(16)}): tile id=${((baseTile ? 0x100 : 0) + tile).toString(16)} @ ${tileAddress.toString(16)}, att=${att}
  att addr=${(nt | 0x3c0 | ((this.cntHT & 0xfc) << 1) | (tileX >> 2)).toString(16)}
  att byte=${attrByte} shift=${attrShift}`);

// ${[0,1,2,3,4,5,6,7].map(i=>this.nes.mmap.loadTileScanline(tileAddress&~7|i).toString(4).padStart(8,0)).join('\n')}`);
if(d)this.nes.debug.break = true;

          // Render tile scanline:
          let minx = 0;
          let x = (tileX << 3) - this.regFH;

          if (x > -8) {
            if (x < 0) {
              destIndex -= x;
              minx = -x;
            }
            destIndex += 8 - minx;
            let di = destIndex;
            for (let sx = 7; sx >= minx; sx--) {
              const col = line & 3;
              line >>= 2;
              di--;
              if (col) {
// if(d)console.log(`  x=${sx} di=${di.toString(16)} imgPal=${imgPalette[col|att].toString(16)} pal=>${pal[imgPalette[col | att]].toString(16)}`);
                targetBuffer[di] = pal[imgPalette[col | att]];
                pixrendered[di] |= 0x100;
              }
            }
          }
        }

        // Increase Horizontal Tile Counter:
        if (++this.cntHT === 32) {
          this.cntHT = 0;
          this.cntH ^= 1;
          nt ^= 0x400;
        }
      }
    }

    // update vertical scroll:
    this.cntFV++;
    if (this.cntFV === 8) {
      this.cntFV = 0;
      this.cntVT++;
      if (this.cntVT === 30) {
        this.cntVT = 0;
        this.cntV++;
        this.cntV %= 2;
      } else if (this.cntVT === 32) {
        this.cntVT = 0;
      }
    }
  },

  renderSpritesPartially: function(startscan, scancount, bgPri) {
    let index = 0x1000;
    if (this.f_spVisibility) {
      const pal = this.nes.mmap.loadPalette(SPR_PALETTE);
      for (let i = 0; i < 64; i++) {
        const y = this.vram[index++]; // read right from vram (OAM isn't mapped)
        const tile = this.vram[index++] << 4; // 16 bytes per tile
        const attr = this.vram[index++];
        const x = this.vram[index++];
        if ((attr & SPRITE_PRIORITY_BG) == bgPri &&
            x >= 0 && x < 256 && y + 8 >= startscan && y < startscan + scancount) {
          // Show sprite.
          if (!this.f_tallSprites) {
            // 8x8 sprites
            // let srcy1 = 0;
            // let srcy2 = 8;
            // if (y < startscan) {
            //   srcy1 = startscan - y - 1;
            // }
            // if (y + 8 > startscan + scancount) {
            //   srcy2 = startscan + scancount - y + 1;
            // }

            this.renderSprite(
                i,
                this.f_spPatternTable | tile, 
                Math.max(startscan - y - 1, 0),
                // y < startscan ? startscan - y - 1 : 0;
                Math.min(startscan + scancount - y + 1, 8),
                // y + 8 > startscan + scancount ? startscan + scancount - y + 1 : 8,
                x,
                y + 1,
                attr,
                pal);

          } else {
            // 8x16 sprites
            let top = tile;
            if (top & 0x10) top ^= 0x1010;

            // var srcy1 = 0;
            // var srcy2 = 8;

            // if (y < startscan) {
            //   srcy1 = startscan - y - 1;
            // }

            // if (y + 8 > startscan + scancount) {
            //   srcy2 = startscan + scancount - y;
            // }

            this.renderSprite(
                i,
                top + (attr & SPRITE_VERT_FLIP ? 1 : 0),
                // y < startscan ? startscan - y - 1 : 0,
                // should this by - y + 1
                // y + 8 > startscan + scancount ? startscan + scancount - y : 8,
                Math.max(startscan - y - 1, 0),
                Math.min(startscan + scancount - y, 8),
                x,
                y + 1,
                attr,
                pal);

            srcy1 = 0;
            srcy2 = 8;

            if (y + 8 < startscan) {
              srcy1 = startscan - (y + 9);
            }

            if (y + 16 > startscan + scancount) {
              srcy2 = startscan + scancount - (y + 8);
            }

            this.renderSprite(
                i,
                top + (attr & SPRITE_VERT_FLIP ? 0 : 1),
                Math.max(startscan - y - 9, 0),
                Math.min(startscan + scancount - y - 8, 0),
                x,
                y + 9,
                attr,
                pal);
            // this.ptTile[top + (this.vertFlip[i] ? 0 : 1)].render(
            //   this.buffer,
            //   srcy1,
            //   srcy2,
            //   this.sprX[i],
            //   this.sprY[i] + 1 + 8,
            //   this.sprCol[i],
            //   this.sprPalette,
            //   this.horiFlip[i],
            //   this.vertFlip[i],
            //   i,
            //   this.pixrendered
            // );
          }
        }
      }
    }
  },

  checkSprite0: function(scan) {
    this.spr0HitX = -1;
    this.spr0HitY = -1;

    //var toffset;
    //var x, y, t, i;
    //var bufferIndex;

    const y = this.vram[0x1000] + 1;
    let tile = this.vram[0x1001] << 4;
    const attr = this.vram[0x1002];
    const x = this.vram[0x1003];

    let addr = -1;

    if (!this.f_tallSprites) {
      // 8x8 sprites.
      if (y <= scan && y + 8 > scan && x >= -7 && x < 256) {
        // Sprite is in range: load the relevant scanline.
        const spriteY = attr & SPRITE_VERT_FLIP ? 7 - (scan - y) : scan - y;
        addr = this.f_spPatternTable | tile | spriteY;
      }
    } else {
      // 8x16 sprites
      if (y <= scan && y + 16 > scan && x >= -7 && x < 256) {
        // Sprite is in range: load the relevant scanline.
        let spriteY = attr & SPRITE_VERT_FLIP ? 15 - (scan - y) : scan - y;
        if (tile & 0x10) tile ^= 0x1010;
        if (spriteY & 8) tile |= 0x10;
        addr = tile | spriteY;
      }
    }
    if (addr < 0) return false; // not in range
    let line = this.nes.mmap.loadPpu(addr) | this.nes.mmap.loadPpu(addr ^ 8);
    if (attr & SPRITE_HORI_FLIP) line = utils.reverseBits(line);

    // now find the background value
    let cntH = this.regH ? 0x400 : 0;
    let cntV = this.regV ? 0x800 : 0;
    let scanlineY = (this.regVT << 3 | this.regFV) + y;
    let spriteX = (this.HT << 3 | this.FH) + x;
    if (scanlineY > 0xff) {
      cntV ^= 0x800;
      scanlineY &= 0xff;
    }
    let tileX = spriteX >> 3;
    let offsetX = spriteX & 7;
    if (tileX > 0x1f) {
      cntH ^= 0x400;
      tileX &= ~0x20;
    }
    let bgTile =
        this.f_spPatternTable |
        (this.nes.mmap.loadPpu(
            cntH | cntV | ((scanlineY & 0xf8) << 2) | tileX) << 4);
    let bgLine =
        (this.nes.mmap.loadPpu(bgTile) | this.nes.mmap.loadPpu(bgTile ^ 8)) <<
            offsetX;
    let hit = bgLine & line;
    if (!hit && offsetX) {
      // try the second tile.
      tileX++;
      if (tileX > 0x1f) {
        cntH ^= 0x400;
        tileX &= ~0x20;
      }
      bgTile =
          this.f_spPatternTable |
          (this.nes.mmap.loadPpu(
              cntH | cntV | ((scanlineY & 0xf8) << 2) | tileX) << 4);
      bgLine =
          (this.nes.mmap.loadPpu(bgTile) | this.nes.mmap.loadPpu(bgTile ^ 8)) >>>
              (8 - offsetX);
      hit = bgLine & line;
    }

    if (hit) {
      // There's a hit, find the X position.
      const hitX = x + Math.clz32(hit) - 24;
      if (hitX >= 0 && hitX < 256 && this.pixrendered[scan << 8 | hitX]) {
        this.spr0HitX = hitX;
        this.spr0HitY = scan;
        return true;
      }
    }
    return false;
  },

  setSprite0Hit: function() {
    this.status |= STATUS_SPRITE0HIT;
  },

  // This will write to PPU memory, and
  // update internally buffered data
  // appropriately.
  writeMem: function(address, value) {
    // this.triggerRendering();
    // nametable writes trigger sprite0 check but not rendering ??
    // but that doesn't seem to actually matter...?
    // if ((address & 0xe000) == 0x2000 && (address & 0x03c0) != 0x3c0) {
    //   this.checkSprite0(this.scanline - 20);
    // }
    this.nes.mmap.writePpu(address, value);
    // this.vramMem[address] = value;

    // Update internally buffered data:
    // if (address < 0x2000) {
    //   this.patternWrite(address, value);
    // } else if (address >= 0x2000 && address < 0x23c0) {
    //   this.nameTableWrite(this.ntable1[0], address - 0x2000, value);
    // } else if (address >= 0x23c0 && address < 0x2400) {
    //   this.attribTableWrite(this.ntable1[0], address - 0x23c0, value);
    // } else if (address >= 0x2400 && address < 0x27c0) {
    //   this.nameTableWrite(this.ntable1[1], address - 0x2400, value);
    // } else if (address >= 0x27c0 && address < 0x2800) {
    //   this.attribTableWrite(this.ntable1[1], address - 0x27c0, value);
    // } else if (address >= 0x2800 && address < 0x2bc0) {
    //   this.nameTableWrite(this.ntable1[2], address - 0x2800, value);
    // } else if (address >= 0x2bc0 && address < 0x2c00) {
    //   this.attribTableWrite(this.ntable1[2], address - 0x2bc0, value);
    // } else if (address >= 0x2c00 && address < 0x2fc0) {
    //   this.nameTableWrite(this.ntable1[3], address - 0x2c00, value);
    // } else if (address >= 0x2fc0 && address < 0x3000) {
    //   this.attribTableWrite(this.ntable1[3], address - 0x2fc0, value);
    // } else if (address >= 0x3f00 && address < 0x3f20) {
    //   this.updatePalettes();
    // }
  },

  // // Reads data from $3f00 to $f20
  // // into the two buffered palettes.
  // updatePalettes: function() {
  //   // TODO - can we just inlinw this rather than buffering?
  //   const pal = this.f_color;
  //   for (let i = 0; i < 16; i++) {
  //     this.imgPalette[i] = PALETTE[pal | this.nes.mmap.loadPpu(0x3f00 | i)];
  //     this.sprPalette[i] = PALETTE[pal | this.nes.mmap.loadPpu(0x3f10 | i)];
  //   }
  // },

  // // Updates the internal pattern
  // // table buffers with this new byte.
  // // In vNES, there is a version of this with 4 arguments which isn't used.
  // patternWrite: function(address, value) {
  //   var tileIndex = Math.floor(address / 16);
  //   var leftOver = address % 16;
  //   if (leftOver < 8) {

  //     // TODO - replace vramMem with mmap.loadPpu
  //     // TODO - ensure removed/added fields consistent across
  //     // ctor, json, etc

  //     this.ptTile[tileIndex].setScanline(
  //       leftOver,
  //       value,
  //       this.vramMem[address + 8]
  //     );
  //   } else {
  //     this.ptTile[tileIndex].setScanline(
  //       leftOver - 8,
  //       this.vramMem[address - 8],
  //       value
  //     );
  //   }
  // },

  // // Updates the internal name table buffers
  // // with this new byte.
  // nameTableWrite: function(index, address, value) {
  //   this.nameTable[index].tile[address] = value;

  //   // Update Sprite #0 hit:
  //   //updateSpr0Hit();
  //   this.checkSprite0(this.scanline - 20);
  // },

  // // Updates the internal pattern
  // // table buffers with this new attribute
  // // table byte.
  // attribTableWrite: function(index, address, value) {
  //   this.nameTable[index].writeAttrib(address, value);
  // },

  // Updates the internally buffered sprite
  // data with this new byte of info.
  spriteRamWriteUpdate: function(address, value) {
    if (!(address & 0xfc)) this.checkSprite0(this.scanline - 20);
    this.vram[0x1000 | address] = value;
  },

  doNMI: function() {
    // Set VBlank flag:
    this.status |= STATUS_VBLANK;
    //nes.getCpu().doNonMaskableInterrupt();
    this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NMI);
  },

  isPixelWhite: function(x, y) {
    this.triggerRendering();
    return this.nes.ppu.buffer[(y << 8) + x] === 0xffffff;
  },

  renderSprite: function(index, tileAddress, srcy1, srcy2, dx, dy, attr, pal) {
      // palette, = attr & 3
      // flipHorizontal, = attr & 040
      // flipVertical, = attr & 0x80
      //pri, = index
      //priTable) { = this.pixrendered

    const buffer = this.buffer;
    const priTable = this.pixrendered;
    const flipHorizontal = attr & SPRITE_HORI_FLIP;
    const flipVertical = attr & SPRITE_VERT_FLIP;
    // NOTE: flipVertical is simply ^7 on the address!
    //       and for flipHorizontal we can reverse the bits
    pal |= (attr & SPRITE_PALETTE) << 2;

    let srcx1 = 0;
    let srcx2 = 8;

    if (dx < -7 || dx >= 256 || dy < -7 || dy >= 240) {
      return;
    }

    if (dx < 0) {
      srcx1 -= dx;
    }
    if (dx + srcx2 >= 256) {
      srcx2 = 256 - dx;
    }

    if (dy < 0) {
      srcy1 -= dy;
    }
    if (dy + srcy2 >= 240) {
      srcy2 = 240 - dy;
    }

    if (!flipHorizontal && !flipVertical) {
      let fbIndex = (dy << 8) + dx;
      for (let y = 0; y < 8; y++) {
        const line = this.nes.mmap.loadTileScanline(tileAddress);
        let shift = 14;
        for (let x = 0; x < 8; x++) {
          if (x >= srcx1 && x < srcx2 && y >= srcy1 && y < srcy2) {
            const color = (line >>> shift) & 3;
            let tpri = priTable[fbIndex];
            if (color && index <= (tpri & 0xff)) {
              //console.log("Rendering upright tile to buffer");
              buffer[fbIndex] = PALETTE[pal | color];
              tpri = (tpri & 0xf00) | index;
              priTable[fbIndex] = tpri;
            }
          }
          shift -= 2;
          fbIndex++;
        }
        fbIndex += 248;
      }
    } else if (flipHorizontal && !flipVertical) {
      let fbIndex = (dy << 8) + dx;
      for (let y = 0; y < 8; y++) {
        const line = this.nes.mmap.loadTileScanline(tileAddress);
        let shift = 14;
        for (let x = 0; x < 8; x++) {
          if (x >= srcx1 && x < srcx2 && y >= srcy1 && y < srcy2) {
            const color = (line >>> shift) & 3;
            let tpri = priTable[fbIndex];
            if (color && index <= (tpri & 0xff)) {
              buffer[fbIndex] = PALETTE[pal | color];
              tpri = (tpri & 0xf00) | index;
              priTable[fbIndex] = tpri;
            }
          }
          shift -= 2;
          fbIndex++;
        }
        fbIndex += 248;
      }
    } else if (flipVertical && !flipHorizontal) {
      let fbIndex = (dy << 8) + dx;
      for (let y = 0; y < 8; y++) {
        let line = this.nes.mmap.loadTileScanline(tileAddress);
        for (let x = 0; x < 8; x++) {
          if (x >= srcx1 && x < srcx2 && y >= srcy1 && y < srcy2) {
            const color = line & 3;
            let tpri = priTable[fbIndex];
            if (color && index <= (tpri & 0xff)) {
              buffer[fbIndex] = PALETTE[pal | color];
              tpri = (tpri & 0xf00) | index;
              priTable[fbIndex] = tpri;
            }
          }
          line >>>= 2;
          fbIndex++;
        }
        fbIndex += 248;
      }
    } else {
      let fbIndex = (dy << 8) + dx;
      for (let y = 0; y < 8; y++) {
        let line = this.nes.mmap.loadTileScanline(tileAddress);
        for (let x = 0; x < 8; x++) {
          if (x >= srcx1 && x < srcx2 && y >= srcy1 && y < srcy2) {
            const color = line & 3;
            let tpri = priTable[fbIndex];
            if (color && index <= (tpri & 0xff)) {
              buffer[fbIndex] = PALETTE[pal | color];
              tpri = (tpri & 0xf00) | index;
              priTable[fbIndex] = tpri;
            }
          }
          line >>>= 2;
          fbIndex++;
        }
        fbIndex += 248;
      }
    }
  },


  JSON_PROPERTIES: [
    // Memory
    "vram",
    // Counters
    "cntFV",
    "cntV",
    "cntH",
    "cntVT",
    "cntHT",
    // Registers
    "reg1",
    "reg2",
    "regFV",
    "regV",
    "regH",
    "regVT",
    "regHT",
    "regFH",
    // VRAM addr
    "vramAddress",
    "vramTmpAddress",
    // Control/Status registers
    "f_nmiOnVblank",
    "f_tallSprites",
    "f_bgPatternTable",
    "f_spPatternTable",
    "f_addrInc",
    "f_nTblAddress",
    "f_color",
    "f_spVisibility",
    "f_bgVisibility",
    "f_spClipping",
    "f_bgClipping",
    "status",
    // VRAM I/O
    "vramBufferedReadValue",
    "firstWrite",
    // Mirroring
    "currentMirroring",
    // SPR-RAM I/O
    "sramAddress",
    // Sprites. Most sprite data is rebuilt from spriteMem
    "hitSpr0",
    // Rendering progression
    "curX",
    "scanline",
    "lastRenderedScanline",
    // Used during rendering
    "attrib",
    "buffer",
    "bgbuffer",
    "pixrendered",
    // Misc
    "requestEndFrame",
    "nmiOk",
    "dummyCycleToggle",
    "nmiCounter",
    "scanlineAlreadyRendered"
  ],

  toJSON: function() {
    // var i;
    // var state = utils.toJSON(this);

    // state.nameTable = [];
    // for (i = 0; i < this.nameTable.length; i++) {
    //   state.nameTable[i] = this.nameTable[i].toJSON();
    // }

    // state.ptTile = [];
    // for (i = 0; i < this.ptTile.length; i++) {
    //   state.ptTile[i] = this.ptTile[i].toJSON();
    // }

    // return state;
  },

  fromJSON: function(state) {
    // var i;

    // utils.fromJSON(this, state);

    // for (i = 0; i < this.nameTable.length; i++) {
    //   this.nameTable[i].fromJSON(state.nameTable[i]);
    // }

    // for (i = 0; i < this.ptTile.length; i++) {
    //   this.ptTile[i].fromJSON(state.ptTile[i]);
    // }

    // // Sprite data:
    // for (i = 0; i < this.spriteMem.length; i++) {
    //   this.spriteRamWriteUpdate(i, this.spriteMem[i]);
    // }
  }
};

// class NameTable {
//   constructor(nes, offset) {
//     this.nes = nes;
//     this.offset = offset;
//   }

//   /** Returns the index of a Tile. */
//   getTileIndex(x, y) {
//     return this.nes.mmap.loadPpu(this.offset | (y << 5) | 5);
//   }

//   getAttrib(x, y) {
//     const mem =
//         this.nes.mmap.loadPpu(
//             this.offset | 0x3c0 | ((y & 0xfc) << 1) | (x >> 2));
//     const shift = ((y & 2) << 1) | (x & 2);
//     return (mem >> shift) & 3;
//   }

//   writeAttrib(index, value) {
//     // no need
//   }
// }


// var NameTable = function(width, height, name) {
//   this.width = width;
//   this.height = height;
//   this.name = name;

//   this.tile = new Array(width * height);
//   this.attrib = new Array(width * height);
//   for (var i = 0; i < width * height; i++) {
//     this.tile[i] = 0;
//     this.attrib[i] = 0;
//   }
// };

// NameTable.prototype = {
//   getTileIndex: function(x, y) {
//     return this.tile[y * this.width + x];
//   },

//   getAttrib: function(x, y) {
//     return this.attrib[y * this.width + x];
//   },

//   writeAttrib: function(index, value) {
//     var basex = (index % 8) * 4;
//     var basey = Math.floor(index / 8) * 4;
//     var add;
//     var tx, ty;
//     var attindex;

//     for (var sqy = 0; sqy < 2; sqy++) {
//       for (var sqx = 0; sqx < 2; sqx++) {
//         add = (value >> (2 * (sqy * 2 + sqx))) & 3;
//         for (var y = 0; y < 2; y++) {
//           for (var x = 0; x < 2; x++) {
//             tx = basex + sqx * 2 + x;
//             ty = basey + sqy * 2 + y;
//             attindex = ty * this.width + tx;
//             this.attrib[attindex] = (add << 2) & 12;
//           }
//         }
//       }
//     }
//   },

//   toJSON: function() {
//     return {
//       tile: this.tile,
//       attrib: this.attrib
//     };
//   },

//   fromJSON: function(s) {
//     this.tile = s.tile;
//     this.attrib = s.attrib;
//   }
// };

const PALETTE = (() => {
  const colors = [
    0x525252, 0xB40000, 0xA00000, 0xB1003D, 0x740069, 0x00005B, 0x00005F, 0x001840,
    0x002F10, 0x084A08, 0x006700, 0x124200, 0x6D2800, 0x000000, 0x000000, 0x000000,
    0xC4D5E7, 0xFF4000, 0xDC0E22, 0xFF476B, 0xD7009F, 0x680AD7, 0x0019BC, 0x0054B1,
    0x006A5B, 0x008C03, 0x00AB00, 0x2C8800, 0xA47200, 0x000000, 0x000000, 0x000000,
    0xF8F8F8, 0xFFAB3C, 0xFF7981, 0xFF5BC5, 0xFF48F2, 0xDF49FF, 0x476DFF, 0x00B4F7,
    0x00E0FF, 0x00E375, 0x03F42B, 0x78B82E, 0xE5E218, 0x787878, 0x000000, 0x000000,
    0xFFFFFF, 0xFFF2BE, 0xF8B8B8, 0xF8B8D8, 0xFFB6FF, 0xFFC3FF, 0xC7D1FF, 0x9ADAFF,
    0x88EDF8, 0x83FFDD, 0xB8F8B8, 0xF5F8AC, 0xFFFFB0, 0xF8D8F8, 0x000000, 0x000000,
  ];
  const palette = new Uint32Array(1024);  // 64 colors * 8 emphasis * 2 grey

  for (let emph = 0; emph < 16; emph++) {
    // Determine color component factors (note: PAL swaps r and g):
    const grey = emph & 8;
    const rFactor = !emph || (emph & 1) ? 1.0 : 0.75;
    const gFactor = !emph || (emph & 2) ? 1.0 : 0.75;
    const bFactor = !emph || (emph & 4) ? 1.0 : 0.75;

    for (let index = 0; index < 64; index++) {
      const col = colors[index & (grey ? 0x30 : 0xff)];
      const r = Math.floor((col >> 16) * rFactor);
      const g = Math.floor(((col >> 8) & 0xff) * gFactor);
      const b = Math.floor((col & 0xff) * bFactor);
      palette[(emph << 6) | index] = (r << 16) | (g << 8) | b;
    }
  }
console.log(Array.from(palette, x=>`$${x.toString(16).padStart(6,0)}`));
  return palette;
})();

const IMG_PALETTE = 0x3f00;
const SPR_PALETTE = 0x3f10;
const SPRITE_PALETTE = 0x03;
const SPRITE_PRIORITY_BG = 0x20;
const SPRITE_HORI_FLIP = 0x40;
const SPRITE_VERT_FLIP = 0x80;
