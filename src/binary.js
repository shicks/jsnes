// Key for a function to return an ArrayBuffer.
// BinaryWriter will look for this.
export const serialize = Symbol('serializable');

export const deserialize = Symbol('deserialize');

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

  /** Reads an unsigned varint. */
  readVarint() {
    let number = 0;
    let multiplier = 1;
    let val;
    do {
      val = this.buf[this.pos++];
      number += (val & 0x7f) * multiplier;
      multiplier *= 128;
    } while (val & 0x80);
    return number;
  }

  readLittleEndian(bytes = 1) {
    if (!bytes) return this.readVarint();
    let number = 0;
    let multiplier = 1;
    while (bytes--) {
      number += multiplier * this.buf[this.pos++];
      multiplier *= 0x100;      
    }
    return number;
  }

  // fills a typed array with the next `array.length` bytes.
  readIntoArray(array, offset = 0, length = array.length - offset) {
    let a = array;
    if (a instanceof ArrayBuffer) {
      a = new Uint8Array(a);
      length = a.length;
    }
    offset *= a.BYTES_PER_ELEMENT;
    length *= a.BYTES_PER_ELEMENT;
    if (!a instanceof Uint8Array) {
      a = new Uint8Array(a.buffer, a.byteOffset, a,byteLength);
    }
    a.set(this.buf.subarray(this.pos, this.pos + length), offset);
    this.pos += length;
    return array;
  }

  readArrayLengthPrefixed(species = Uint8Array) {
    const length = this.readVarint();
    const bytesPer = species == ArrayBuffer ? 1 : species.BYTES_PER_ELEMENT;
    if (length % bytesPer) {
      throw new Error(`bad length ${length} for species ${species}`);
    }
    const out = new species(length / bytesPer);
    this.readIntoArray(out);
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

  readStringLengthPrefixed(bytes = 0) {
    const length = this.readLittleEndian(bytes);
    const str = UTF8_DECODER.decode(this.buf.subarray(this.pos, this.pos + length));
    this.pos += length;
    return str;
  }

  readStringFixedLength(length) {
    let i = this.pos + length;
    while (!this.buf[i - 1]) i--;
    const str = UTF8_DECODER.decode(this.buf.subarray(this.pos, i));
    this.pos += length;
    return str;
  }

  readStringFromRemainingBytes() {
    return this.readStringFixedLength(this.bytesRemaining());
  }

  bytesRemaining() {
    return this.buf.length - this.pos;
  }

  // We store tables as follows (all numbers are varints):
  //   * total length (excluding the length)
  //   * alternate length-prefixed keys, length-prefixed arrays
  // Values are returned as ArrayBuffers, so a species must be
  // specifically assigned.
  readTable(handlers = undefined) {
    const length = this.readVarint();
    const end = this.pos + length;
    let out = {};
    while (this.pos < end) {
      const key = this.readStringLengthPrefixed();
      const value = this.readArrayLengthPrefixed(ArrayBuffer);
      out[key] = value;
      if (handlers && handlers[key]) handlers[key](new BinaryReader(value));
    }
    return out;
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
      const newBuf = new Uint8Array(newSize);
      newBuf.set(this.buf);
      this.buf = newBuf;
    }
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

  writeVarint(num) {
    do {
      let b = num % 128;
      num = Math.floor(num / 128);
      if (num) b |= 0x80;
      this.writeByte(b);
    } while (num);
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
      for (let i = 0; i < arr.length; i++) {
        this.buf[this.pos++] = arr[i];
      }
    }
    return this;
  }

  writeArrayLengthPrefixed(arr) {
    this.writeVarint(arr.byteLength);
    this.writeArray(arr);
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

  writeStringLengthPrefixed(s, bytes = 0) { // little-endian
    const encoded = UTF8_ENCODER.encode(s);
    if (!bytes) { // varint-prefixed
      this.writeVarint(encoded.length).writeArray(encoded);
      return this;
    }
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
    if (!length) length = encoded.length;
    if (encoded.length > length) throw new Error('string too long');
    this.ensureSize_(this.pos + length);
    this.buf.set(encoded, this.pos);
    this.buf.fill(0, this.pos + encoded.length, this.pos + length);
    this.pos += length;
    return this;
  }

  // all values must be typed arrays
  writeTable(table) {
    const w = new BinaryWriter();
    for (const key in table) {
      w.writeStringLengthPrefixed(key)
      if (!table.hasOwnProperty(key)) continue;
      const array = table[key];
      if (typeof array == 'string') array = UTF8_ENCODE(array);
      if (array instanceof BinaryWriter) array = array.toArrayBuffer();
      if (array instanceof ArrayBuffer || array.buffer instanceof ArrayBuffer) {
        w.writeArrayLengthPrefixed(array);
      } else {
        throw new Error(`Bad table value: ${key} => ${array}`);
      }
    }
    return this.writeArrayLengthPrefixed(w.toArrayBuffer());
  }

  toArrayBuffer() {
    return this.buf.slice(0, this.size).buffer;
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
