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
