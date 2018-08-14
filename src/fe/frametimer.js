// FrameTimer is two timers: one which triggers at 60 FPS, and the other which
// triggers whenever there is an animation frame.
//
// Normally, the animation frame is 60 FPS, but if it isn't, we need to
// bodge it by setting up another timer.
//
// Why not just use the bodge all the time? If the animation frame is 60 FPS,
// then it is a much more accurate timer than setInterval. Also, two timers
// will sometimes be out of sync, causing missed frames.
export class FrameTimer {
  constructor(props) {
    // Run at 60 FPS
    this.onGenerateFrame = props.onGenerateFrame;
    // Run on animation frame
    this.onWriteFrame = props.onWriteFrame;
    this.onSkipFrame = props.onSkipFrame;

    // Whether to fire events or not
    this.running = false;

    // Bodge mode and calibration
    this.bodgeMode = false;

    // Calibration config
    this.desiredFPS = 60;
    this.calibrationDelay = 200; // time to wait before starting
    this.calibrationFrames = 10; // number of frames to calibrate with
    this.calibrationTolerance = 5; // +/- desired FPS to consider correct

    // Calibration state
    this.calibrating = false;
    this.calibrationStartTime = null;
    this.calibrationCurrentFrames = null;

    // FIXME: disable bodge mode entirely. it's not really working.
    // if (window.requestAnimationFrame) {
    //   // wait a sec for it to settle down
    //   setTimeout(() => {
    //     this.calibrating = true;
    //   }, this.calibrationDelay);
    // } else {
    //   console.log("requestAnimationFrame is not supported");
    // }

    this.frame = 0;
    this.frameSkip = 0;
  }

  start() {
    this.running = true;
    this.requestAnimationFrame();
    if (this.bodgeMode) this.startBodgeMode();
  }

  stop() {
    this.running = false;
    if (this._requestID) window.cancelAnimationFrame(this._requestID);
    if (this.bodgeInterval) clearInterval(this.bodgeInterval);
  }

  requestAnimationFrame() {
    this._requestID = window.requestAnimationFrame(() => this.onAnimationFrame());
  }

  onAnimationFrame() {
    if (this.calibrating) {
      console.log('Calibrating framerate');
      // TODO(sdh): probably avoid calibrating after a breakpoint?
      if (this.calibrationStartTime === null) {
        this.calibrationStartTime = new Date().getTime();
        this.calibrationCurrentFrame = 0;
      } else {
        this.calibrationCurrentFrames += 1;
      }

      // Calibration complete!
      if (this.calibrationCurrentFrames === this.calibrationFrames) {
        this.calibrating = false;
        console.log(`Calibration complete: FPS ${fps}`);

        var now = new Date().getTime();
        var delta = now - this.calibrationStartTime;
        var fps = 1000 / (delta / this.calibrationFrames);

        if (
          fps <= this.desiredFPS - this.calibrationTolerance ||
          fps >= this.desiredFPS + this.calibrationTolerance
        ) {
          console.log(
            `Enabling bodge mode. (Desired FPS is ${
              this.desiredFPS
            }, actual FPS is ${fps})`
          );
          this.startBodgeMode();
        }
      }
    }

    if (++this.frame % (this.frameSkip + 1)) {
      this.onSkipFrame();
      this.onAnimationFrame();
      return;
    }
    this.requestAnimationFrame();

    if (this.running) {
      if (!this.bodgeMode) {
        this.onGenerateFrame();
      }
      this.onWriteFrame();
    }
  }

  startBodgeMode() {
    this.bodgeMode = true;
    this.bodgeInterval = setInterval(this.onBodge, 1000 / this.desiredFPS);
  }

  onBodge() {
    if (this.running) {
      this.onGenerateFrame();
    }
  }
}
