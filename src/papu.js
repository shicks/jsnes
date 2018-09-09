import {seq} from './utils.js';
import {Savestate} from './wire.js';

var CPU_FREQ_NTSC = 1789772.5; //1789772.72727272d;
// var CPU_FREQ_PAL = 1773447.4;

export class PAPU {
  constructor(nes) {
    this.nes = nes;
    this.soundEnabled = true; // whether to actually calculate samples

    this.square1 = null;
    this.square2 = null;
    this.triangle = null;
    this.noise = null;
    this.dmc = null;

    this.frameIrqCounterMax = 4;
    this.frameIrqEnabled = false;
    this.frameIrqActive = null;
    this.initingHardware = false;
    this.initCounter = 2048;

    this.masterFrameCounter = null;
    this.derivedFrameCounter = null;
    this.countSequence = null;
    this.sampleTimer = null;

    this.accCount = null;
    this.extraCycles = null;

    // TODO - everything below here is transient???

    this.smpSquare1 = null;
    this.smpSquare2 = null;
    this.smpTriangle = null;
    this.smpDmc = null;

    this.frameTime = null;
    this.sampleTimerMax = null;

    // DC removal vars:
    this.prevSampleL = 0;
    this.prevSampleR = 0;
    this.smpAccumL = 0;
    this.smpAccumR = 0;

    this.maxSample = null;
    this.minSample = null;

    // Master volume:
    this.masterVolume = 256;

    // Panning, stereo positioning:
    this.stereoPosLSquare1 = null;
    this.stereoPosLSquare2 = null;
    this.stereoPosLTriangle = null;
    this.stereoPosLNoise = null;
    this.stereoPosLDMC = null;
    this.stereoPosRSquare1 = null;
    this.stereoPosRSquare2 = null;
    this.stereoPosRTriangle = null;
    this.stereoPosRNoise = null;
    this.stereoPosRDMC = null;
    this.panning = [80, 170, 100, 150, 128];
    this.setPanning(this.panning);

    this.reset();
  }

  reset() {
    const sampleRate = this.nes.opts.sampleRate || DEFAULT_SAMPLE_RATE;
    const frameRate = this.nes.opts.preferredFrameRate;
    this.sampleTimerMax =
        Math.floor(1024.0 * CPU_FREQ_NTSC * frameRate / (sampleRate * 60.0));
    this.frameTime = Math.floor(14915.0 * frameRate / 60.0);

    this.square1 = new ChannelSquare(this, true);
    this.square2 = new ChannelSquare(this, false);
    this.triangle = new ChannelTriangle(this);
    this.noise = new ChannelNoise(this);
    this.dmc = new ChannelDM(this);

    // Init sound registers:
    for (var i = 0; i < 0x14; i++) {
      if (i === 0x10) {
        this.writeReg(0x4010, 0x10);
      } else {
        this.writeReg(0x4000 + i, 0);
      }
    }

    this.sampleTimer = 0;

    this.updateChannelEnable(0);
    this.masterFrameCounter = 0;
    this.derivedFrameCounter = 0;
    this.countSequence = 0;
    this.initCounter = 2048;
    this.initingHardware = false;

    this.resetCounter();

    this.accCount = 0;
    this.smpSquare1 = 0;
    this.smpSquare2 = 0;
    this.smpTriangle = 0;
    this.smpDmc = 0;

    this.frameIrqEnabled = false;
    this.frameIrqCounterMax = 4;

    this.prevSampleL = 0;
    this.prevSampleR = 0;
    this.smpAccumL = 0;
    this.smpAccumR = 0;

    this.maxSample = -500000;
    this.minSample = 500000;
  }

  writeSavestate() {
    const writeBase = (c) => ({
      isEnabled:           c.isEnabled,
      lengthCounter:       c.lengthCounter,
      lengthCounterEnable: c.lengthCounterEnable,
      progTimerMax:        c.progTimerMax,
    });
    const writeEnv = (c) => ({
      envDecayDisable:    c.envDecayDisable,
      envDecayLoopEnable: c.envDecayLoopEnable,
      envDecayRate:       c.envDecayRate,
    });
    const writeSquare = (c) => ({
      base:             writeBase(c),
      env:              writeEnv(c),
      sweepActive:      c.sweepActive,
      sweepCounterMax:  c.sweepCounterMax,
      sweepMode:        c.sweepMode,
      sweepShiftAmount: c.sweepShiftAmount,
      dutyMode:         c.dutyMode,
    });
    const writeTriangle = (c) => ({
      base:        writeBase(c),
      lcHalt:      c.lcHalt,
      lcLoadValue: c.lcLoadValue,
    });
    const writeNoise = (c) => ({
      base:       writeBase(c),
      env:        writeEnv(c),
      randomMode: c.randomMode,
    });
    const writeDmc = (c) => ({
      isEnabled:         c.isEnabled,
      irqGenerated:      c.irqGenerated,
      playMode:          c.playMode,
      dmaFrequency:      c.dmaFrequency,
      dmaCounter:        c.dmaCounter,
      playStartAddress:  c.playStartAddress,
      playAddress:       c.playAddress,
      playLength:        c.playLength,
      playLengthCounter: c.playLengthCounter,
      shiftCounter:      c.shiftCounter,
    });
    return Savestate.Papu.of({
      square1:  writeSquare(this.square1),
      square2:  writeSquare(this.square2),
      triangle: writeTriangle(this.triangle),
      noise:    writeNoise(this.noise),
      dmc:      writeDmc(this.dmc),
      state: {
        frameIrqCounterMax: this.frameIrqCounterMax,
        frameIrqEnabled: this.frameIrqEnabled,
        frameIrqActive: this.frameIrqActive,
        initingHardware: this.initingHardware,
        initCounter: this.initCounter,
        masterFrameCounter: this.masterFrameCounter,
        derivedFrameCounter: this.derivedFrameCounter,
        countSequence: this.countSequence,
        sampleTimer: this.sampleTimer,
        extraCycles: this.extraCycles,
      },
    });
  }

