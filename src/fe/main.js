import {Controller} from '../controller.js';
import {NES} from '../nes.js';
import {Screen} from './screen.js';
import {Speakers} from './speakers.js';
import {KeyboardController} from './keyboardcontroller.js';
import {FrameTimer} from './frametimer.js';


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
        console.log(
          "Buffer underrun, running another frame to try and catch up"
        );
        this.nes.frame();
        // desiredSize will be 2048, and the NES produces 1468 samples on each
        // frame so we might need a second frame to be run. Give up after that
        // though -- the system is not catching up
        if (this.speakers.buffer.size() < desiredSize) {
          console.log("Still buffer underrun, running a second frame");
          this.nes.frame();
        }
      }
    });

    this.nes = new NES({
      onFrame: this.screen.setBuffer.bind(this.screen),
      onStatusUpdate: console.log,
      onAudioSample: this.speakers.writeSample.bind(this.speakers),
    });

    this.frameTimer = new FrameTimer({
      onGenerateFrame: this.nes.frame.bind(this.nes),
      onWriteFrame: this.screen.writeBuffer.bind(this.screen),
    });

    this.keyboardController = new KeyboardController({
      onButtonDown: this.nes.buttonDown.bind(this.nes),
      onButtonUp: this.nes.buttonUp.bind(this.nes),
    });
    document.addEventListener(
      "keydown",
      this.keyboardController.handleKeyDown.bind(this.keyboardController));
    document.addEventListener(
      "keyup",
      this.keyboardController.handleKeyUp.bind(this.keyboardController));
    document.addEventListener(
      "keypress",
      this.keyboardController.handleKeyPress.bind(this.keyboardController));

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
    this.frameTimer.start();
    this.speakers.start();
    this.fpsInterval = setInterval(() => {
      console.log(`FPS: ${this.nes.getFPS()}`);
    }, 1000);
  }

  stop() {
    this.frameTimer.stop();
    this.speakers.stop();
    clearInterval(this.fpsInterval);
  }

  handlePauseResume() {
    if (this.state.paused) {
      this.state.paused = false;
      this.start();
    } else {
      this.state.paused = true;
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

new Main(document.getElementById('screen'));
