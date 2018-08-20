export function copyArrayElements(src, srcPos, dest, destPos, length) {
  for (var i = 0; i < length; ++i) {
    dest[destPos + i] = src[srcPos + i];
  }
}

export function copyArray(src) {
  return src.slice(0);
}

export function fromJSON(obj, state) {
  for (var i = 0; i < obj.JSON_PROPERTIES.length; i++) {
    obj[obj.JSON_PROPERTIES[i]] = state[obj.JSON_PROPERTIES[i]];
  }
}

export function toJSON(obj) {
  var state = {};
  for (var i = 0; i < obj.JSON_PROPERTIES.length; i++) {
    state[obj.JSON_PROPERTIES[i]] = obj[obj.JSON_PROPERTIES[i]];
  }
  return state;
}

export function hex(pad, num) {
  return '$' + num.toString(16).padStart(pad, 0);
}

export const reverseBits = (b) => REVERSE_BITS_TABLE[b];

const REVERSE_BITS_TABLE = (() => {
  const table = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    table[i] = ((i * 0x0802 & 0x22110) | (i * 0x8020 & 0x88440)) * 0x10101 >> 16;
  }
  return table;
})();

export class BiMap extends Map {
  constructor(iter = undefined, reverse = undefined) {
    super(iter);
    this.reverse = reverse;
    if (!this.reverse) {
      this.reverse = new BiMap(undefined, this);
      if (iter) {
        for (const [k, v] of this) {
          Map.prototype.set.call(this.reverse, v, k);
        }
      }
    }    
  }

  set(key, value) {
    if (this.has(key)) {
      Map.prototype.delete.call(this.reverse, this.get(key));
    }
    if (this.reverse.has(value)) {
      super.delete(this.reverse.get(value));
    }
    super.set(key, value);
    Map.prototype.set.call(this.reverse, value, key);
    return this;
  }

  delete(key) {
    if (this.has(value)) {
      const value = this.get(value);
      Map.prototype.delete.call(this.reverse, value);
    }
    super.delete(key);
  }

  clear() {
    super.clear();
    Map.prototype.clear.call(this.reverse);
  }
}

// Note: we'd need different handling for RAM banks, since we want to preserve
// writes.  And if the same page is mirrored into two banks at once, we're in
// even more trouble...
export class RomBankSwitcher {
  constructor(data, windowSize, cacheSize = 128) {
    /** @const {!TypedArray} The full data. */
    this.data = data;
    /** @const {number} The total amount that can be addressed at once. */
    this.windowSize = powerOfTwo(windowSize);
    /** @const {number} Max size of the LRU cache. */
    this.cacheSize = cacheSize;
    /** @type {number} The log of the current size of each page - may decrease. */
    this.pageSize = this.windowSize;
    /** @type {!Map<string, !TypedArray>} */
    this.cache = new Map();
    /** @type {!Array<number>} */
    this.current = [0];
  }

  buffer() {
    // Check the cache.
    const key = this.current.join(',');
    let entry = this.cache.get(key);
    if (entry) {
      // update the LRU, return it
      this.cache.delete(key);
      this.cache.set(key, entry);
      return entry;
    }
    // Keep the size in check.
    if (this.cache.size >= this.cacheSize) {
      console.log('evicting from swap cache');
      this.cache.delete(this.cache.keys().next());
    }
    // Construct a new entry.
    entry = new this.data.constructor(this.windowSize);
    const logPage = log2(this.pageSize);
    for (let i = 0; i < this.current.length; i++) {
      const page = this.current[i] << logPage;
      entry.set(this.data.subarray(page, page + this.pageSize), i << logPage);
    }
    this.cache.set(key, entry);
    return entry;
  }

  swap(address, bank, size) {
    // Shrink pageSize to fit.
    size = powerOfTwo(size);
    bank = (bank >>> 0) & (powerOfTwo(this.data.length / size) - 1);
    if (size < this.pageSize) this.divide(size);
    address /= this.pageSize;
    size /= this.pageSize;
    bank *= size;
    const end = address + size;
    while (address < end) this.current[address++] = bank++;
  }

  restore(banks) {
    const size = this.windowSize / banks.length;
    let addr = 0;
    for (const bank of banks) {
      this.swap(addr, bank, size);
      addr += size;
    }
  }

  snapshot() {
    return this.current.slice();
  }

  divide(size) {
    const newPageSize = powerOfTwo(size);
    const factor = (1 << this.pageSize) / newPageSize;
    this.current = divideBanks(this.current, factor);
    const divideKey = (k) => divide(k.split(',').map(Number), factor).join(',');
    this.cache = new Map([...this.cache].map(([k, v]) => [divideKey(k), v]));
  }
}

/** @return {!Array<number>} The new list of divided banks. */
const seq = (n) => new Array(n).fill(0).map((_, i) => i);
const divideBanks = (banks, factor) =>
    [].concat(...banks.map(x => seq(factor).map(i => factor * x + i)));

const powerOfTwo = (x) => 0x80000000 >>> Math.clz32(x);
const log2 = (x) => 31 - Math.clz32(x);