  restoreSavestate(papu) {
    const restoreBase = (c, b) => {
      c.isEnabled           = b.isEnabled;
      c.lengthCounter       = b.lengthCounter;
      c.lengthCounterEnable = b.lengthCounterEnable;
      c.progTimerMax        = b.progTimerMax;
    };
    const restoreEnv = (c, b) => {
      c.envDecayDisable    = b.envDecayDisable;
      c.envDecayLoopEnable = b.envDecayLoopEnable;
      c.envDecayRate       = b.envDecayRate;
      if (c.envDecayDisable) c.channelVolume = c.envDecayRate;
    };
    const restoreSquare = (c, b) => {
      restoreBase(c, b);
      restoreEnv(c, b);
      c.sweepActive      = b.sweepActive;
      c.sweepCounterMax  = b.sweepCounterMax;
      c.sweepMode        = b.sweepMode;
      c.sweepShiftAmount = b.sweepShiftAmount;
      c.dutyMode         = b.dutyMode;
    };
    const restoreTriangle = (c, b) => {
      restoreBase(c, b);
      c.lcHalt      = b.lcHalt;
      c.lcLoadValue = b.lcLoadValue;
    };
    const restoreNoise = (c, b) => {
      restoreBase(c, b);
      restoreEnv(c, b);
      c.randomMode = b.randomMode;
    };
    const restoreDmc = (c, b) => {
      c.isEnabled         = b.isEnabled;
      c.irqGenerated      = b.irqGenerated;
      c.playMode          = b.playMode;
      c.dmaFrequency      = b.dmaFrequency;
      c.dmaCounter        = b.dmaCounter;
      c.playStartAddress  = b.playStartAddress;
      c.playAddress       = b.playAddress;
      c.playLength        = b.playLength;
      c.playLengthCounter = b.playLengthCounter;
      c.shiftCounter      = b.shiftCounter;
    };
    restoreSquare(this.square1, papu.square1);
    restoreSquare(this.square2, papu.square2);
    restoreTriangle(this.triangle, papu.triangle);
    restoreNoise(this.noise, papu.noise);
    restoreDmc(this.dmc, papu.dmc);
    this.frameIrqActive = papu.state.frameIrqActive;
    this.frameIrqEnabled = papu.state.frameIrqEnabled;
    this.frameIrqActive = papu.state.frameIrqActive;
    this.initingHardware = papu.state.initingHardware;
    this.initCounter = papu.state.initCounter;
    this.masterFrameCounter = papu.state.masterFrameCounter;
    this.derivedFrameCounter = papu.state.derivedFrameCounter;
    this.countSequence = papu.state.countSequence;
    this.sampleTimer = papu.state.sampleTimer;
    this.extraCycles = papu.state.extraCycles;
  }

  // eslint-disable-next-line no-unused-vars
  readStatus() {
    // Read 0x4015:
    var tmp = 0;
    tmp |= this.square1.getLengthStatus();
    tmp |= this.square2.getLengthStatus() << 1;
    tmp |= this.triangle.getLengthStatus() << 2;
    tmp |= this.noise.getLengthStatus() << 3;
    tmp |= this.dmc.getLengthStatus() << 4;
    tmp |= (this.frameIrqActive && this.frameIrqEnabled ? 1 : 0) << 6;
    tmp |= this.dmc.getIrqStatus() << 7;

    this.frameIrqActive = false;
    this.dmc.irqGenerated = false;

    return tmp & 0xff;
  }

  writeReg(address, value) {
    const group = address & 0x401c;
    if (group < 0x400c) {
      if (group == 0x4000) {
        // Square Wave 1 Control
        this.square1.writeReg(address, value);
        // console.log("Square Write");
      } else if (group == 0x4004) {
        // Square 2 Control
        this.square2.writeReg(address, value);
      } else { // if (group == 0x4008) {
        // Triangle Control
        this.triangle.writeReg(address, value);
      }
    } else if (group < 0x4014) {
      if (group == 0x400c) {
        // Noise Control
        this.noise.writeReg(address, value);
      } else { // if (group == 0x4010) {
        this.dmc.writeReg(address, value);
      }
    } else if (address === 0x4015) {
      // Channel enable
      this.updateChannelEnable(value);

      if (value !== 0 && this.initCounter > 0) {
        // Start hardware initialization
        this.initingHardware = true;
      }

      // DMC/IRQ Status
      this.dmc.writeReg(address, value);
    } else if (address === 0x4017) {
      // Frame counter control
      this.countSequence = (value >> 7) & 1;
      this.masterFrameCounter = 0;
      this.frameIrqActive = false;

      if (((value >> 6) & 0x1) === 0) {
        this.frameIrqEnabled = true;
      } else {
        this.frameIrqEnabled = false;
      }

      if (!this.countSequence) {
        // NTSC:
        this.frameIrqCounterMax = 4;
        this.derivedFrameCounter = 4;
      } else {
        // PAL:
        this.frameIrqCounterMax = 5;
        this.derivedFrameCounter = 0;
        this.frameCounterTick();
      }
    }
  }

