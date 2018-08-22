import {Battery} from './battery.js';
import {CPU} from './cpu.js';
import {Controller} from './controller.js';
import {PPU} from './ppu.js';
import {PAPU} from './papu.js';
import {ROM} from './rom.js';
import {Debug} from './debug.js';
import {BinaryReader, BinaryWriter} from './binary.js';

export class NES {
  constructor(opts) {
    this.opts = {
      onFrame: function() {},
      onAudioSample: null,
      onStatusUpdate: function() {},
      onBatteryRamWrite: function() {},
      onBreak: () => {},

      // FIXME: not actually used except for in PAPU
      preferredFrameRate: 60,

      emulateSound: true,
      sampleRate: 44100 // Sound sample rate in hz
    };
    if (typeof opts !== "undefined") {
      var key;
      for (key in this.opts) {
        if (typeof opts[key] !== "undefined") {
          this.opts[key] = opts[key];
        }
      }
    }

    this.frameTime = 1000 / this.opts.preferredFrameRate;

    this.ui = {
      writeFrame: this.opts.onFrame,
      updateStatus: this.opts.onStatusUpdate
    };
    this.cpu = new CPU(this);
    this.ppu = new PPU(this);
    this.papu = new PAPU(this);
    this.battery = new Battery(this);
    this.mmap = null; // set in loadROM()
    this.controllers = {
      1: new Controller(),
      2: new Controller()
    };

    this.ui.updateStatus("Ready to load a ROM.");

    this.frame = this.frame.bind(this);
    this.buttonDown = this.buttonDown.bind(this);
    this.buttonUp = this.buttonUp.bind(this);
    this.zapperMove = this.zapperMove.bind(this);
    this.zapperFireDown = this.zapperFireDown.bind(this);
    this.zapperFireUp = this.zapperFireUp.bind(this);

    // for logging, etc
    this.debug = new Debug(this);
    this.breakpointCycles = null;

    this.fpsFrameCount = 0;
    this.frameCount = 0;
    this.romData = null;
  }

  // Resets the system
  reset() {
    if (this.mmap) this.mmap.reset();

    this.cpu.reset();
    this.ppu.reset();
    this.papu.reset();

    this.lastFpsTime = null;
    this.fpsFrameCount = 0;
    this.frameCount = 0;
  }

  frame() {
    var cycles = 0;
    if (this.breakpointCycles != null) {
      cycles = this.breakpointCycles;
      this.breakpointCycles = null;
    } else {
      this.ppu.startFrame();
    }
    var emulateSound = this.opts.emulateSound;
    var cpu = this.cpu;
    var ppu = this.ppu;
    var papu = this.papu;
    FRAMELOOP: for (;;) {
      if (this.debug.break) {
        this.debug.break = false;
        this.breakpointCycles = cycles;
        this.opts.onBreak(true);
        return;
      }
      if (cpu.cyclesToHalt === 0) {
        // Execute a CPU instruction
        cycles = cpu.emulate();
        if (emulateSound) {
          papu.clockFrameCounter(cycles);
        }
        cycles *= 3;
      } else {
        if (cpu.cyclesToHalt > 8) {
          cycles = 24;
          if (emulateSound) {
            papu.clockFrameCounter(8);
          }
          cpu.cyclesToHalt -= 8;
        } else {
          cycles = cpu.cyclesToHalt * 3;
          if (emulateSound) {
            papu.clockFrameCounter(cpu.cyclesToHalt);
          }
          cpu.cyclesToHalt = 0;
        }
      }

      for (; cycles > 0; cycles--) {
        if (
          ppu.curX === ppu.spr0HitX &&
          ppu.f_spVisibility === 1 &&
          ppu.scanline - 21 === ppu.spr0HitY
        ) {
          // Set sprite 0 hit flag:
          ppu.setSprite0Hit();
        }

        if (ppu.requestEndFrame) {
          ppu.nmiCounter--;
          if (ppu.nmiCounter === 0) {
            ppu.requestEndFrame = false;
            ppu.startVBlank();
            break FRAMELOOP;
          }
        }

        ppu.curX++;
        if (ppu.curX === 341) {
          ppu.curX = 0;
          ppu.endScanline();
          this.debug.logScanline(ppu.scanline, this.frameCount);
        }
      }
    }
    if (this.debug.break) {
      this.debug.break = false;
      this.breakpointCycles = cycles;
      this.opts.onBreak(false);
    }
    this.fpsFrameCount++;
    this.frameCount++;
    if (this.debug && this.debug.recording) {
      this.debug.recording.recordFrame();
      this.debug.recording.playbackFrame();
    }
  }

  buttonDown(controller, button) {
    if (this.controllers[controller].buttonDown(button) &&
        this.debug &&
        this.debug.recording) {
      this.debug.recording.record({controller, button, pressed: true});
    }
  }

  buttonUp(controller, button) {
    if (this.controllers[controller].buttonUp(button) &&
        this.debug &&
        this.debug.recording) {
      this.debug.recording.record({controller, button, pressed: false});
    }
  }

  zapperMove(x, y) {
    if (!this.mmap) return;
    this.mmap.zapperX = x;
    this.mmap.zapperY = y;
  }

  zapperFireDown() {
    if (!this.mmap) return;
    this.mmap.zapperFired = true;
  }

  zapperFireUp() {
    if (!this.mmap) return;
    this.mmap.zapperFired = false;
  }

  getFPS() {
    var now = +new Date();
    var fps = null;
    if (this.lastFpsTime) {
      fps = this.fpsFrameCount / ((now - this.lastFpsTime) / 1000);
    }
    this.fpsFrameCount = 0;
    this.lastFpsTime = now;
    return fps;
  }

  reloadROM() {
    if (this.romData !== null) {
      this.loadROM(this.romData);
    }
  }

  // Loads a ROM file into the CPU and PPU.
  // The ROM file is validated first.
  loadROM(data) {
    // Load ROM file:
    this.rom = new ROM(this);
    this.rom.load(data);

    this.reset();
    if (this.rom.batteryRam && this.battery) this.battery.load();
    this.mmap = this.rom.createMapper();
    this.mmap.loadROM();
    this.ppu.setMirroring(this.rom.getMirroringType());
    this.romData = data;
  }

  setFramerate(rate) {
    // NOTE: this doesn't seem to work
    this.opts.preferredFrameRate = rate;
    this.frameTime = 1000 / rate;
    // this.papu.setSampleRate(this.opts.sampleRate, false);
  }

  toJSON() {
    return {
      romData: this.romData,
      cpu: this.cpu.toJSON(),
      mmap: this.mmap.toJSON(),
      ppu: this.ppu.toJSON()
    };
  }

  fromJSON(s) {
    this.loadROM(s.romData);
    this.cpu.fromJSON(s.cpu);
    this.mmap.fromJSON(s.mmap);
    this.ppu.fromJSON(s.ppu);
  }

  saveSnapshot() {
    const w = new BinaryWriter();
    w.writeStringFixed('NES-STA\x1a');
    // don't actually store the ROM, though we'll get it somewhat
    // with the memory.  We should consider cleaning up how memory
    // mapping is done.
  }
}
