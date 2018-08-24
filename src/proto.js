// Defines a simple format based on Google protocol buffers.
// Does not implement 64-bit or deprecated grouping, though
// uint64 and sint64 may safely go up to int52.
// Proto instances are immutable.

import {BinaryReader, BinaryWriter} from './binary.js';

const IS_PROTO = Symbol('is_proto');
const FIELDS = Symbol('fields');
const EVALUATE = Symbol('evaluate');

const REQUIRED = 1;
const OPTIONAL = 2;
const REPEATED = 3;
const PACKED = 4;

const read = * (r) => {
  while (!r.eof()) {
    let index = r.readVarint();
    let type;
    if (index < 0x100000000) {
      type = index & 7;
      index >>>= 3;
    } else {
      type = index % 7;
      index = (index - type) / 8;
    }
    if (!type) {
      yield [index, r.readVarint()];
    } else {
      let len;
      if (type == 2) {
        len = r.readVarint();
      } else if (type == 5) {
        len = 4;
      } else {
        throw new Error(`Type not supported: ${type}`);
      }
      const a = new ArrayBuffer(len);
      r.readIntoArray(a);
      yield [index, a];
    }
  }
}


export class Proto {
  
  constructor(p, data) {
    if (p != IS_PROTO) throw new Error('Proto constructor is private');
    this.data = data;
  }


  serialize(prefix = undefined) {
    const w = new BinaryWriter();
    if (prefix) {
      if (typeof prefix != 'string') throw new Error('prefix must be a string');
      w.writeStringFixedLength(prefix);
    }
    for (const key in this[FIELDS]) {
      const info = fieldsByName[key];
      info.serialize(w, this[FIELDS][key]);
    }
  }

  // BASIC IDEA: foo.with({bar: 42, baz: (z) => z.push(newBaz), ...})
  // how to handle repeated fields?!?
  // with(updates) {
  //   this[FIELDS]();
  //   const data = {};
  //   for (const key in obj) {
  //     const info = fieldsByName[key];
  //     data[key] = info.of(obj[key]);
  //   }
  //   return new this(IS_PROTO, obj);
  // }

  static message(spec) {
    if (this != Proto) throw new Error('Proto.message is not inherited');
    const result = class extends Proto {
      constructor(p, data) {
        if (p != IS_PROTO) throw new Error('Proto constructor is private');
        result[EVALUATE]();
        this[FIELDS] = data;
      }
    };
    const fieldsByNumber = [];
    const fieldsByName = {};    
    for (const key in spec) {
      if (typeof key != 'function') { // fields retained as-is
        result[key] = spec[key];
        delete spec[key];
      }
    }
    result[EVALUATE] = () => {
      let key; // specifically bind to outside the loop
      const field = (quantity, type, number, jstype = undefined) {
        if (number in fieldsByNumber) throw new Error(`Duplicate index: ${number}`);
        const info = fieldInfo(key, quantity, type, number, jstype);
        fieldsByNumber[info.index] = info;
        fieldsByName[key] = info;
      };
      const target = Object.assign({
        required: (...args) => field(REQUIRED, ...args),
        optional: (...args) => field(OPTIONAL, ...args),
        repeated: (...args) => field(REPEATED, ...args),
      }, result);
      for (key in spec) {
        spec[key].call(result);
        result.prototype[key] = function() { return this[FIELDS][key]; };
      }
      result[EVALUATE] = () => {};
    };
    result[IS_PROTO] = true;
    return result;

  }
  static parse(bytes, prefix = undefined) {
    this[EVALUATE]();
    const r = new BinaryReader(bytes);
    if (prefix) {
      if (typeof prefix != 'string') throw new Error('prefix must be a string');
      r.expectString(prefix);
    }
    const data = {};
    for (const [index, value] of read(r)) {
      // NOTE: index includes storage bits
      const info = fieldsByNumber[index];
      info.parse(data, value);
    }
    return new this(IS_PROTO, data);
  }

  static of(obj) {
    this[EVALUATE]();
    const data = {};
    for (const key in obj) {
      const info = fieldsByName[key];
      if (!info) throw new Error(`Unknown field: ${key}`);
      data[key] = info.of(obj[key]);
    }
    for (const key in fieldsByName) {
      if (fieldsByName[key].required && !(key in obj)) {
        throw new Error(`Missing required field: ${key}`);
      }
    }
    return new this(IS_PROTO, obj);
  }
}

const primitives = {
  'uint32': {
    storage: 0,
    decode: (x) => x,
    encode: (x) => x,
  },
  'sint32': {
    storage: 0,
    decode: (x) => x & 1 ? ~(x >>> 1) : x >>> 1,
    encode: (x) => x < 0 ? ~x << 1 | 1 : x << 1,
  },
  'uint52': {
    storage: 0,
    decode: (x) => x,
    encode: (x) => x,
  },
  'sint52': {
    storage: 0,
    decode: (x) => x % 2 ? -(x + 1) / 2 : x / 2,
    encode: (x) => x < 0 ? -2 * x - 1 : 2 * x,
  },
  'bool': {
    storage: 0,
    decode: (x) => !!x,
    encode: (x) => x ? 1 : 0,
  },
  'string': {
    storage: 2,
    decode: (x) => UTF8_DECODER.decode(x),
    encode: (x) => UTF8_ENCODER.encode(x),
  },
};