  resetCounter() {
    if (!this.countSequence) {
      this.derivedFrameCounter = 4;
    } else {
      this.derivedFrameCounter = 0;
    }
  }

  // Updates channel enable status.
  // This is done on writes to the
  // channel enable register (0x4015),
  // and when the user enables/disables channels
  // in the GUI.
  updateChannelEnable(value) {
    this.square1.setEnabled((value & 1) !== 0);
    this.square2.setEnabled((value & 2) !== 0);
    this.triangle.setEnabled((value & 4) !== 0);
    this.noise.setEnabled((value & 8) !== 0);
    this.dmc.setEnabled((value & 16) !== 0);
  }

  // Clocks the frame counter. It should be clocked at
  // twice the cpu speed, so the cycles will be
  // divided by 2 for those counters that are
  // clocked at cpu speed.
  clockFrameCounter(nCycles) {
    if (this.initCounter > 0 && this.initingHardware) {
      this.initCounter -= nCycles;
      if (this.initCounter <= 0) {
        this.initingHardware = false;
        this.initCounter = 0;
      }
      return;
    }

    // Don't process ticks beyond next sampling:
    nCycles += this.extraCycles;
    var maxCycles = this.sampleTimerMax - this.sampleTimer;
    if (nCycles << 10 > maxCycles) {
      this.extraCycles = ((nCycles << 10) - maxCycles) >> 10;
      nCycles -= this.extraCycles;
    } else {
      this.extraCycles = 0;
    }

    var dmc = this.dmc;

    // Clock DMC:
    if (dmc.isEnabled) {
      dmc.shiftCounter -= nCycles << 3;
      while (dmc.shiftCounter <= 0 && dmc.dmaFrequency > 0) {
        dmc.shiftCounter += dmc.dmaFrequency;
        dmc.clockDmc();
      }
    }

    // Do the "fast version" if no sound
    if (!this.soundEnabled) {
      if (this.frameIrqEnabled && this.frameIrqActive) {
        this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NORMAL);
      }

      // Clock frame counter at double CPU speed:
      this.masterFrameCounter += nCycles << 1;
      if (this.masterFrameCounter >= this.frameTime) {
        // 240Hz tick:
        this.masterFrameCounter -= this.frameTime;
        this.frameCounterTick();
      }

      // Clock sample timer:
      this.sampleTimer += nCycles << 10;
      if (this.sampleTimer >= this.sampleTimerMax) {
        // Sample channels:
        this.sampleTimer -= this.sampleTimerMax;
      }
      return;
    }

    var triangle = this.triangle;
    var square1 = this.square1;
    var square2 = this.square2;
    var noise = this.noise;

    // Clock Triangle channel Prog timer:
    if (triangle.progTimerMax > 0) {
      triangle.progTimerCount -= nCycles;
      while (triangle.progTimerCount <= 0) {
        triangle.progTimerCount += triangle.progTimerMax + 1;
        if (triangle.linearCounter > 0 && triangle.lengthCounter > 0) {
          triangle.triangleCounter++;
          triangle.triangleCounter &= 0x1f;

          if (triangle.isEnabled && this.soundEnabled) {
            if (triangle.triangleCounter >= 0x10) {
              // Normal value.
              triangle.sampleValue = triangle.triangleCounter & 0xf;
            } else {
              // Inverted value.
              triangle.sampleValue = 0xf - (triangle.triangleCounter & 0xf);
            }
            triangle.sampleValue <<= 4;
          }
        }
      }
    }

    // Clock Square channel 1 Prog timer:
    square1.progTimerCount -= nCycles;
    if (square1.progTimerCount <= 0) {
      square1.progTimerCount += (square1.progTimerMax + 1) << 1;

      square1.squareCounter++;
      square1.squareCounter &= 0x7;
      square1.updateSampleValue();
    }

    // Clock Square channel 2 Prog timer:
    square2.progTimerCount -= nCycles;
    if (square2.progTimerCount <= 0) {
      square2.progTimerCount += (square2.progTimerMax + 1) << 1;

      square2.squareCounter++;
      square2.squareCounter &= 0x7;
      square2.updateSampleValue();
    }

    // Clock noise channel Prog timer:
    var acc_c = nCycles;
    if (noise.progTimerCount - acc_c > 0) {
      // Do all cycles at once:
      noise.progTimerCount -= acc_c;
      noise.noiseAccCount += acc_c;
      noise.noiseAccValue += acc_c * noise.sampleValue;
    } else {
      // Slow-step:
      while (acc_c-- > 0) {
        if (--noise.progTimerCount <= 0 && noise.progTimerMax > 0) {
          // Update noise shift register:
          noise.shiftReg <<= 1;
          const noiseTmp =
            ((noise.shiftReg << (noise.randomMode === 0 ? 1 : 6)) ^
              noise.shiftReg) &
            0x8000;
          if (noiseTmp !== 0) {
            // Sample value must be 0.
            noise.shiftReg |= 0x01;
            noise.randomBit = 0;
            noise.sampleValue = 0;
          } else {
            // Find sample value:
            noise.randomBit = 1;
            if (noise.isEnabled && noise.lengthCounter > 0) {
              noise.sampleValue = noise.channelVolume;
            } else {
              noise.sampleValue = 0;
            }
          }

          noise.progTimerCount += noise.progTimerMax;
        }

        noise.noiseAccValue += noise.sampleValue;
        noise.noiseAccCount++;
      }
    }

