import {Battery} from './battery.js';
import {CPU} from './cpu.js';
import {Controller} from './controller.js';
import {PPU} from './ppu.js';
import {PAPU} from './papu.js';
import {ROM} from './rom.js';
import {Debug} from './debug.js';
import {BinaryReader, BinaryWriter} from './binary.js';
import {Savestate} from './wire.js';
import {Recorder, Playback} from './movie.js';

export class NES {
  constructor(opts) {
    this.opts = {
      onFrame: () => {},
      onAudioSample: null,
      onStatusUpdate: () => {},
      onBatteryRamWrite: () => {},
      onBreak: () => {},
      getScreenshot: () => null,

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
    this.romData = null;

    this.movie = null; // either a recorder or a playback
  }

  // Resets the system
  reset() {
    if (this.mmap) this.mmap.reset();

    this.cpu.reset();
    this.ppu.reset();
    this.papu.reset();

    this.lastFpsTime = null;
    this.fpsFrameCount = 0;
  }

  frame() {
    let cycles = 0;
    if (this.breakpointCycles != null) {
      cycles = this.breakpointCycles;
      this.breakpointCycles = null;
    } else {
      // Ensure we only update movie frames once per frame,
      // and not in response to during-rendering 
      if (this.movie instanceof Recorder) {
        this.movie.recordFrame();
      } else if (this.movie instanceof Playback) {
        this.movie.playbackFrame();
      }
      this.ppu.startFrame();
    }
    var emulateSound = this.opts.emulateSound;
    var cpu = this.cpu;
    var ppu = this.ppu;
    var papu = this.papu;
let buf=[];try{
    FRAMELOOP: for (;;) {
//13748
const pr=false;//this.ppu.frame == 13253 && this.ppu.scanline < 23 || this.ppu.frame==13252 || this.ppu.frame == 13251 && this.ppu.scanline > 250;
if(pr)buf.push(`${this.ppu.frame.toString(16)}: scanline ${this.ppu.scanline} curX ${this.ppu.curX} PC ${this.cpu.REG_PC.toString(16)}`);
      if (this.debug.break) {
if(pr)buf.push(`  break`);
        this.debug.break = false;
        this.breakpointCycles = cycles;
        this.opts.onBreak(true);
        return;
      }
      if (cpu.cyclesToHalt === 0) {
        // Execute a CPU instruction
        cycles = cpu.emulate();
if(pr)buf.push(`  execute => cycles ${cycles}`);
        if (emulateSound) {
          papu.clockFrameCounter(cycles);
        }
        cycles *= 3;
      } else {
if(pr)buf.push(`  halt ${cpu.cyclesToHalt}`);
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
if(pr)buf[buf.length-1] += ` => cycles ${cycles}`;
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

        if (ppu.nmiCounter) {
if(pr)buf.push(`requestEndFrame nmiCounter ${ppu.nmiCounter}`);
          if (--ppu.nmiCounter === 0) {
            ppu.startVBlank();
            // NOTE: we're dropping cycles on the floor here,
            // probably we should keep track of where we're at,
            // though breakpointCycles is not quite right since
            // it affects startFrame().
            break FRAMELOOP;
          }
        }

        if (++ppu.curX === 341) {
if(pr)buf.push(`endScanline ${ppu.scanline}`);
          ppu.endScanline();
          this.debug.logScanline(ppu.scanline, ppu.frame);
        }
      }
    }

// TODO - move to top
      // if (this.movie instanceof Recorder) {
      //   this.movie.recordFrame();
      // } else if (this.movie instanceof Playback) {
      //   this.movie.playbackFrame();
      // }


    if (this.debug.break) {
      this.debug.break = false;
      this.breakpointCycles = cycles;
      this.opts.onBreak(false);
    }
    this.fpsFrameCount++;
}finally{if(buf.length)console.log(buf.join('\n'));}
  }

  resetControllers() {
    // Useful for seeking to keyframes - does not notify the recorder.
    for (const controller in this.controllers) {
      for (let button = 0; button < 8; button++) {
        this.controllers[controller].buttonUp(button);
      }
    }
  }

  * buttonsPressed() {
    for (const controller in this.controllers) {
      for (let button = 0; button < 8; button++) {
        if (this.controllers[controller].isPressed(button)) {
          yield [controller, button];
        }
      }
    }
  }

  buttonDown(controller, button) {
    if (this.controllers[controller].buttonDown(button) &&
        this.movie instanceof Recorder) {
      this.movie.record({controller, button, pressed: true});
    }
  }

  buttonUp(controller, button) {
    if (this.controllers[controller].buttonUp(button) &&
        this.movie instanceof Recorder) {
      this.movie.record({controller, button, pressed: false});
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

  // SAVESTATE FORMAT
  // ----------------
  // Header: "NES-STA\x1a"
  // Data:   a table containing {cpu, ppu, mmap} state.
  writeSavestate() {
    const data = {
      cpu: this.cpu.writeSavestate(),
      ppu: this.ppu.writeSavestate(),
      mmap: this.mmap.writeSavestate(),
      screen: this.opts.getScreenshot(),
    };
    // TODO - what about this.romData?
    if (this.breakpointCycles != null) {
      data.partial = {breakpointCycles: this.breakpointCycles};
    }
    const savestate = Savestate.of(data).serialize('NES-STA\x1a');
    if (this.movie instanceof Recorder) this.movie.keyframe(savestate);
    return savestate;
  }

  restoreSavestate(buffer) {
    const savestate = Savestate.parse(buffer, 'NES-STA\x1a');
    this.cpu.restoreSavestate(savestate.cpu);
    this.ppu.restoreSavestate(savestate.ppu);
    this.mmap.restoreSavestate(savestate.mmap);
    this.breakpointCycles =
      savestate.partial && savestate.partial.breakpointCycles != null ?
        savestate.partial.breakpointCycles : null;
    this.papu.reset();
    // TODO - if paused, update the screen with the stored screenshot???
    // TODO - loadROM(this.romData) or s.romData?  reloadROM()?
  }
}
