// Defines a simple format based on a subset of Google Protocol Buffers.
// Only supports a very limited set of field types:
//  - repeated bytes
//  - singular bytes
//  - singular varint


import {BinaryReader, BinaryWriter} from './binary.js';

class Field {
  constructor(index) {
    this.index_ = index;
    this.decoder_ = (x) => x;
    this.builder_ = (x) => x;
    this.repeated_ = false;
    this.required_ = false;
  }

  repeated() {
    if (this.number % 8 == 0) throw new Error('TODO - packed varints');
    this.repeated_ = true;
    return this;
  }

  required() {
    this.required_ = true;
    return this;
  }

  message(ctorFn) {
    this.decoder_ = (x) => ctorFn().parse(x);
    this.builder_ = (x) => ctorFn().of(x);
    return this;
  }

  array(typedArrayCtor) {
    this.decoder_ = (x) => new typedArrayCtor(x);
    return this;
  }
}

const SPEC = Symbol();
const PRIVATE = Symbol();
const FIELDS = Symbol();

export class Proto {
  constructor(priv, spec, fields) {
    if (priv != PRIVATE) throw new Error('private constructor');
    this[SPEC] = spec;
    this[FIELDS] = fields;
  }

  static message(spec) {
    const byName = {};
    const byNumber = [];
    const nested = {};
    for (const key in spec) {
      if (spec[key] instanceof Field) {
        spec[key].key = key;
        byName[key] = spec[key];
        if (spec[key].index_ in byNumber) {
          throw new Error(`duplicate index: ${Math.floor(index / 8)}`);
        }
        byNumber[spec[key].index_] = spec[key];
      } else {
        nested[key] = spec[key];
      }
    }
    const result = class extends Proto {
      constructor(priv, fields) {
        super(priv, byName, fields);
      }
    };
    Object.assign(result, nested);
    result[SPEC] = {byName, byNumber};
    // TODO - consider using a Proxy in some sort of "debug mode"
    // to detect accessing undefined props.  I tried using functions
    // for accessors, but it's too easy to forget to call them anyway.
    const getters = {};
    for (const key in byName) {
      getters[key] = {get() { return this[FIELDS][key]; }};
    }
    Object.defineProperties(result.prototype, getters);
    return result;
  }

  serialize(prefix = undefined) {
    const w = new BinaryWriter();
    if (prefix) w.writeStringFixedLength(prefix);
    for (const key in this[FIELDS]) {
      let value = this[FIELDS][key];
      const spec = this[SPEC][key];
      if (!spec.repeated_) {
        value = [value];
      }
      const type = spec.index_ % 8;
      for (let elem of value) {
        w.writeVarint(spec.index_);
        if (type == 2) {
          if (elem instanceof Proto) elem = elem.serialize();
          w.writeArrayLengthPrefixed(elem);
        } else if (type == 0) {
          w.writeVarint(elem);
        } else {
          throw new Error(`bad type: ${type}`);
        }
      }
    }
    return w.toArrayBuffer();
  }

  static decode(bytesOrObject) {
    if (bytesOrObject instanceof ArrayBuffer) {
      return this.parse(bytesOrObject);
    } else {
      return this.of(bytesOrObject);
    }
  }

  static parse(bytes, prefix = undefined) {
    const r = new BinaryReader(bytes);
    if (prefix) r.expectString(prefix);
    const data = {};
    while (!r.eof()) {
      const index = r.readVarint();
      const spec = this[SPEC].byNumber[index];
      if (!spec) throw new Error(`unknown field number: ${index}`);
      const type = index % 8;
      let value;
      if (type == 2) {
        value = r.readArrayLengthPrefixed();
      } else if (type == 0) {
        value = r.readVarint();
      } else {
        throw new Error(`bad value type: ${type}`);
      }
      value = spec.decoder_(value);
      if (spec.repeated_) {
        (data[spec.key] = data[spec.key] || []).push(value);
      } else {
        data[spec.key] = value;
      }
    }
    return new this(PRIVATE, data);
  }

  static of(obj) {
    if (obj instanceof this) return obj;
    const data = {};
    for (const key in obj) {
      if (obj[key] == null) continue;
      const spec = this[SPEC].byName[key];
      if (!spec) throw new Error(`unknown field: ${key}`);
      let value = obj[key];
      if (spec.builder_) {
        if (spec.repeated_) {
          value = value.map(spec.builder_);
        } else {
          value = spec.builder_(value);
        }
      }
      data[key] = value;
    }
    for (const key in this[SPEC].byName) {
      if (this[SPEC].byName[key].required_ && !(key in data)) {
        throw new Error(`missing required field: ${key}`);
      }
    }
    return new this(PRIVATE, data);
  }

  static bytes(number) {
    return new Field(number * 8 + 2);
  }

  static uint32(number) {
    return new Field(number * 8);
  }

  // TODO(sdh): sint32?  varint w/ codec?
}