    // Frame IRQ handling:
    if (this.frameIrqEnabled && this.frameIrqActive) {
      this.nes.cpu.requestIrq(this.nes.cpu.IRQ_NORMAL);
    }

    // Clock frame counter at double CPU speed:
    this.masterFrameCounter += nCycles << 1;
    if (this.masterFrameCounter >= this.frameTime) {
      // 240Hz tick:
      this.masterFrameCounter -= this.frameTime;
      this.frameCounterTick();
    }

    // Accumulate sample value:
    this.accSample(nCycles);

    // Clock sample timer:
    this.sampleTimer += nCycles << 10;
    if (this.sampleTimer >= this.sampleTimerMax) {
      // Sample channels:
      this.sample();
      this.sampleTimer -= this.sampleTimerMax;
    }
  }

  accSample(cycles) {
    // Special treatment for triangle channel - need to interpolate.
    if (!this.soundEnabled) return;
    let triValue = 0;
    if (this.triangle.sampleCondition) {
      triValue = Math.floor(
        (this.triangle.progTimerCount << 4) / (this.triangle.progTimerMax + 1)
      );
      if (triValue > 16) {
        triValue = 16;
      }
      if (this.triangle.triangleCounter >= 16) {
        triValue = 16 - triValue;
      }

      // Add non-interpolated sample value:
      triValue += this.triangle.sampleValue;
    }

    // Now sample normally:
    if (cycles === 2) {
      this.smpTriangle += triValue << 1;
      this.smpDmc += this.dmc.sample << 1;
      this.smpSquare1 += this.square1.sampleValue << 1;
      this.smpSquare2 += this.square2.sampleValue << 1;
      this.accCount += 2;
    } else if (cycles === 4) {
      this.smpTriangle += triValue << 2;
      this.smpDmc += this.dmc.sample << 2;
      this.smpSquare1 += this.square1.sampleValue << 2;
      this.smpSquare2 += this.square2.sampleValue << 2;
      this.accCount += 4;
    } else {
      this.smpTriangle += cycles * triValue;
      this.smpDmc += cycles * this.dmc.sample;
      this.smpSquare1 += cycles * this.square1.sampleValue;
      this.smpSquare2 += cycles * this.square2.sampleValue;
      this.accCount += cycles;
    }
  }

  frameCounterTick() {
    this.derivedFrameCounter++;
    if (this.derivedFrameCounter >= this.frameIrqCounterMax) {
      this.derivedFrameCounter = 0;
    }

    if (this.derivedFrameCounter === 1 || this.derivedFrameCounter === 3) {
      // Clock length & sweep:
      this.triangle.clockLengthCounter();
      this.square1.clockLengthCounter();
      this.square2.clockLengthCounter();
      this.noise.clockLengthCounter();
      if (this.soundEnabled) {
        this.square1.clockSweep();
        this.square2.clockSweep();
      }
    }

    if (this.soundEnabled && this.derivedFrameCounter >= 0 &&
        this.derivedFrameCounter < 4) {
      // Clock linear & decay:
      this.square1.clockEnvDecay();
      this.square2.clockEnvDecay();
      this.noise.clockEnvDecay();
      this.triangle.clockLinearCounter();
    }

    if (this.derivedFrameCounter === 3 && !this.countSequence) {
      // Enable IRQ:
      this.frameIrqActive = true;
    }

    // End of 240Hz tick
  }

  // Samples the channels, mixes the output together, then writes to buffer.
  sample() {
    if (!this.soundEnabled) return;
    var sq_index, tnd_index;

    if (this.accCount) {
      this.smpSquare1 <<= 4;
      this.smpSquare1 = Math.floor(this.smpSquare1 / this.accCount);

      this.smpSquare2 <<= 4;
      this.smpSquare2 = Math.floor(this.smpSquare2 / this.accCount);

      this.smpTriangle = Math.floor(this.smpTriangle / this.accCount);

      this.smpDmc <<= 4;
      this.smpDmc = Math.floor(this.smpDmc / this.accCount);

      this.accCount = 0;
    } else {
      this.smpSquare1 = this.square1.sampleValue << 4;
      this.smpSquare2 = this.square2.sampleValue << 4;
      this.smpTriangle = this.triangle.sampleValue;
      this.smpDmc = this.dmc.sample << 4;
    }

    const smpNoise =
        Math.floor((this.noise.noiseAccValue << 4) / this.noise.noiseAccCount);
    this.noise.noiseAccValue = smpNoise >> 4;
    this.noise.noiseAccCount = 1;

    // Stereo sound.

    // Left channel:
    sq_index =
      (this.smpSquare1 * this.stereoPosLSquare1 +
        this.smpSquare2 * this.stereoPosLSquare2) >>
      8;
    tnd_index =
      (3 * this.smpTriangle * this.stereoPosLTriangle +
        (smpNoise << 1) * this.stereoPosLNoise +
        this.smpDmc * this.stereoPosLDMC) >>
      8;
    if (sq_index >= SQUARE_TABLE.length) {
      sq_index = SQUARE_TABLE.length - 1;
    }
    if (tnd_index >= TND_TABLE.length) {
      tnd_index = TND_TABLE.length - 1;
    }
    var sampleValueL =
        SQUARE_TABLE[sq_index] + TND_TABLE[tnd_index] - DC_VALUE;

    // Right channel:
    sq_index =
      (this.smpSquare1 * this.stereoPosRSquare1 +
        this.smpSquare2 * this.stereoPosRSquare2) >>
      8;
    tnd_index =
      (3 * this.smpTriangle * this.stereoPosRTriangle +
        (smpNoise << 1) * this.stereoPosRNoise +
        this.smpDmc * this.stereoPosRDMC) >>
      8;
    if (sq_index >= SQUARE_TABLE.length) {
      sq_index = SQUARE_TABLE.length - 1;
    }
    if (tnd_index >= TND_TABLE.length) {
      tnd_index = TND_TABLE.length - 1;
    }
    var sampleValueR =
      SQUARE_TABLE[sq_index] + TND_TABLE[tnd_index] - DC_VALUE;

    // Remove DC from left channel:
    var smpDiffL = sampleValueL - this.prevSampleL;
    this.prevSampleL += smpDiffL;
    this.smpAccumL += smpDiffL - (this.smpAccumL >> 10);
    sampleValueL = this.smpAccumL;

    // Remove DC from right channel:
    var smpDiffR = sampleValueR - this.prevSampleR;
    this.prevSampleR += smpDiffR;
    this.smpAccumR += smpDiffR - (this.smpAccumR >> 10);
    sampleValueR = this.smpAccumR;

    // Write:
    if (sampleValueL > this.maxSample) {
      this.maxSample = sampleValueL;
    }
    if (sampleValueL < this.minSample) {
      this.minSample = sampleValueL;
    }

    if (this.nes.opts.onAudioSample) {
      this.nes.opts.onAudioSample(sampleValueL / 32768, sampleValueR / 32768);
    }

    // Reset sampled values:
    this.smpSquare1 = 0;
    this.smpSquare2 = 0;
    this.smpTriangle = 0;
    this.smpDmc = 0;
  }

  getLengthMax(value) {
    return LENGTH_LOOKUP[value >> 3];
  }

  getDmcFrequency(value) {
    if (value >= 0 && value < 0x10) {
      return DMC_FREQ_LOOKUP[value];
    }
    return 0;
  }

  getNoiseWaveLength(value) {
    if (value >= 0 && value < 0x10) {
      return NOISE_WAVE_LENGTH_LOOKUP[value];
    }
    return 0;
  }

  setPanning(pos) {
    for (var i = 0; i < 5; i++) {
      this.panning[i] = pos[i];
    }
    this.updateStereoPos();
  }

  setMasterVolume(value) {
    if (value < 0) {
      value = 0;
    }
    if (value > 256) {
      value = 256;
    }
    this.masterVolume = value;
    this.updateStereoPos();
  }

  updateStereoPos() {
    this.stereoPosLSquare1 = (this.panning[0] * this.masterVolume) >> 8;
    this.stereoPosLSquare2 = (this.panning[1] * this.masterVolume) >> 8;
    this.stereoPosLTriangle = (this.panning[2] * this.masterVolume) >> 8;
    this.stereoPosLNoise = (this.panning[3] * this.masterVolume) >> 8;
    this.stereoPosLDMC = (this.panning[4] * this.masterVolume) >> 8;

    this.stereoPosRSquare1 = this.masterVolume - this.stereoPosLSquare1;
    this.stereoPosRSquare2 = this.masterVolume - this.stereoPosLSquare2;
    this.stereoPosRTriangle = this.masterVolume - this.stereoPosLTriangle;
    this.stereoPosRNoise = this.masterVolume - this.stereoPosLNoise;
    this.stereoPosRDMC = this.masterVolume - this.stereoPosLDMC;
  }
}

