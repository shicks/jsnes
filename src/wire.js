import {Proto} from './proto.js';

export const Savestate = Proto.message({
  cpu:     Proto.bytes(1).required().message(() => Savestate.Cpu),
  ppu:     Proto.bytes(2).required().message(() => Savestate.Ppu),
  mmap:    Proto.bytes(3).required().message(() => Savestate.Mmap),
  partial: Proto.bytes(4)           .message(() => Savestate.Partial),

  Cpu: Proto.message({
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

  Ppu: Proto.message({
    mem:     Proto.bytes(1).required().message(() => Savestate.Ppu.Memory),
    reg:     Proto.bytes(2).required().message(() => Savestate.Ppu.Registers),
    io:      Proto.bytes(3).required().message(() => Savestate.Ppu.Io),
    meta:    Proto.bytes(4)           .message(() => Savestate.Ppu.Meta),
    partial: Proto.bytes(5)           .message(() => Savestate.Ppu.Partial),

    Memory: Proto.message({
      spriteRam:  Proto.bytes(1).required().array(Uint8Array),
      paletteRam: Proto.bytes(2).required().array(Uint8Array),
      nametable0: Proto.bytes(3)           .array(Uint8Array),
      nametable1: Proto.bytes(4)           .array(Uint8Array),
      nametable2: Proto.bytes(5)           .array(Uint8Array),
      nametable3: Proto.bytes(6)           .array(Uint8Array),
    }),

    Registers: Proto.message({
      v: Proto.uint32(1).required(),
      t: Proto.uint32(2).required(),
      w: Proto.uint32(3).required(),
      x: Proto.uint32(4).required(),
    }),

    Io: Proto.message({
      bufferedRead: Proto.uint32(1).required(),
      sramAddress:  Proto.uint32(2).required(),
      status:       Proto.uint32(3).required(),
      ppuCtrl:      Proto.uint32(4).required(),
      ppuMask:      Proto.uint32(5).required(),
      mirroring:    Proto.uint32(6).required(),
    }),

    Meta: Proto.message({
      frame:        Proto.uint32(1),
    }),

    Partial: Proto.message({
      hitSpr0:                 Proto.uint32(1) .required(),
      spr0HitX:                Proto.uint32(2) .required(),
      spr0HitY:                Proto.uint32(3) .required(),
      curX:                    Proto.uint32(4) .required(),
      scanline:                Proto.uint32(5) .required(),
      lastRenderedScanline:    Proto.uint32(6) .required(),
      requestEndFrame:         Proto.uint32(7) .required(),
      dummyCycleToggle:        Proto.uint32(8) .required(),
      nmiCounter:              Proto.uint32(9) .required(),
      scanlineAlreadyRendered: Proto.uint32(10).required(),
      buffer:                  Proto.bytes (11).required().array(Uint8Array),
      bgbuffer:                Proto.bytes (12).required().array(Uint8Array),
      pixrendered:             Proto.bytes (13).required().array(Uint8Array),
    }),
  }),

  Mmap: Proto.message({
    // MMAP carries joystick state
    joy1StrobeState: Proto.uint32(1).required(),
    joy2StrobeState: Proto.uint32(2).required(),
    joypadLastWrite: Proto.uint32(3).required(),
    // Cartridge RAM contents and ROM bank status
    prgRam:  Proto.bytes(4).array(Uint8Array),
    chrRam: Proto.bytes(5).array(Uint8Array),
    prgRom: Proto.bytes(6).array(Uint8Array),
    chrRom: Proto.bytes(7).array(Uint8Array),
    // Extended status for special mappers (could be an "any" bytes?)
    ext: Proto.bytes(8),
  }),

  Partial: Proto.message({
    breakpointCycles: Proto.uint32(1),
  }),

});

export const Movie = Proto.message({
  chunk:  Proto.bytes(1).repeated().message(() => Movie.Frame),
  frames: Proto.uint32(2),

  Chunk: Proto.message({
    snapshot: Proto.bytes(1),
    // data are stored in a somewhat convoluted way for
    // maximal compression.
    data:     Proto.bytes(2).required(),
    // number of frames in this chunk.
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

window.wire = {Savestate};
