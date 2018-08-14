import {Controller} from '../controller.js';
import {NES} from '../nes.js';
import {Screen} from './screen.js';
import {Speakers} from './speakers.js';
import {GamepadController} from './gamepadcontroller.js';
import {KeyboardController} from './keyboardcontroller.js';
import {FrameTimer} from './frametimer.js';
import {ChrRomViewer, PatternTableViewer, Trace, WatchPanel, WatchPage} from './debugger.js';
import {Component} from './component.js';
import {FileSystem} from './fs.js';

const bufferLog = () => {}; console.log.bind(console);

class Main {
  constructor(screen) {
    this.state = {
      running: false,
      paused: true,
      loading: true,
      loadedPercent: 3,
    };

    this.fs = new FileSystem();
    this.romName = null;

    this.screen = new Screen(screen);
    // screen - onGenerateFrame => this.nes.frame() ?

    this.speakers = new Speakers({
      onBufferUnderrun: (actualSize, desiredSize) => {
        if (!this.state.running || this.state.paused) {
          return;
        }
        // Skip a video frame so audio remains consistent. This happens for
        // a variety of reasons:
        // - Frame rate is not quite 60fps, so sometimes buffer empties
        // - Page is not visible, so requestAnimationFrame doesn't get fired.
        //   In this case emulator still runs at full speed, but timing is
        //   done by audio instead of requestAnimationFrame.
        // - System can't run emulator at full speed. In this case it'll stop
        //    firing requestAnimationFrame.
        bufferLog(
          "Buffer underrun, running another frame to try and catch up"
        );
        this.nes.frame();
        // desiredSize will be 2048, and the NES produces 1468 samples on each
        // frame so we might need a second frame to be run. Give up after that
        // though -- the system is not catching up
        if (this.speakers.buffer.size() < desiredSize) {
          bufferLog("Still buffer underrun, running a second frame");
          this.nes.frame();
        }
      }
    });

    this.nes = window.nes = new NES({
      onFrame: this.screen.setBuffer.bind(this.screen),
      onStatusUpdate: console.log,
      onAudioSample: this.speakers.writeSample.bind(this.speakers),
      onBreak: () => this.stop(),
    });

    this.frameTimer = new FrameTimer({
      onGenerateFrame: () => {
        this.nes.frame();
      },
      onWriteFrame: () => {
        this.screen.writeBuffer();
        this.gamepadController.update();
        for (const el of document.querySelectorAll('#grid > .component')) {
          const component = Component.map.get(el);
          if (component) component.frame();
        }
      },
      onSkipFrame: () => {
        this.nes.frame();
      },
    });

    this.keyboardController = new KeyboardController(this);
    this.gamepadController = new GamepadController(this);

    // window.addEventListener("resize", this.layout.bind(this));
    // this.layout();
    this.load();
  }

  setFrameSkip(skip) {
    this.frameTimer.frameSkip = skip;
    this.speakers.enabled = false;
  }

  getHash(key) {
    for (const component of window.location.hash.substring(1).split('&')) {
      const split = component.split('=');
      if (split[0] === key) {
        return decodeURIComponent(split[1]);
      }
    }
    return undefined;
  }

  setHash(key, value) {
    const components = [];
    for (const component of window.location.hash.substring(1).split('&')) {
      if (!component) continue;
      const split = component.split('=');
      if (split[0] === key) {
        components.push(`${key}=${encodeURIComponent(value)}`);
        key = undefined;
      } else {
        components.push(component);
      }
    }
    if (key) components.push(`${key}=${encodeURIComponent(value)}`);
    window.location.hash = '#' + components.join('&');
  }

  async load() {
    const romName = this.getHash('rom');
    if (romName) {
      const data = await this.fs.get(romName);
      if (data) {
        this.handleLoaded(romName, data.data);
        return;
      }
    }
    const file = await this.fs.pick('Select a ROM image');
    if (file) {
      this.handleLoaded(file.name, file.data);
      this.setHash('rom', file.name);
    }
  }

  handleLoaded(name, data) {
    this.state.uiEnabled = true;
    this.state.running = true;
    this.state.loading = false;
    this.romName = name;
    this.nes.loadROM(new Uint8Array(data));
    this.start();
  }

  start() {
    if (!this.state.paused) return;
    this.state.paused = false;
    this.frameTimer.start();
    this.speakers.start();
    this.fpsInterval = setInterval(() => {
      bufferLog(`FPS: ${this.nes.getFPS()}`);
    }, 1000);
  }

  stop() {
    if (this.state.paused) return;
    this.state.paused = true;
    this.frameTimer.stop();
    this.speakers.stop();
    clearInterval(this.fpsInterval);
    let trace;
    for (const el of document.querySelectorAll('#grid > .component')) {
      // for now, just auto-create the Trace component if it's not there.
      const component = Component.map.get(el);
      if (component instanceof Trace) trace = component;
      if (component) component.step();
    }
    if (!trace) new Trace(this.nes, () => this.start()).step();
  }

  handlePauseResume() {
    if (this.state.paused) {
      this.start();
    } else {
      this.stop();
    }
  }

  advanceFrame() {
    this.nes.debug.breakAtVBlank = true;
    this.start();
  }

  advance(instructions = 100) {
    this.nes.debug.breakIn = instructions;
    this.start();
  }

  // layout() {
  //   let navbarHeight = parseFloat(window.getComputedStyle(this.navbar).height);
  //   this.screenContainer.style.height = `${window.innerHeight -
  //     navbarHeight}px`;
  //   this.screen.fitInParent();
  // }

  patternTable() {
    return new PatternTableViewer(this.nes);
  }

  chrRom(...pages) {
    return new ChrRomViewer(this.nes, pages);
  }
}

let snapshot;
window.main = new Main(document.getElementById('screen'));
main.save = () => {snapshot = nes.cpu.snapshot();}; // q
main.load = () => {nes.cpu.restore(snapshot);}; // w

// TODO - save snapshots to local storage
//   - consider also storing a screenshot along with?


// main.track = (type) => {
//   main.functions[68] = (main) => console.log(main.nes.debug.mt.expectDiff()), // D (Diff)
//   main.functions[82] = (main) => main.nes.debug.mt.reset(), // R (Reset)
//   main.functions[83] = (main) => console.log(main.nes.debug.mt.expectSame()), // S (Same)
//   main.functions[76] = (main) => console.log(main.nes.debug.mt.candidates()), // L (List)
// };

main.track = (type) => {
  nes.debug.coverage.clear();
  main.functions[67] = () => console.log(nes.debug.coverage.expectCovered()); // C (Covered)
  main.functions[85] = () => console.log(nes.debug.coverage.expectUncovered()); // U (Uncov)
  main.functions[86] = () => console.log(nes.debug.coverage.candidates(type, true)); // V (List)
};

const deepMap = (x, f) => {
  if (typeof x[Symbol.iterator] == 'function') {
    return Array.from(x, y => deepMap(y, f));
  } else {
    return f(x);
  }
};

main.watch = (...addrs) => new WatchPanel(nes, ...addrs);

main.watchPage = (page) => deepMap(page, p => new WatchPage(nes, p));