const DM_MODE_NORMAL = 0;
const DM_MODE_LOOP = 1;
const DM_MODE_IRQ = 2;

class ChannelDM {
  constructor(papu) {
    this.papu = papu;

    this.isEnabled = false;
    this.hasSample = null;
    this.irqGenerated = false;

    this.playMode = DM_MODE_NORMAL;
    this.dmaFrequency = 0;
    this.dmaCounter = 0;
    this.deltaCounter = 0;
    this.playStartAddress = 0;
    this.playAddress = 0;
    this.playLength = 0;
    this.playLengthCounter = 0;
    this.shiftCounter = 0;
    this.dacLsb = 0;
    this.data = 0;

    this.sample = 0;
  }

  clockDmc() {
    // Only alter DAC value if the sample buffer has data:
    if (this.papu.soundEnabled && this.hasSample) {
      if ((this.data & 1) === 0) {
        // Decrement delta:
        if (this.deltaCounter > 0) {
          this.deltaCounter--;
        }
      } else {
        // Increment delta:
        if (this.deltaCounter < 63) {
          this.deltaCounter++;
        }
      }

      // Update sample value:
      this.sample = this.isEnabled ? (this.deltaCounter << 1) + this.dacLsb : 0;

      // Update shift register:
      this.data >>= 1;
    }

    this.dmaCounter--;
    if (this.dmaCounter <= 0) {
      // No more sample bits.
      this.hasSample = false;
      this.endOfSample();
      this.dmaCounter = 8;
    }

    if (this.irqGenerated) {
      this.papu.nes.cpu.requestIrq(this.papu.nes.cpu.IRQ_NORMAL);
    }
  }

