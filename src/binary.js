export class BinaryReader {
  constructor(buf) {
    let offset = undefined;
    let length = undefined;
    if (!(buf instanceof Uint8Array)) {
      if (!(buf instanceof ArrayBuffer) && buf.buffer instanceof ArrayBuffer) {
        offset = buf.byteOffset;
        length = buf.byteLength;
        buf = buf.buffer;
      }
      if (!(buf instanceof ArrayBuffer)) throw new Error('expected arraybuffer');
      buf = new Uint8Array(buf, offset, length);
    }
    this.buf = buf;
    this.pos = 0;
  }

  seek(pos) {
    if (pos >= this.buf.length) {
      throw new Error(`position out of bounds: ${pos} >= ${this.buf.length}`);
    }
    this.pos = pos;
  }

  eof() {
    return this.pos >= this.buf.length;
  }

  expectString(str, message = 'Expected content not found') {
    const encoded = UTF8_ENCODER.encode(str);
    for (let i = 0; i < encoded.length; i++) {
      if (this.buf[this.pos++] != encoded[i]) throw new Error(message);
    }
    return this;
  }

  expectedBytes(bytes, message = 'Expected content not found') {
    // TODO - if bytes is a typed array, handle that properly
    for (let i = 0; i < bytes.length; i++) {
      if (this.buf[this.pos++] != bytes[i]) throw new Error(message);
    }
    return this;
  }

  readByte() {
    return this.buf[this.pos++];
  }

  readWord() {
    const low = this.buf[this.pos++];
    const high = this.buf[this.pos++];
    return low | (high << 8);
  }

  readLittleEndian(bytes = 1) {
    let number = 0;
    let multiplier = 1;
    while (bytes--) {
      number += multiplier * this.buf[this.pos++];
      multiplier *= 0x100;      
    }
    return number;
  }

  // returns the next `length` bytes as a Uint8Array.
  readArray(length) {
    const out = this.buf.slice(this.pos, this.pos + length);
    this.pos += length;
    return out;
  }

  readStringNullTerminated() {
    for (let i = this.pos; i < this.buf.length; i++) {
      if (!this.buf[i]) {
        const str = UTF8_DECODER.decode(this.buf.subarray(this.pos, i));
        this.pos = i + 1;
        return str;
      }
    }
    throw new Error('null termination not found');
  }

  readStringLengthPrefixed(bytes = 1) {
    const length = this.readLittleEndian(bytes);
    for (let i = this.pos; i < this.buf.length; i++) {
      if (!this.buf[i]) {
        const str = UTF8_DECODER.decode(this.buf.subarray(this.pos, i));
        this.pos = i + 1;
        return str;
      }
    }
    throw new Error('null termination not found');
  }

  readStringFixedLength(length) {
    let i = this.pos + length;
    while (!this.buf[i - 1]) i--;
    const str = UTF8_DECODER.decode(this.buf.subarray(this.pos, i));
    this.pos += length;
    return str;
  }
}

export class BinaryWriter extends BinaryReader {
  constructor() {
    super(new Uint8Array(0x1000)); // 4k
    this.size = 0;
  }

  seek(pos) {
    this.ensureSize_(pos);
    this.pos = pos;
  }

  eof() {
    return this.pos == this.size;
  }

  ensureSize_(size) {
    if (size >= this.buf.length) {
      let newSize = this.buf.length * 2;
      while (newSize < size) newSize *= 2;
    }
    const newBuf = new Uint8Array(newSize);
    newBuf.set(this.buf);
    if (size > this.size) this.size = size;
  }

  writeByte(b) {
    this.ensureSize_(this.pos + 1);
    this.buf[this.pos++] = b;
    return this;
  }

  writeBytes(...bytes) {
    this.ensureSize_(this.pos + bytes.length);
    for (let i = 0; i < bytes.length; i++) {
      this.buf[this.pos++] = bytes[i];
    }
    return this;
  }

  writeWord(word) {
    this.ensureSize_(this.pos + 2);
    this.buf[this.pos++] = w & 0xff;
    this.buf[this.pos++] = w >>> 8;
    return this;
  }

  writeWords(...words) {
    this.ensureSize_(this.pos + 2 * words.length);
    for (let i = 0; i < words.length; i++) {
      this.buf[this.pos++] = words[i] & 0xff;
      this.buf[this.pos++] = words[i] >>> 8;
    }
    return this;
  }

  writeArray(arr) {
    // arr is a typed array or array buffer - make a uint8 array
    if (arr instanceof ArrayBuffer) arr = new Uint8Array(arr);
    if (!(arr instanceof Uint8Array) && arr.buffer instanceof ArrayBuffer) {
      arr = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    }
    this.ensureSize_(this.pos + arr.length);
    if (arr instanceof Uint8Array) {
      this.buf.set(arr, this.pos);
      this.pos += arr.length;
    } else {
      for (let i = 0; i < bytes.length; i++) {
        this.buf[this.pos++] = bytes[i];
      }
    }
    return this;
  }

  writeStringNullTerminated(s) {
    const encoded = UTF8_ENCODER.encode(s);
    this.ensureSize_(this.pos + encoded.length + 1);
    this.buf.set(encoded, this.pos);
    this.pos += encoded.length + 1;
    this.buf[this.pos - 1] = 0;
    return this;
  }

  writeStringLengthPrefixed(s, bytes = 1) { // little-endian
    const encoded = UTF8_ENCODER.encode(s);
    if (encoded.length >= (1 << (bytes * 8))) throw new Error('string too long');
    let len = encoded.length;
    this.ensureSize_(this.pos + len + bytes);
    for (let i = 0; i < bytes; i++) {
      this.buf[this.pos++] = len & 0xff;
      len >>>= 8;
    }
    this.buf.set(encoded, this.pos);
    this.pos += encoded.length;
    return this;
  }

  writeStringFixedLength(s, length = 0) {
    const encoded = UTF8_ENCODER.encode(s);
    if (!length) length = enoded.length;
    if (encoded.length > length) throw new Error('string too long');
    this.ensireSize_(this.pos + length);
    this.buf.set(encoded, this.pos);
    this.buf.fill(0, this.pos + encoded.length, this.pos + length);
    this.pos += length;
    return this;
  }

  toArrayBuffer() {
    return this.buffer.slice(0, this.size).buffer;
  }
}

// export const trimToUtf8Length = (string, length) => {
//   // Does this return a string or a Uint8Array?!?
//   const encoded = UTF8_ENCODER.encode(s);
//   let len = encoded.length;
//   if (len < 
//     if (len > length) {
//       let p = len - 1;
//       while (p && (encoded[p] & 0x80)) {
//         if (!(encoded[p] & 0x40)) {
//           p--;
//           continue;
//         }
//         // initial byte
//       }
//       while (encoded[len - 1] & 0x80) {
//       }
//     }
// }

const UTF8_ENCODER = new TextEncoder('utf-8');
const UTF8_DECODER = new TextDecoder('utf-8');
