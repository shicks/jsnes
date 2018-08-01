import {Controller} from '../controller.js';
import {NES} from '../nes.js';
import {Screen} from './screen.js';
import {Speakers} from './speakers.js';
import {KeyboardController} from './keyboardcontroller.js';
import {FrameTimer} from './frametimer.js';

const bufferLog = () => {}; console.log.bind(console);

function loadBinary(path, callback, handleProgress) {
  var req = new XMLHttpRequest();
  req.open("GET", path);
  req.overrideMimeType("text/plain; charset=x-user-defined");
  req.onload = function() {
    if (this.status === 200) {
      callback(null, this.responseText);
    } else if (this.status === 0) {
      // Aborted, so ignore error
    } else {
      callback(new Error(req.statusText));
    }
  };
  req.onerror = function() {
    callback(new Error(req.statusText));
  };
  req.onprogress = handleProgress;
  req.send();
  return req;
}

class Main {
  constructor(screen) {
    this.state = {
      running: false,
      paused: false,
      loading: true,
      loadedPercent: 3,
    };

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
      onGenerateFrame: this.nes.frame.bind(this.nes),
      onWriteFrame: this.screen.writeBuffer.bind(this.screen),
    });

    this.keyboardController = new KeyboardController(this);

    // window.addEventListener("resize", this.layout.bind(this));
    // this.layout();
    this.load();
  }

  load() {
    if (true) {
      // const path =
      //     'https://cors.io/?http://s000.tinyupload.com/?file_id=45741185993656486680';
//      const path = 'https://cors.io/?http://s000.tinyupload.com/download.php?file_id=45741185993656486680&t=4574118599365648668052380';
      // const path = 'https://cors.io/download.php' +
      //       '?file_id=45741185993656486680&t=4574118599365648668089852';
//const path = 'https://cors.io/?https://nofile.io/g/zBPxYTEKQzxHwW0JvHmHeVWivDdOTnhuCSXaBO1d5lktHdR3d6WdGQW8XWAGgtGS/Crystalis+%28U%29+%5B%21%5D.nes/';
      const path = 'local-roms/rom.nes';
      this.currentRequest = loadBinary(
        path,
        (err, data) => {
          if (err) {
            window.alert(`Error loading ROM: ${err.toString()}`);
          } else {
            this.handleLoaded(data);
          }
        },
        this.handleProgress.bind(this)
      );
    // } else if (this.props.location.state && this.props.location.state.file) {
    //   // TODO - handle drag and drop?
    //   let reader = new FileReader();
    //   reader.readAsBinaryString(this.props.location.state.file);
    //   reader.onload = e => {
    //     this.currentRequest = null;
    //     this.handleLoaded(e.target.result);
    //   };
    // } else {
    //   window.alert("No ROM provided");
    }
  }

  handleProgress(e) {
    if (e.lengthComputable) {
      this.state.loadedPercent = e.loaded / e.total * 100;
    }
  }

  handleLoaded(data) {
    this.state.uiEnabled = true;
    this.state.running = true;
    this.state.loading = false;
    this.nes.loadROM(data);
    this.start();
  }

  start() {
    this.state.paused = false;
    this.frameTimer.start();
    this.speakers.start();
    this.fpsInterval = setInterval(() => {
      bufferLog(`FPS: ${this.nes.getFPS()}`);
    }, 1000);
  }

  stop() {
    this.state.paused = true;
    this.frameTimer.stop();
    this.speakers.stop();
    clearInterval(this.fpsInterval);
  }

  handlePauseResume() {
    if (this.state.paused) {
      this.start();
    } else {
      this.stop();
    }
  }

  // layout() {
  //   let navbarHeight = parseFloat(window.getComputedStyle(this.navbar).height);
  //   this.screenContainer.style.height = `${window.innerHeight -
  //     navbarHeight}px`;
  //   this.screen.fitInParent();
  // }
}

let snapshot;
window.main = new Main(document.getElementById('screen'));
main.advance = () => { nes.debug.breakIn = 100; main.start(); };
main.save = () => {snapshot = nes.cpu.snapshot();}; // q
main.load = () => {nes.cpu.restore(snapshot);}; // w


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
  main.functions[86] = () => console.log(nes.debug.coverage.candidates(type)); // V (List)
};

main.watch = (...addrs) => {
  // TODO - display options? ascii? 16-bit?
  const d = document.getElementById('debug');
  const w = document.createElement('div');
  d.appendChild(w);
  w.classList.add('watch');
  const close = document.createElement('span');
  close.classList.add('close');
  w.appendChild(close);
  const map = {};
  for (let addr of addrs) {
    if (addr instanceof Array && addr.length == 1) addr = addr[0];
    if (!(addr instanceof Array)) addr = [addr, addr];
    for (let a = addr[0]; a <= addr[1]; a++) {
      const label = document.createElement('span');
      label.textContent = '   $' + a.toString(16).padStart(4, 0) + ': ';
      label.classList.add('label');
      w.appendChild(label);
      const value = document.createElement('span');
      map[a] = value;
      value.classList.add('value');
      w.appendChild(value);
    }
  }
  let timeout = () => {
    setTimeout(() => {
      for (let addr in map) {
        addr = Number(addr);
        const newText = '$' + nes.cpu.mem[addr].toString(16).padStart(2, 0);
        const el = map[addr];
        if (el.textContent != newText) {
          el.style.color = '#ff0000';
          el.textContent = newText;
          el.dataset['red'] = 255;
        } else {
          const red = Math.max(0, el.dataset['red'] -= 2);
          el.style.color = `#${red.toString(16).padStart(2,0)}0000`;
        }
      }
      timeout();
    }, 30);
  };  
  close.textContent = 'x';
  close.addEventListener('click', () => {
    timeout = () => {};
    w.remove();
  });
  timeout();
};
