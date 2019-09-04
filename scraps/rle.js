import {BinaryWriter, BinaryReader} from './binary.js';

// Simple run-length encoder.  Format is a sequence of frames.  Each frame
// begins with a varint that indicates the frame type (in the lower bits)
// and length (in the upper bits).  Frame type is one of
//   %00 - a quote
//   %01 - a run
//   %10 - aliases
// The upper bits indicate the number of varints the follow in the frame.
// Aliases are used conditionally for arrays with a small number of large
// elements repeated many times.  To determine this, we do an initial pass
// collecting unique elements and determining the savings.
export class RLE {
  // arr should be a typed array to read from.  Output will be an ArrayBuffer.
  // f should return a nonnegative integer.
  static encode(arr, f = x => x >>> 0) {
    const w = new BinaryWriter();
    // Evaluate building an alias table.
    let table = new Map();
    let back = [];
    let cost = 0;
    let last = -1;
    for (let i = 0; i < this.arr.length; i++) {
      const e = f(this.arr[i]);
      if (e < 0) throw new Error(`transformation returned negative: ${e}`);
      const len = Math.floor((31 - Math.clz32(e)) / 7) + 1;
      if (!table.has(e)) {
        table.set(e, table.size);
        back.push(e);
        cost += shortLen;
      } else if (last != e) {
        const shortLen = Math.floor((31 - Math.clz32(table.get(e))) / 7) + 1;
        cost += shortLen - len;
      }
      last = e;
    }
    cost += Math.floor((33 - Math.clz32(table.size)) / 7) + 1;
    if (cost >= 0) table = null;
    // Write the table.
    if (table) {
      w.writeVarint(table.size * 4 + 2);
      for (const e of back) {
        w.writeVarint(e);
      }
    }
    // Write out the data.
    let buf = [];
    let run = false;
    let same = 1;
    for (let i = 0; i < arr.length; i++) {
      let e = f(arr[i]);
      if (table) e = table.get(e);
      if (run) {
        if (e == buf[0]) {
          // continue the run
          buf.push(e);
        } else {
          // stop the run
          w.writeVarint(buf.length * 4 + 1);
          w.writeVarint(buf[0]);
          buf = [e];
          run = false;
          same = 1;
        }
      } else {
        buf.push(e);
        if (e == buf[buf.length - 2]) {
          if (++same > 3) {
            // start a new run
            if (buf.length != same) {
              w.writeVarint((buf.length - same) * 4);
              for (let j = 0; j < buf.length - same; j++) {
                w.writeVarint(buf[j]);
              }
              buf.splice(0, buf.length - same);
            }
            run = true;
          }
        } else {
          same = 1;
        }
      }
    }
    if (buf.length) {
      if (run) {
        w.writeVarint(buf.length * 4 + 1);
        w.writeVarint(buf[0]);
      } else {
        w.writeVarint(buf.length * 4 + 1);
        for (let j = 0; j < buf.length - same; j++) {
          w.writeVarint(buf[j]);
        }
      }
    }
    return w.toArrayBuffer();
  }

  static decode(
}
