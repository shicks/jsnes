        function* compress(values) {
          let r0 = -1;
          let r1 = -1;
          let prev = -1;
          const iter = values[Symbol.iterator]();
          for (;;) {
            const {value, done} = iter.next();
            if (!done && r0 < 0) {
              r0 = value;
            } else if (!done && r1 < 0) {
              r1 = value;
            } else if (!done && value - prev == r1 - r0) {
              // continue the pattern
            } else {
              // breaks the pattern - yield the compressed version only if
              // we would elide at least 1 element, so there should be
              // 3 or 4 elements at least.  e.g. r0=4, r1=6, prev=8, v=9
              // is a no go.  r0=4, r1=5, prev=6, v=8 would go to 4..6 tho.
              if (prev == r1) {
                // definitely no elision, only output one element.
                if (r0 >= 0) yield r0.toString(16);
                r0 = r1;
                r1 = done ? -1 : value;
              } else if (r1 - r0 == 1) {
                // elide
                yield `${r0.toString(16)}..${prev.toString(16)}`;
                r0 = value;
                r1 = -1;
              } else if (r1 < 0 || prev + r0 == r1 << 1) {
                // no elision, since we only have 3 elts and need an increment.
                if (r0 >= 0) yield r0.toString(16);
                if (r1 >= 0) yield r1.toString(16);
                r0 = prev != r0 ? prev : -1;
                r1 = -1;
              } else {
                // elide with increment
                yield `${r0.toString(16)},${r1.toString(16)}..${prev.toString(16)}`;
                r0 = value;
                r1 = -1;
              }
            }
            prev = value;
            if (done) break;
          }
          if (r0 >= 0) yield r0.toString(16);
          if (r1 >= 0) yield r1.toString(16);
        }

const test = (expect, ...v) => {
  it(`should handle ${expect}`, () => {
    const got = [...compress(v)].join(' ');
    if (got != expect) throw new Error(`Expected ${expect} but got ${got}`);
  });
};

test('');
test('0', 0);
test('1', 1);
test('1 2', 1, 2);
test('0..2', 0, 1, 2);
test('1..3', 1, 2, 3);
test('1 2 4', 1, 2, 4);
test('1..4', 1, 2, 3, 4);
test('1 3 5', 1, 3, 5);
test('1 3..5', 1, 3, 4, 5);
test('1..3 5', 1, 2, 3, 5);
test('1..3 5..7', 1, 2, 3, 5, 6, 7);
test('1..3 5 7..9', 1, 2, 3, 5, 7, 8, 9);
test('2..4', 2, 3, 4);
test('2..4 6', 2, 3, 4, 6);
test('1,3..7', 1, 3, 5, 7);
test('1,3..9', 1, 3, 5, 7, 9);
test('1..4 6,8..c', 1, 2, 3, 4, 6, 8, 10, 12);
test('1..4 6,8..c d e,10..14', 1, 2, 3, 4, 6, 8, 10, 12, 13, 14, 16, 18, 20);
test('ff', 255);