  endOfSample() {
    if (this.playLengthCounter === 0 && this.playMode === DM_MODE_LOOP) {
      // Start from beginning of sample:
      this.playAddress = this.playStartAddress;
      this.playLengthCounter = this.playLength;
    }

    if (this.playLengthCounter > 0) {
      // Fetch next sample:
      this.nextSample();

      if (this.playLengthCounter === 0) {
        // Last byte of sample fetched, generate IRQ:
        if (this.playMode === DM_MODE_IRQ) {
          // Generate IRQ:
          this.irqGenerated = true;
        }
      }
    }
  }

  nextSample() {
    // Fetch byte:
    this.data = this.papu.nes.cpu.load(this.playAddress);
    this.papu.nes.cpu.haltCycles(4);

    this.playLengthCounter--;
    this.playAddress++;
    if (this.playAddress > 0xffff) {
      this.playAddress = 0x8000;
    }

    this.hasSample = true;
  }

  writeReg(address, value) {
    if (address === 0x4010) {
      // Play mode, DMA Frequency
      if (value >> 6 === 0) {
        this.playMode = DM_MODE_NORMAL;
      } else if (((value >> 6) & 1) === 1) {
        this.playMode = DM_MODE_LOOP;
      } else if (value >> 6 === 2) {
        this.playMode = DM_MODE_IRQ;
      }

      if ((value & 0x80) === 0) {
        this.irqGenerated = false;
      }

      this.dmaFrequency = this.papu.getDmcFrequency(value & 0xf);
    } else if (address === 0x4011) {
      // Delta counter load register:
      this.deltaCounter = (value >> 1) & 63;
      this.dacLsb = value & 1;
      this.sample = (this.deltaCounter << 1) + this.dacLsb; // update sample value
    } else if (address === 0x4012) {
      // DMA address load register
      this.playStartAddress = (value << 6) | 0x0c000;
      this.playAddress = this.playStartAddress;
    } else if (address === 0x4013) {
      // Length of play code
      this.playLength = (value << 4) + 1;
      this.playLengthCounter = this.playLength;
    } else if (address === 0x4015) {
      // DMC/IRQ Status
      if (((value >> 4) & 1) === 0) {
        // Disable:
        this.playLengthCounter = 0;
      } else {
        // Restart:
        this.playAddress = this.playStartAddress;
        this.playLengthCounter = this.playLength;
      }
      this.irqGenerated = false;
    }
  }

  setEnabled(value) {
    if (!this.isEnabled && value) {
      this.playLengthCounter = this.playLength;
    }
    this.isEnabled = value;
  }

  getLengthStatus() {
    return this.playLengthCounter === 0 || !this.isEnabled ? 0 : 1;
  }

  getIrqStatus() {
    return this.irqGenerated ? 1 : 0;
  }
}

class ChannelNoise {
  constructor(papu) {
    this.papu = papu;

    this.isEnabled = false;
    this.lengthCounter = 0;
    this.lengthCounterEnable = false;

    this.progTimerCount = 0;
    this.progTimerMax = 0;
    this.envDecayCounter = 0;
    this.envDecayDisable = false;
    this.envDecayLoopEnable = false;
    this.envDecayRate = 0;
    this.envReset = false;
    this.envVolume = 0;
    this.channelVolume = 0;

    this.shiftReg = 1;
    this.randomBit = 0;
    this.randomMode = 0;
    this.noiseAccValue = 0;
    this.noiseAccCount = 1;

    this.sampleValue = 0;
  }

  clockLengthCounter() {
    if (this.lengthCounterEnable && this.lengthCounter > 0) {
      this.lengthCounter--;
      if (this.lengthCounter === 0 && this.papu.soundEnabled) {
        this.updateSampleValue();
      }
    }
  }

  clockEnvDecay() {
    if (this.envReset) {
      // Reset envelope:
      this.envReset = false;
      this.envDecayCounter = this.envDecayRate + 1;
      this.envVolume = 0xf;
    } else if (--this.envDecayCounter <= 0) {
      // Normal handling:
      this.envDecayCounter = this.envDecayRate + 1;
      if (this.envVolume > 0) {
        this.envVolume--;
      } else {
        this.envVolume = this.envDecayLoopEnable ? 0xf : 0;
      }
    }
    if (this.envDecayDisable) {
      this.channelVolume = this.envDecayRate;
    } else {
      this.channelVolume = this.envVolume;
    }
    this.updateSampleValue();
  }

  updateSampleValue() {
    if (this.isEnabled && this.lengthCounter > 0) {
      this.sampleValue = this.randomBit * this.channelVolume;
    }
  }

  writeReg(address, value) {
    if (address === 0x400c) {
      // Volume/Envelope decay:
      this.envDecayDisable = (value & 0x10) !== 0;
      this.envDecayRate = value & 0xf;
      this.envDecayLoopEnable = (value & 0x20) !== 0;
      this.lengthCounterEnable = (value & 0x20) === 0;
      if (this.envDecayDisable) {
        this.channelVolume = this.envDecayRate;
      } else {
        this.channelVolume = this.envVolume;
      }
    } else if (address === 0x400e) {
      // Programmable timer:
      this.progTimerMax = this.papu.getNoiseWaveLength(value & 0xf);
      this.randomMode = value >> 7;
    } else if (address === 0x400f) {
      // Length counter
      this.lengthCounter = this.papu.getLengthMax(value & 248);
      this.envReset = true;
    }
    // Update:
    //updateSampleValue();
  }

