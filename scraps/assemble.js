import {opmeta} from './opmeta.js';

// Useful for patching ROMs.
class Assembler {
  constructor() {
    this.labels = {};
  }





}


class Patch extends Uint8Array {
  // input: chunks is an array of [offset, ...bytes] elements
  constructor(data) {
    super(data.length);
    this.set(data);
  }

  apply(data) {
    
  }

  toHexString() {

  }
}


// Input: an assembly string
// Output: a patch
export const assemble = (str) => {
  


};


assemble(`
.bank $3c000 $c000:$4000

.org $32040
Foo:
  .byte $05,$03,$23,$35
  .byte "foo bar"

.org $35a25
.bank $36000 $8000:$2000

  cmp #$00
  bcc a
a:
  lda #$0a

`);
