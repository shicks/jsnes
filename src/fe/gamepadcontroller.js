import {Controller} from '../controller.js';

// Mapping keyboard code to [controller, button]
const BUTTONS = {
  2: Controller.BUTTON_A,
  3: Controller.BUTTON_B,
  // TODO(sdh): turbo on 1,3?
  8: Controller.BUTTON_SELECT,
  9: Controller.BUTTON_START,
  12: Controller.BUTTON_UP,
  13: Controller.BUTTON_DOWN,
  14: Controller.BUTTON_LEFT,
  15: Controller.BUTTON_RIGHT,
  // TODO(sdh): custom commands, like save/load state?
};

// TODO - UI to map (and then store in localstorage)?

export class GamepadController {
  constructor(main) {
    this.main = main;
    this.gamepads = [];
    window.addEventListener('gamepadconnected', ({gamepad}) => {
      console.log("Gamepad connected at index %d: %s. %d buttons, %d axes.",
                  gamepad.index, gamepad.id,
                  gamepad.buttons.length, gamepad.axes.length);
      if (gamepad.mapping == 'standard') {
        this.gamepads.push(gamepad);
        this.state.push({});
      } // TODO(sdh): support custom (re)mappings
    });
    window.addEventListener("gamepaddisconnected", ({gamepad}) => {
      console.log("Gamepad disconnected from index %d: %s",
                  gamepad.index, gamepad.id);
      const index = this.gamepads.indexOf(gamepad);
      if (index >= 0) this.gamepads.splice(index, 1);
    });
    this.state = [];
  }

  update() {
    navigator.getGamepads(); // seems necessary to actually update?
    const log = [];
    for (let i = 0; i < this.gamepads.length; i++) {
      for (const b in BUTTONS) {
        log.push(`${i}.${b}: ${this.state[i][b]} -> ${this.gamepads[i].buttons[b].pressed}`);
        if (this.gamepads[i].buttons[b].pressed != this.state[i][b]) {
          if (this.state[i][b] = this.gamepads[i].buttons[b].pressed) {
            log.push(` => button down: ${i % 2 + 1}, ${BUTTONS[b]}`);
            this.main.nes.buttonDown(i % 2 + 1, BUTTONS[b]);
          } else {
            log.push(` => button up: ${i % 2 + 1}, ${BUTTONS[b]}`);
            this.main.nes.buttonUp(i % 2 + 1, BUTTONS[b]);
          }
          
        }
      }
    }
//    console.log(log.join('\n'));
  }
}