  setEnabled(value) {
    this.isEnabled = value;
    if (!value) {
      this.lengthCounter = 0;
    }
    if (this.papu.soundEnabled) {
      this.updateSampleValue();
    }
  }

  getLengthStatus() {
    return this.lengthCounter === 0 || !this.isEnabled ? 0 : 1;
  }
}

class ChannelSquare {
  constructor(papu, sqr1) {
    this.papu = papu;
    this.sqr1 = sqr1 ? 1 : 0;

    this.isEnabled = false;
    this.lengthCounter = 0;
    this.lengthCounterEnable = false;

    this.sweepActive = false;
    this.sweepCounter = 0;
    this.sweepCounterMax = 0;
    this.sweepMode = 0;
    this.sweepShiftAmount = 0;
    this.updateSweepPeriod = false;
    this.squareCounter = 0;
    this.dutyMode = 0;

    this.progTimerCount = 0;
    this.progTimerMax = 0;
    this.envDecayCounter = 0;
    this.envDecayDisable = false;
    this.envDecayLoopEnable = false;
    this.envDecayRate = 0;
    this.envReset = false;
    this.envVolume = 0;
    this.channelVolume = 0;

    this.sampleValue = 0;
  }

  clockLengthCounter() {
    if (this.lengthCounterEnable && this.lengthCounter > 0) {
      this.lengthCounter--;
      if (this.lengthCounter === 0 && this.papu.soundEnabled) {
        this.updateSampleValue();
      }
    }
  }

  clockEnvDecay() {
    if (this.envReset) {
      // Reset envelope:
      this.envReset = false;
      this.envDecayCounter = this.envDecayRate + 1;
      this.envVolume = 0xf;
    } else if (--this.envDecayCounter <= 0) {
      // Normal handling:
      this.envDecayCounter = this.envDecayRate + 1;
      if (this.envVolume > 0) {
        this.envVolume--;
      } else {
        this.envVolume = this.envDecayLoopEnable ? 0xf : 0;
      }
    }

    if (this.envDecayDisable) {
      this.channelVolume = this.envDecayRate;
    } else {
      this.channelVolume = this.envVolume;
    }
    this.updateSampleValue();
  }

  clockSweep() {
    if (--this.sweepCounter <= 0) {
      this.sweepCounter = this.sweepCounterMax + 1;
      if (
        this.sweepActive &&
        this.sweepShiftAmount > 0 &&
        this.progTimerMax > 7
      ) {
        // Calculate result from shifter:
        if (this.sweepMode === 0) {
          this.progTimerMax += this.progTimerMax >> this.sweepShiftAmount;
          if (this.progTimerMax > 4095) {
            this.progTimerMax = 4095;
          }
        } else {
          this.progTimerMax -=
            ((this.progTimerMax >> this.sweepShiftAmount) - this.sqr1);
        }
      }
    }

    if (this.updateSweepPeriod) {
      this.updateSweepPeriod = false;
      this.sweepCounter = this.sweepCounterMax + 1;
    }
  }

  updateSampleValue() {
    if (this.isEnabled && this.lengthCounter > 0 &&
        this.progTimerMax > 7) {
      if (
        this.sweepMode === 0 &&
        this.progTimerMax + (this.progTimerMax >> this.sweepShiftAmount) > 4095
      ) {
        this.sampleValue = 0;
      } else {
        this.sampleValue =
            this.channelVolume *
            SQUARE_DUTY_LOOKUP[(this.dutyMode << 3) + this.squareCounter];
      }
    } else {
      this.sampleValue = 0;
    }
  }

  writeReg(address, value) {
    address &= 3;
    if (address == 0) {
      // Volume/Envelope decay:
      this.envDecayDisable = (value & 0x10) !== 0;
      this.envDecayRate = value & 0xf;
      this.envDecayLoopEnable = (value & 0x20) !== 0;
      this.dutyMode = (value >> 6) & 0x3;
      this.lengthCounterEnable = (value & 0x20) === 0;
      if (this.envDecayDisable) {
        this.channelVolume = this.envDecayRate;
      } else {
        this.channelVolume = this.envVolume;
      }
      if (this.soundEnabled) {
        this.updateSampleValue();
      }
    } else if (address == 1) {
      // Sweep:
      this.sweepActive = (value & 0x80) !== 0;
      this.sweepCounterMax = (value >> 4) & 7;
      this.sweepMode = (value >> 3) & 1;
      this.sweepShiftAmount = value & 7;
      this.updateSweepPeriod = true;
    } else if (address == 2) {
      // Programmable timer:
      this.progTimerMax &= 0x700;
      this.progTimerMax |= value;
    } else if (address == 3) {
      // Programmable timer, length counter
      this.progTimerMax &= 0xff;
      this.progTimerMax |= (value & 0x7) << 8;

      if (this.isEnabled) {
        this.lengthCounter = this.papu.getLengthMax(value & 0xf8);
      }

      this.envReset = true;
    }
  }

  setEnabled(value) {
    this.isEnabled = value;
    if (!value) {
      this.lengthCounter = 0;
    }
    if (this.papu.soundEnabled) {
      this.updateSampleValue();
    }
  }

  getLengthStatus() {
    return this.lengthCounter === 0 || !this.isEnabled ? 0 : 1;
  }
}

