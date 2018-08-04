#!/usr/bin/env node

// disasm - simple disassembler
//
// Basic strategy is to use heavy interactive editor assistance.
// Initial disassembly is to all just .byte, but the idea is to
// highlight some bytes and turn them into code on the fly.
//
// Usage:
//   disasm dump < foo.nes > foo.asm
//   # The following pipe the entire file from stdin and stdout
//   disasm code 123 456
//   disasm data 123 456
//   disasm datatable 123 456
//   disasm label
//
// Format:
// ```
// Label:
//     $00000:           .byte $01,$02,$03,...
//     $00010:           .byte $12,$42,$4f,...
// Routine:  ; =$8100
//  %a $00100  A9 00:    lda #$00
//     $00102  85 2E:    sta $2E
//     $00104  C0 FB:    bne -%a
// ```
//
// Defines are also allowed:
// ```
// define Inventory         $6430
// define Inventory_Swords  $6430
// define Inventory_Armors  $6434
// ; ...
//     $00312  A9 30:    lda #<Inventory
//     $00314  85 10:    sta $10
//     $00316  A9 64:    lda #>Inventory
//     $00318  85 11:    sta $11
//     $0031a  b1 10:    lda ($10),y
// ```

require = require('esm')(module);

const {NES} = require("./nes.js");

async function main(node, jsbin, directive, ...args) {
  switch (directive) {
  case 'dump': return await doDump(...args);
  case 'code': return await doCode(...args);
  case 'data': return await doData(...args);
  case 'label': return await doLabel(...args);
  default:
    console.error(`Bad directive: ${directive}.
Usage: disasm <directive> [args...]`);
    process.exit(2);
  }
}

async function doDump(...unexpected) {
  if (unexpected.length > 0) {
    console.error(`Unexpected arguments to 'disasm dump'`);
    process.exit(2);
  }
  // Read the file, drop the first 16 bytes, spit out a simple file.
  const data = await new Promise((resolve) => {
    const data = [];
    process.stdin.on('readable', () => {
      const chunk = process.stdin.read();
      if (chunk !== null) {
        for (const byte of chunk) {
          data.push(byte);
        }
      }
    });
    process.stdin.on('end', () => {
      resolve(data.slice(16)); // chop off the header, don't care about mappers.
    });
  });

  for (let i = 0; i < data.length; i += 16) {
    const line = [`        $${i.toString(16).padStart(5, 0)}              .byte`];
    for (let j = 0; j < 16; j++) {
      line.push(j ? ',$' : ' $', data[i + j].toString(16).padStart(2, 0));
    }
    console.log(line.join(''));
  }
}

async function doCode() {}
async function doData() {}
async function doLabel() {}

// Represents the entire assembly file.
// This is a CST - comments are preserved.
class Assembly {
  constructor() {
    this.contents = [];
  }

  toString() {
    const buffer = [];
    for (const content of this.contents) {
      content.appendTo(buffer);
    }
    return buffer.join('');
  }
}

class Content {
  constructor(position, text = undefined) {
    this.position = position;
    this.text = text;
  }
  appendTo(buffer) {
    if (this.text == undefined) {
      throw new Error('must override');
    }
    buffer.push(this.text);
    return buffer;
  }
}

class Composite extends Content {
  constructor(contents) {
    super(contents[0].position);
    this.contents = contents;
  }
  appendTo(buffer) {
    for (const content of contents) {
      content.appendTo(buffer);
    }
    return buffer;
  }
  find(ctor, ifNotFound = REQUIRED) {
    for (const content of contents) {
      if (content instanceof ctor) return content;
    }
    if (ifNotFound !== REQUIRED) {
      return ifNotFound;
    }
    throw new Error(ctor + ' not found in ' + this.appendTo([]).join(''));
  }
}

class Whitespace extends Content {}

class Comment extends Content {}

class RomAddress extends Content {}

class ByteCode extends Content {}

class Punctuation extends Content {}

class Identifier extends Content {}

class Value extends Content {}

class HexValue extends Value {}       // $123c

class DecimalValue extends Value {}   // 127

class NamedValue extends Value {}     // Identifier

class ValuePart extends Value {       // Abstract base for <foo and >foo
  constructor(position, punctuation, value) {
    super(position);
    this.punctuation = punctuation;
    this.value = value;
  }
  appendTo(buffer) {
    buffer.push(this.punctuation);
    return this.value.appendTo(buffer);
  }
}

class LowByte extends ValuePart {}     // "<", Value

class HighByte extends Value {}        // ">", Value

class Mnemonic extends Content {}      // e.g. "jsr"

class Argument extends Composite {
  value() {
    return this.find(Value);
  }
}

class ZeroPage extends Argument {}    // $10

class Relative extends Argument {}    // $1000 or $10 or label

class Absolute extends Argument {}    // $1000 or label

class Immediate extends Argument {}   // #$10 or #12 or #<name

class ZeroPageX extends Argument {}   // $10,x

class ZeroPageY extends Argument {}   // $10,y

class AbsoluteX extends Argument {}   // $1000,x

class AbsoluteY extends Argument {}   // $1000,y

class Preindexed extends Argument {}  // ($10,x)

class Postindexed extends Argument {} // ($10),y

class IndirectAbsolute extends Argument {} // ($1000)

class Instruction extends Composite {
  mnemonic() {
    return this.find(Mnemonic);
  }
  argument() {
    // TODO -- ...
  }
}


const REQUIRED = {};

class Define extends Composite {
  name() {
    return this.find(Identifier);
  }
  value() {
    return this.find(Value);
  }
}

class Bytes extends Composite {
  bytes() {
    // ...?
    return this.findAll(Value);
  }
  split(i) {
    // remove everything after the ith value?!?
  }
}

main(...process.argv);
