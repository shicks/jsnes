// Defines a simple format based on a subset of Google Protocol Buffers.
// Only supports a very limited set of field types:
//  - repeated bytes
//  - singular bytes
//  - singular varint

// TODO - build in magicNumber (and verify that it would be invalid?)
//      - parse either way, provide hadMagicNumber accessor


import {BinaryReader, BinaryWriter} from './binary.js';
import {checkState} from './utils.js';

class Field {
  constructor(index) {
    this.index = index;
    this.key = null;
    this.decoder = (x) => x;
    this.messageType = null;
    this.isRequired = false;
    this.isRepeated = false;
    this.packedArrayType = Array; // default to packed when possible
    this.isPacked = false;        // only true on the packed version
  }

  repeated() {
    checkState(!this.isRequired, 'multiple number modifiers');
    this.isRepeated = true;
    return this;
  }

  required() {
    checkState(!this.isRepeated, 'multiple number modifiers');
    this.isRequired = true;
    return this;
  }

  message(ctorFn) {
    this.decoder = (x) => ctorFn().parse(x);
    this.messageType = ctorFn;
    return this;
  }

  array(typedArrayCtor) {
    this.decoder = (x) => new typedArrayCtor(x);
    return this;
  }

  packed(arrayType) { // false or null to disable packing during serialization
    this.packedArrayType = arrayType;
    return this;
  }
}

const makePacked = (field) => {
  const f = new Field(field.index | 2).repeated();
  f.key = field.key;
  f.isPacked = true;
  f.decoder = (x) => {
    const r = new BinaryReader(x);
    const out = [];
    while (!r.eof()) {
      out.push(r.readVarint());
    }
    return field.packedArrayType.from(out);
  };
  return f;
};

const SPEC = Symbol('SPEC');
const PRIVATE = Symbol('PRIVATE');
const FIELDS = Symbol('FIELDS');

export class Proto {
  constructor(priv, spec, fields) {
    checkState(priv === PRIVATE, 'private constructor');
    this[SPEC] = spec;
    this[FIELDS] = fields;
  }

  // Process the DSL and return the new proto's constructor.
  static message(messageName, spec) {
    const byName = {};
    const byNumber = [];
    const nested = {};
    for (const key in spec) {
      const field = spec[key];
      if (field instanceof Field) {
        field.key = key;
        byName[key] = field;
        checkState(!(field.index in byNumber),
                   `duplicate index: ${field.index >>> 3}`);
        byNumber[field.index] = field;
        if (field.isRepeated && !(field.index & 7)) {
          const packed = makePacked(field);
          byNumber[field.index | 2] = packed;
          if (field.packedArrayType) byName[key] = packed;
        }
      } else { // not actually a field
        nested[key] = field;
      }
    }
    const result = class extends Proto {
      constructor(priv, fields) {
        super(priv, byName, fields);
      }
    };
    result.prototype[Symbol.toStringTag] = messageName;

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
      if (!spec.isRepeated) {
        value = [value];
      }
      const type = spec.index & 7;
      if (spec.isPacked) {
        w.writeVarint(spec.index);
        const w2 = new BinaryWriter();
        for (let elem of value) {
          w2.writeVarint(elem);
        }
        w.writeArrayLengthPrefixed(w2.toArrayBuffer());
      } else {
        for (let elem of value) {
          w.writeVarint(spec.index);
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
    }
    return w.toArrayBuffer();
  }

  static parse(bytes, prefix = undefined) {
    const r = new BinaryReader(bytes);
    if (prefix) r.expectString(prefix);
    const data = {};
    while (!r.eof()) {
      const index = r.readVarint();
      const spec = this[SPEC].byNumber[index];
      checkState(spec, `unknown field number: ${index} at byte ${r.pos}`);
      const type = index & 7;
      let value;
      if (type == 2) {
        value = r.readArrayLengthPrefixed();
      } else if (type == 0) {
        value = r.readVarint();
      } else {
        throw new Error(`bad value type: ${type}`);
      }
      value = spec.decoder(value);
      if (spec.isRepeated && !spec.isPacked) {
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
      checkState(spec, `unknown field: ${key}`);
      let value = obj[key];
      if (spec.messageType) {
        if (spec.isRepeated) {
          value = value.map(x => spec.messageType().of(x));
        } else {
          value = spec.messageType().of(value);
        }
      }
      data[key] = value;
    }
    for (const key in this[SPEC].byName) {
      if (this[SPEC].byName[key].isRequired && !(key in data)) {
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

  /** Returns a valid proto2 string. Usage: `Proto.descriptor({Savestate})` */
  static descriptor(obj) {
    const addNames = (message, name, names) => {
      if (Reflect.getPrototypeOf(message) != Proto) return;
      names.set(message, name);
      for (const child in message) {
        addNames(message[child], `${name}.${child}`, names);
      }
    };

    const addDescriptor = (message, name, indent, lines, names) => {
      if (Reflect.getPrototypeOf(message) != Proto) return;
      lines.push('', `${indent}message ${name} {`);
      for (let field in message[SPEC].byName) {
        const spec = message[SPEC].byName[field];
        const line = [indent, ''];
        if (spec.isRequired) {
          line.push('required');
        } else if (spec.isRepeated) {
          line.push('repeated');
        } else {
          line.push('optional');
        }
        if ((spec.index & 7) == 0) {
          line.push('uint32');
        } else if (spec.messageType) {
          const fqn = names.get(message);
          let submessage = names.get(spec.messageType());
          if (submessage) {
            submessage = submessage.replace(
                new RegExp(`^${fqn.replace('.', '\\.')}\\.`), '');
          } else {
            submessage = 'bytes';
          }      
          line.push(submessage);
        } else {
          line.push('bytes');
        }
        field = field.replace(/([a-z0-9])([A-Z])/g,
                              (_, a, b) => `${a}_${b.toLowerCase()}`);
        line.push(field, '=', (spec.index >>> 3) + ';');
        lines.push(line.join(' '));
      }
      for (const child in message) {
        addDescriptor(message[child], child, indent + '  ', lines, names);
      }
      lines.push(`${indent}}`);
    };

    // Build a map of names.
    const names = new Map();
    for (const key in obj) {
      addNames(obj[key], key, names);
    }

    // Actually write out the file.
    const lines = ['syntax = "proto2";'];
    for (const key in obj) {
      addDescriptor(obj[key], key, '', lines, names);
    }
    return lines.join('\n');
  }
}

window.Proto = Proto;