class ChannelTriangle {
  constructor(papu) {
    this.papu = papu;

    this.isEnabled = false;
    this.lengthCounter = 0;
    this.lengthCounterEnable = false;
    this.progTimerCount = 0;
    this.progTimerMax = 0;

    this.lcHalt = true;
    this.lcLoadValue = 0;
    this.triangleCounter = 0;

    this.sampleCondition = false; // Note: derived
    this.sampleValue = 0xf;
  }

  clockLengthCounter() {
    if (this.lengthCounterEnable && this.lengthCounter > 0) {
      this.lengthCounter--;
      if (this.lengthCounter === 0) {
        this.updateSampleCondition();
      }
    }
  }

  clockLinearCounter() {
    if (this.lcHalt) {
      // Load:
      this.linearCounter = this.lcLoadValue;
      this.updateSampleCondition();
    } else if (this.linearCounter > 0) {
      // Decrement:
      this.linearCounter--;
      this.updateSampleCondition();
    }
    if (this.lengthCounterEnable) {
      // Clear halt flag:
      this.lcHalt = false;
    }
  }

  getLengthStatus() {
    return this.lengthCounter === 0 || !this.isEnabled ? 0 : 1;
  }

  writeReg(address, value) {
    if (address === 0x4008) {
      // New values for linear counter:
      this.lengthCounterEnable = (value & 0x80) === 0;
      this.lcLoadValue = value & 0x7f;
    } else if (address === 0x400a) {
      // Programmable timer:
      this.progTimerMax &= 0x700;
      this.progTimerMax |= value;
    } else if (address === 0x400b) {
      // Programmable timer, length counter
      this.progTimerMax &= 0xff;
      this.progTimerMax |= (value & 0x07) << 8;
      this.lengthCounter = this.papu.getLengthMax(value & 0xf8);
      this.lcHalt = true;
    }

    this.updateSampleCondition();
  }

  clockProgrammableTimer(nCycles) {
    if (this.progTimerMax) {
      this.progTimerCount += nCycles;
      while (this.progTimerCount >= this.progTimerMax) {
        this.progTimerCount -= this.progTimerMax;
        if (this.isEnabled && this.lengthCounter && this.linearCounter) {
          this.clockTriangleGenerator();
        }
      }
    }
  }

  clockTriangleGenerator() {
    this.triangleCounter++;
    this.triangleCounter &= 0x1f;
  }

  setEnabled(value) {
    this.isEnabled = value;
    if (!value) {
      this.lengthCounter = 0;
    }
    this.updateSampleCondition();
  }

  updateSampleCondition() {
    this.sampleCondition =
      this.isEnabled &&
      this.progTimerMax > 7 &&
      this.linearCounter &&
      this.lengthCounter;
  }
}

const SQUARE_TABLE =
    Uint16Array.from(seq(32 * 16).map((i) => Math.floor(
        50000.0 * 0.98411 * 95.52 / (8128.0 / (i / 16.0) + 100.0))));

const TND_TABLE =
    Uint16Array.from(seq(204 * 16).map((i) => Math.floor(
        50000.0 * 0.98411 * 163.67 / (24329.0 / (i / 16.0) + 100.0))));

const DC_VALUE = (Math.max(...SQUARE_TABLE) + Math.max(...TND_TABLE)) / 2;

const LENGTH_LOOKUP = Uint8Array.of(
    0x0A, 0xFE,
    0x14, 0x02,
    0x28, 0x04,
    0x50, 0x06,
    0xA0, 0x08,
    0x3C, 0x0A,
    0x0E, 0x0C,
    0x1A, 0x0E,
    0x0C, 0x10,
    0x18, 0x12,
    0x30, 0x14,
    0x60, 0x16,
    0xC0, 0x18,
    0x48, 0x1A,
    0x10, 0x1C,
    0x20, 0x1E);

const DMC_FREQ_LOOKUP = Uint16Array.of(
    0xd60, // 0x0
    0xbe0, // 0x1
    0xaa0, // 0x2
    0xa00, // 0x3
    0x8f0, // 0x4
    0x7f0, // 0x5
    0x710, // 0x6
    0x6b0, // 0x7
    0x5f0, // 0x8
    0x500, // 0x9
    0x470, // 0xa
    0x400, // 0xb
    0x350, // 0xc
    0x2a0, // 0xd
    0x240, // 0xe
    0x1b0); // 0xf
    //for(int i=0;i<16;i++)dmcFreqLookup[i]/=8;

const NOISE_WAVE_LENGTH_LOOKUP = Uint16Array.of(
    0x004, // 0x0
    0x008, // 0x1
    0x010, // 0x2
    0x020, // 0x3
    0x040, // 0x4
    0x060, // 0x5
    0x080, // 0x6
    0x0a0, // 0x7
    0x0ca, // 0x8
    0x0fe, // 0x9
    0x17c, // 0xa
    0x1fc, // 0xb
    0x2fa, // 0xc
    0x3f8, // 0xd
    0x7f2, // 0xe
    0xfe4); // 0xf

const DEFAULT_SAMPLE_RATE = 44100;

const SQUARE_DUTY_LOOKUP =
    Uint8Array.of(
        0, 1, 0, 0, 0, 0, 0, 0,
        0, 1, 1, 0, 0, 0, 0, 0,
        0, 1, 1, 1, 1, 0, 0, 0,
        1, 0, 0, 1, 1, 1, 1, 1);