const codex = (quantity, type, jstype) => {
  if (type == 'bytes') {
    if (!jstype || jstype == ArrayBuffer) {
      return {
        quantity,
        storage: 2,
        encode: (x) => x,
        decode: (x) => x,
      };
    }
    if (!validBytesConversions.has(jstype)) {
      throw new Error('Bad jstype');
    }
    return {
      quantity,
      storage: 2,
      encode: (x) => new jstype(x),
      decode: (x) => x.slice().buffer,
    };
  }
  if (jstype) throw new Error('jstype may only be specified for bytes');
  if (type[IS_PROTO]) {
    return {
      quantity,
      storage: 2,
      encode: (x) => x.serialize(),
      decode: (x) => type.parse(x),
      ctor: type,
    };
  }
  const prim = primitives[type]
  if (!prim) throw new Error(`Unknown type: ${type}`);
  if (!prim.storage && quantity == REPEATED) {
    return {
      quantity: PACKED,
      storage: 2,
      encode: (x) => {
        const w = new BinaryWriter();
        for (const elem of x) w.writeVarint(prim.encode(elem));
        return w.toArrayBuffer();
      },
      decode: (x) => {
        const r = new BinaryReader(x);
        const result = [];
        while (!r.eof()) {
          result.push(prim.decode(r.readVarint()));
        }
      },
    };
  }
  return Object.assign({quantity}, prim);
}

const validBytesConversions = new Set([
  ArrayBuffer, Uint8Array, Uint16Array, Uint32Array, Uint8ClampedArray,
  Float32Array, Float64Array, Int8Array, Int16Array, Int32Array,
]);

// returns obj w/ index, parse, serialize. of, required

const fieldInfo = (key, quantity, type, number, jstype) => {
  let c = codex(quantity, type, jstype);
  if (c.quantity == REPEATED) {
    return new RepeatedField(key, number, c);
  } else if (c.quantity == PACKED) {
    return new PackedField(key, number, c);
  } else if (c.storage == 2) {
    return new SingularField(key, number, c);
  } else {
    return new PrimitiveField(key, number, c);
  }
}

class RepeatedField {
  constructor(key, number, codex) {
    this.key = key;
    this.index = number * 8 + codex.storage;
    this.codex = codex;
    this.required = false;
  }
  parse(data, value) {
    (data[key] = data[key] || []).push(this.codex.decode(value));
  }
  of(data) {
    return this.codex.ctor ? data.map(x => this.codex.ctor.of(x)) : data;
  }
  serialize(w, values) {
    for (const value of values) {
      w.writeVarint(this.index);
      w.writeVarint(this.codex.encode(value));
    }
  }
}

class PackedField {
  constructor(key, number, codex) {
    this.key = key;
    this.index = number * 8 + codex.storage;
    this.codex = codex;
    this.required = false;
  }
  parse(data, value) {
    (data[key] = data[key] || []).push(this.codex.decode(value));
  }
  of(data) {
    return this.codex.ctor ? this.codex.ctor.of(data) : data;
  }
  serialize(w, values) {
    for (const value of values) {
      w.writeVarint(this.index);
      w.writeVarint(this.codex.encode(value));
    }
  }
}

const initialize = (message) => {
  


};

