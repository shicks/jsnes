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

export class TrieSet {
  constructor() {
    this.contained = false;
    this.data = new Map();
  }

  add(keys) {
    let trie = this;
    for (let i = 0; i < keys.length; i++) {
      let next = trie.data.get(keys[i]);
      if (next == null) trie.data.set(keys[i], next = new TrieSet());
      trie = next;
    }
    return trie.contained;
  }

  // return undefined or a trie - stop if the trie has([])
  next(key) {
    return this.data.get(key);
  }

  has(keys) {
    let trie = this;
    for (let i = 0; trie && i < keys.length; i++) {
      trie = trie.data.get(keys[i]);
    }
    return trie != null && trie.contained;
  }
}
