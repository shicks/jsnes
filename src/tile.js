export class Tile() {
  constructor() {
    // Tile data:
    this.pix = new Array(64);
    this.opaque = new Array(8);
  }

  setScanline(sline, b1, b2) {
    const tIndex = sline << 3;
    for (let x = 0; x < 8; x++) {
      this.pix[tIndex + x] =
        ((b1 >> (7 - x)) & 1) + (((b2 >> (7 - x)) & 1) << 1);
      if (this.pix[tIndex + x] === 0) {
        this.opaque[sline] = false;
      }
    }
  }

  // TODO - remove the caching and just read pixels
  // straight from memory?

  render(
    buffer,
    srcx1,
    srcy1,
    srcx2,
    srcy2,
    dx,
    dy,
    palAdd,
    palette,
    flipHorizontal,
    flipVertical,
    pri,
    priTable
  ) {
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
      let tIndex = 0;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          if (x >= srcx1 && x < srcx2 && y >= srcy1 && y < srcy2) {
            const palIndex = this.pix[tIndex];
            let tpri = priTable[fbIndex];
            if (palIndex !== 0 && pri <= (tpri & 0xff)) {
              //console.log("Rendering upright tile to buffer");
              buffer[fbIndex] = palette[palIndex + palAdd];
              tpri = (tpri & 0xf00) | pri;
              priTable[fbIndex] = tpri;
            }
          }
          fbIndex++;
          tIndex++;
        }
        fbIndex += 248;
      }
    } else if (flipHorizontal && !flipVertical) {
      let fbIndex = (dy << 8) + dx;
      let tIndex = 7;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          if (x >= srcx1 && x < srcx2 && y >= srcy1 && y < srcy2) {
            const palIndex = this.pix[tIndex];
            let tpri = priTable[fbIndex];
            if (palIndex !== 0 && pri <= (tpri & 0xff)) {
              buffer[fbIndex] = palette[palIndex + palAdd];
              tpri = (tpri & 0xf00) | pri;
              priTable[fbIndex] = tpri;
            }
          }
          fbIndex++;
          tIndex--;
        }
        fbIndex += 248;
        tIndex += 16;
      }
    } else if (flipVertical && !flipHorizontal) {
      let fbIndex = (dy << 8) + dx;
      let tIndex = 56;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          if (x >= srcx1 && x < srcx2 && y >= srcy1 && y < srcy2) {
            const palIndex = this.pix[tIndex];
            let tpri = priTable[fbIndex];
            if (palIndex !== 0 && pri <= (tpri & 0xff)) {
              buffer[fbIndex] = palette[palIndex + palAdd];
              tpri = (tpri & 0xf00) | pri;
              priTable[fbIndex] = tpri;
            }
          }
          fbIndex++;
          tIndex++;
        }
        fbIndex += 248;
        tIndex -= 16;
      }
    } else {
      let fbIndex = (dy << 8) + dx;
      let tIndex = 63;
      for (let y = 0; y < 8; y++) {
        for (let x = 0; x < 8; x++) {
          if (x >= srcx1 && x < srcx2 && y >= srcy1 && y < srcy2) {
            const palIndex = this.pix[tIndex];
            let tpri = priTable[fbIndex];
            if (palIndex !== 0 && pri <= (tpri & 0xff)) {
              buffer[fbIndex] = palette[palIndex + palAdd];
              tpri = (tpri & 0xf00) | pri;
              priTable[fbIndex] = tpri;
            }
          }
          fbIndex++;
          tIndex--;
        }
        fbIndex += 248;
      }
    }
  }

  isTransparent(x, y) {
    return this.pix[(y << 3) + x] === 0;
  }

  toJSON() {
    return {
      opaque: this.opaque,
      pix: this.pix
    };
  }

  fromJSON(s) {
    this.opaque = s.opaque;
    this.pix = s.pix;
  }
}