const Savestate = Proto.message({
  cpu()     { this.required(this.Cpu,     1); },
  ppu()     { this.required(this.Ppu,     2); },
  mmap()    { this.required(this.Mmap,    3); },
  partial() { this.optional(this.Partial, 4); },

  Cpu: Proto.message({
    ram()  { this.required('bytes',  1); },
    a()    { this.required('uint32', 2); },
    x()    { this.required('uint32', 3); },
    y()    { this.required('uint32', 4); },
    sp()   { this.required('uint32', 5); },
    f()    { this.required('uint32', 6); },
    irq()  { this.required('uint32', 7); },
    pc()   { this.required('uint32', 8); },
    halt() { this.required('uint32', 9); },
  }),

  Ppu: Proto.message({
    mem()     { this.required(this.Memory,    1); },
    reg()     { this.required(this.Registers, 2); },
    io()      { this.required(this.Io,        3); },
    meta()    { this.optional(this.Meta,      4); },
    partial() { this.optional(this.Partial,   5); },

    Memory: Proto.message({
      nametable0() { this.required('bytes', 1, Uint8Array); },
      nametable1() { this.required('bytes', 2, Uint8Array); },
      nametable2() { this.required('bytes', 3, Uint8Array); },
      nametable3() { this.required('bytes', 4, Uint8Array); },
      spriteRam()  { this.required('bytes', 5, Uint8Array); },
      paletteRam() { this.required('bytes', 6, Uint8Array); },
    }),

    Registers: Proto.message({
      v() { this.required('uint32', 1); },
      t() { this.required('uint32', 2); },
      w() { this.required('uint32', 3); },
      x() { this.required('uint32', 4); },
    }),

    Io: Proto.message({
      bufferedRead() { this.required('uint32', 1); },
      sramAddress()  { this.required('uint32', 2); },
      status()       { this.required('uint32', 3); },
      ppuCtrl()      { this.required('uint32', 4); },
      ppuMask()      { this.required('uint32', 5); },
      mirroring()    { this.required('uint32', 6); },
    }),

    Meta: Proto.message({
      frames() { this.optional('uint32'); },
    }),

    Partial: Proto.message({
      hitSprite0()              { this.required('uint32', 1); },
      spr0HitX()                { this.required('uint32', 2); },
      spr0HitY()                { this.required('uint32', 3); },
      curX()                    { this.required('uint32', 4); },
      scanline()                { this.required('uint32', 5); },
      lastRenderedScanline()    { this.required('uint32', 6); },
      requestEndFrame()         { this.required('uint32', 7); },
      dummyCycleToggle()        { this.required('uint32', 8); },
      nmuCounter()              { this.required('uint32', 9); },
      scanlineAlreadyRendered() { this.required('uint32', 10); },
      buffer()                  { this.required('bytes',  11, Uint8Array); },
      bgbuffer()                { this.required('bytes',  12, Uint8Array); },
      pixrendered()             { this.required('bytes',  13, Uint8Array); },
    }),
  }),
});

const Movie = Proto.message({
  chunk()  { this.repeated(this.Frame, 1); },
  frames() { this.optional('uint32',   2); },

  Chunk: Proto.message({
    snapshot()   { this.optional('bytes',  1); }
    // data are stored in a somewhat convoluted way for
    // maximal compression.
    data()       { this.required('bytes',  2); }
    // number of frames in this chunk.
    frames()     { this.optional('uint32', 3); }
  }),
});

// what happens when we explicitly snapshot in a recording?
//  - probably need to store the movie?
//  - quick navigation between snapshots...
//  - maybe just make a keyframe and then we can truncate if needed.
//  - "rerecord mode": left/right to go back/forth, starts paused
//     once unpause, truncate and continue
//  - "playback mode": left/right to go between, but not recording so no trunc
// so only special behavior if recording.  otherwise snapshot just stores it in
// a normal .sta file.




export class Proto {

  constructor(cls) {
    if (cls[LAZY_SPEC]) {
      const spec = cls[LAZY_SPEC]({
        header: HEADER,
        required: (type, num, jstype = undefined) => ['r', type, num, jstype],
        optional: (type, num, jstype = undefined) => ['o', type, num, jstype],
        repeated: (type, num, jstype = undefined) => ['x', type, num, jstype],
      });
      cls[LAZY_SPEC] = undefined;
      for (const key of spec) {
        if (key in Proto.prototype) throw new Error(`Bad field: ${key}`);
        
      }
    }
  }

  /** @return {!ArrayBuffer} */
  serialize() {
    
  }

  /** @param {!Object} update
      @return {THIS}
      @this {THIS}
      @template THIS */
  with(update) {

  }

  static message(spec) {
    // Makes a new message subclass.
    if (this != Proto) throw new Error('message should only be called on Proto');
    const cls = class extends Proto {
      constructor() {
        super(cls);
      }
    };
    cls[LAZY_SPEC] = spec;
  }

  static serialize(obj) {
    new this(

  }

  static parse(bytes) {
    const 
  }

  
}
const LAZY_SPEC = Symbol('LAZY_SPEC');
const IS_PROTO = Symbol('IS_PROTO');
const HEADER = Symbol('Proto.header');
Proto[IS_PROTO] = true;


export const Movie = Proto.message(({header, declare}) => {
  header('NES-MOV\x1a');
  declare(Movie.Record, 'record', 1).repeated().as(...);
});

export const Savestate = Proto.message(
  ({header, required, optional, int32, uint32, string, bytes}) => ({
    [header]: 'NES-STA\x1a',
    cpu: required(Savestate.Cpu, 1),
    ppu: required(Savestate.Ppu, 2),
    mmap: required(Savestate.Mmap, 3),
    partial: optional(Savestate.Partial, 4),
  }));



Savestate.of(

Savestate.parse(bytes);

Savestate.parseWith(bytes, {
  cpu: (cpu) => this.cpu.restore(cpu),
  partial: maybe(
    (...) => ...,
    (...) => ...),
});

export class Savestate extends Proto {
  constructor({header, required, varint}) {
    header('NES-STA\x1a');
    

    required(Savestate.Cpu, {cpu: 1});
    required(Savestate.Ppu, {ppu: 2});
    required(Savestate.Mmap, {mmap: 3});
    optional(Savestate.Partial, {partial: 4});

    cpu: required(SAVESTATE.CPU
        
      



  }



const UTF8_ENCODER = new TextEncoder('utf-8');
const UTF8_DECODER = new TextDecoder('utf-8');
