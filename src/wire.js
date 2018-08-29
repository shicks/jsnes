import {Proto} from './proto.js';

export const Savestate = Proto.message('Savestate', {
  // State of the CPU object.
  cpu:     Proto.bytes(1).required().message(() => Savestate.Cpu),
  // State of the PPU object.
  ppu:     Proto.bytes(2).required().message(() => Savestate.Ppu),

  // TODO - consider adding observable PAPU state here, though there's
  // a heck of a lot of state and it's not clear what actually matters.
  // We'd need to go through, pull out module-local constants, unused
  // fields, etc, and then see what's left.
  // So far we haven't really run into a problems with just resetting
  // the PAPU on savestate restores, but in theory there's observable
  // state that could get messed up.

  // State of the mapper.
  mmap:    Proto.bytes(3).required().message(() => Savestate.Mmap),
  // Extra state required for saves during rendering (experimental).
  partial: Proto.bytes(4)           .message(() => Savestate.Partial),
  // Screenshot at the time of the snapshot, for easy navigation.
  screen:  Proto.bytes(5),

  Cpu: Proto.message('Cpu', {
    ram:  Proto.bytes (1).required(),
    a:    Proto.uint32(2).required(),
    x:    Proto.uint32(3).required(),
    y:    Proto.uint32(4).required(),
    sp:   Proto.uint32(5).required(),
    f:    Proto.uint32(6).required(),
    irq:  Proto.uint32(7).required(),
    pc:   Proto.uint32(8).required(),
    halt: Proto.uint32(9).required(),
  }),

  Ppu: Proto.message('Ppu', {
    mem:     Proto.bytes(1).required().message(() => Savestate.Ppu.Memory),
    reg:     Proto.bytes(2).required().message(() => Savestate.Ppu.Registers),
    io:      Proto.bytes(3).required().message(() => Savestate.Ppu.Io),
    timing:  Proto.bytes(4)           .message(() => Savestate.Ppu.Timing),
    partial: Proto.bytes(5)           .message(() => Savestate.Ppu.Partial),

    Memory: Proto.message('Memory', {
      spriteRam:  Proto.bytes(1).required().array(Uint8Array),
      paletteRam: Proto.bytes(2).required().array(Uint8Array),
      nametable0: Proto.bytes(3)           .array(Uint8Array),
      nametable1: Proto.bytes(4)           .array(Uint8Array),
      nametable2: Proto.bytes(5)           .array(Uint8Array),
      nametable3: Proto.bytes(6)           .array(Uint8Array),
    }),

    Registers: Proto.message('Registers', {
      v: Proto.uint32(1).required(),
      t: Proto.uint32(2).required(),
      w: Proto.uint32(3).required(),
      x: Proto.uint32(4).required(),
    }),

    Io: Proto.message('Io', {
      bufferedRead: Proto.uint32(1).required(),
      sramAddress:  Proto.uint32(2).required(),
      status:       Proto.uint32(3).required(),
      ppuCtrl:      Proto.uint32(4).required(),
      ppuMask:      Proto.uint32(5).required(),
      mirroring:    Proto.uint32(6).required(),
    }),

    Timing: Proto.message('Timing', {
      frame:        Proto.uint32(1).required(),
      scanline:     Proto.uint32(2),
      curX:         Proto.uint32(3).required(),
      nmiCounter:   Proto.uint32(4),
    }),

    Partial: Proto.message('Partial', {
      hitSpr0:                 Proto.uint32(1).required(),
      spr0HitX:                Proto.uint32(2).required(),
      spr0HitY:                Proto.uint32(3).required(),
      lastRenderedScanline:    Proto.uint32(4).required(),
      scanlineAlreadyRendered: Proto.uint32(5).required(),
      buffer:                  Proto.bytes (6).required().array(Uint8Array),
      bgbuffer:                Proto.bytes (7).required().array(Uint8Array),
      pixrendered:             Proto.bytes (8).required().array(Uint8Array),
    }),
  }),

  Mmap: Proto.message('Mmap', {
    // MMAP carries joystick state
    joy1StrobeState: Proto.uint32(1).required(),
    joy2StrobeState: Proto.uint32(2).required(),
    joypadLastWrite: Proto.uint32(3).required(),
    // Cartridge RAM contents and ROM bank status
    prgRam: Proto.bytes(4).array(Uint8Array),
    chrRam: Proto.bytes(5).array(Uint8Array),
    prgRom: Proto.bytes(6).array(Uint8Array),
    chrRom: Proto.bytes(7).array(Uint8Array),
    // Extended status for special mappers (could be an "any" bytes?)
    ext: Proto.bytes(8),
  }),

  Partial: Proto.message('Partial', {
    breakpointCycles: Proto.uint32(1),
  }),

});

export const Movie = Proto.message('Movie', {
  chunks: Proto.bytes(1).repeated().message(() => Movie.Chunk),
  frames: Proto.uint32(2),

  Chunk: Proto.message('Chunk', {
    snapshot: Proto.bytes(1),
    // Each element represents a single button press or release
    // and various bits within it represent the button, whether
    // it was pressed or released, and the number of frames since
    // the last input.  The bits are arranged in a slightly odd
    // way to maximize compression:
    //   xxxx ffff   ffff ffff   ffff ffff   cbbb pfff
    // where the 23 (noncontiguous) bits of 'f' are the number of
    // frames since the last input, 'c' is the controller index
    // (0 for ctrl 1, 1 for ctrl 2), 'b' is the button index, and
    // 'p' whether the button was pressed or released. 'x' is
    // used for rare events, like pressing 'reset', or saving a
    // snapshot (and thus advancing to a new keyframe with no
    // input).

    records:  Proto.uint32(2).repeated().packed(Uint32Array),
    // Number of frames in this chunk.
    frames:   Proto.uint32(3),
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

window.wire = {Savestate, Movie};