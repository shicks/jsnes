import {Proto} from './proto.js';

export const Savestate = Proto.message('Savestate', {
  // State of the CPU object.
  cpu:     Proto.bytes(1).required().message(() => Savestate.Cpu),
  // State of the PPU object.
  ppu:     Proto.bytes(2).required().message(() => Savestate.Ppu),
  // State of the PAPU object.
  papu:    Proto.bytes(6).required().message(() => Savestate.Papu),
  // State of the mapper.
  mmap:    Proto.bytes(3).required().message(() => Savestate.Mmap),
  // Extra state required for saves during rendering (experimental).
  partial: Proto.bytes(4)           .message(() => Savestate.Partial),
  // Screenshot at the time of the snapshot, for easy navigation.
  screen:  Proto.bytes(5),

  Cpu: Proto.message('Savestate.Cpu', {
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

  Ppu: Proto.message('Savestate.Ppu', {
    mem:     Proto.bytes(1).required().message(() => Savestate.Ppu.Memory),
    reg:     Proto.bytes(2).required().message(() => Savestate.Ppu.Registers),
    io:      Proto.bytes(3).required().message(() => Savestate.Ppu.Io),
    timing:  Proto.bytes(4)           .message(() => Savestate.Ppu.Timing),
    partial: Proto.bytes(5)           .message(() => Savestate.Ppu.Partial),

    Memory: Proto.message('Savestate.Ppu.Memory', {
      spriteRam:  Proto.bytes(1).required().array(Uint8Array),
      paletteRam: Proto.bytes(2).required().array(Uint8Array),
      nametable0: Proto.bytes(3)           .array(Uint8Array),
      nametable1: Proto.bytes(4)           .array(Uint8Array),
      nametable2: Proto.bytes(5)           .array(Uint8Array),
      nametable3: Proto.bytes(6)           .array(Uint8Array),
    }),

    Registers: Proto.message('Savestate.Ppu.Registers', {
      v: Proto.uint32(1).required(),
      t: Proto.uint32(2).required(),
      w: Proto.uint32(3).required(),
      x: Proto.uint32(4).required(),
    }),

    Io: Proto.message('Savestate.Ppu.Io', {
      bufferedRead: Proto.uint32(1).required(),
      sramAddress:  Proto.uint32(2).required(),
      status:       Proto.uint32(3).required(),
      ppuCtrl:      Proto.uint32(4).required(),
      ppuMask:      Proto.uint32(5).required(),
      mirroring:    Proto.uint32(6).required(),
    }),

    Timing: Proto.message('Savestate.Ppu.Timing', {
      frame:        Proto.uint32(1).required(),
      scanline:     Proto.uint32(2),
      curX:         Proto.uint32(3).required(),
      nmiCounter:   Proto.uint32(4),
    }),

    Partial: Proto.message('Savestate.Ppu.Partial', {
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

  Papu: Proto.message('Savestate.Papu', {
    square1:    Proto.bytes(1).required().message(() => Savestate.Papu.Square),
    square2:    Proto.bytes(2).required().message(() => Savestate.Papu.Square),
    triangle:   Proto.bytes(3).required().message(() => Savestate.Papu.Triangle),
    noise:      Proto.bytes(4).required().message(() => Savestate.Papu.Noise),
    dmc:        Proto.bytes(5).required().message(() => Savestate.Papu.Dmc),
    state:      Proto.bytes(6).required().message(() => Savestate.Papu.State),

    // Shared across square, triangle, and noise
    BaseChannel: Proto.message('Savestate.Papu.BaseChannel', {
      isEnabled:           Proto.uint32(1).required(),
      lengthCounter:       Proto.uint32(2).required(),
      lengthCounterEnable: Proto.uint32(3).required(),
      progTimerMax:        Proto.uint32(4).required(),
    }),

    // Shared across square and noise
    EnvChannel: Proto.message('Savestate.Papu.EnvChannel', {
      envDecayDisable:     Proto.uint32(1).required(),
      envDecayLoopEnable:  Proto.uint32(2).required(),
      envDecayRate:        Proto.uint32(3).required(),
    }),

    Square: Proto.message('Savestate.Papu.Square', {
      base:              Proto.bytes(1).required()
                             .message(() => Savestate.Papu.BaseChannel),
      env:               Proto.bytes(2).required()
                             .message(() => Savestate.Papu.EnvChannel),
      sweepActive:       Proto.uint32(3).required(),
      sweepCounterMax:   Proto.uint32(4).required(),
      sweepMode:         Proto.uint32(5).required(),
      sweepShiftAmount:  Proto.uint32(6).required(),
      dutyMode:          Proto.uint32(7).required(),
    }),

    Triangle: Proto.message('Savestate.Papu.Triangle', {
      base:            Proto.bytes(1).required()
                           .message(() => Savestate.Papu.BaseChannel),
      lcHalt:          Proto.uint32(2).required(),
      lcLoadValue:     Proto.uint32(3).required(),
    }),

    Noise: Proto.message('Savestate.Papu.Noise', {
      base:          Proto.bytes(1).required()
                         .message(() => Savestate.Papu.BaseChannel),
      env:           Proto.bytes(2).required()
                         .message(() => Savestate.Papu.EnvChannel),
      randomMode:    Proto.uint32(3).required(),
    }),

    Dmc: Proto.message('Savestate.Papu.Dmc', {
      isEnabled:         Proto.uint32(1).required(),
      irqGenerated:      Proto.uint32(2).required(),
      playMode:          Proto.uint32(3).required(),
      dmaFrequency:      Proto.uint32(4).required(),
      dmaCounter:        Proto.uint32(5).required(),
      playStartAddress:  Proto.uint32(6).required(),
      playAddress:       Proto.uint32(7).required(),
      playLength:        Proto.uint32(8).required(),
      playLengthCounter: Proto.uint32(9).required(),
      shiftCounter:      Proto.uint32(10).required(),
      // TODO - check to make sure we haven't broken audio
      // then integrate with NES.savestate
    }),

    State: Proto.message('Savestate.Papu.State', {
      frameIrqCounterMax:  Proto.uint32(1).required(),
      frameIrqEnabled:     Proto.uint32(2).required(),
      frameIrqActive:      Proto.uint32(3).required(),
      initingHardware:     Proto.uint32(4).required(),
      initCounter:         Proto.uint32(5).required(),
      masterFrameCounter:  Proto.uint32(6).required(),
      derivedFrameCounter: Proto.uint32(7).required(),
      countSequence:       Proto.uint32(8).required(),
      sampleTimer:         Proto.uint32(9).required(),
      extraCycles:         Proto.uint32(10).required(),
    }),
  }),

  Mmap: Proto.message('Savestate.Mmap', {
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

  Partial: Proto.message('Savestate.Partial', {
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
