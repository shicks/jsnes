import {Controller} from '../controller.js';

export class GamepadController {
  constructor(main) {
    this.main = main;
    this.gamepads = [];
    window.addEventListener('gamepadconnected', async ({gamepad}) => {
      console.log("Gamepad connected at index %d: %s. %d buttons, %d axes.",
                  gamepad.index, gamepad.id,
                  gamepad.buttons.length, gamepad.axes.length);
      if (gamepad.mapping == 'standard') {
        this.gamepads.push({
          index: gamepad.index,
          mapping: await getSavedMapping(gamepad),
        });
        this.state.push({});
      } // TODO(sdh): support custom (re)mappings
    });
    window.addEventListener("gamepaddisconnected", ({gamepad}) => {
      console.log("Gamepad disconnected from index %d: %s",
                  gamepad.index, gamepad.id);
      const index = this.gamepads.findIndex(g => g.index === gamepad.index);
      if (index >= 0) {
        this.gamepads.splice(index, 1);
        this.state.splice(index, 1);
      }
    });
    this.state = [];
  }

  update() {
    const gs = navigator.getGamepads(); // seems necessary to actually update?
    // TODO - if unconfigured pressed, then go thru configure flow
    const log = [];
    for (const {index, mapping} of this.gamepads) {
      const g = gs[index];
      for (const b in mapping) {
        log.push(`${index}.${b}: ${this.state[index][b]} -> ${g.buttons[b].pressed}`);
        if (g.buttons[b].pressed != this.state[index][b]) {
          if (this.state[index][b] = g.buttons[b].pressed) {
            log.push(` => button down: ${index % 2 + 1}, ${mapping[b]}`);
            this.main.nes.buttonDown(index % 2 + 1, mapping[b]);
          } else {
            log.push(` => button up: ${index % 2 + 1}, ${mapping[b]}`);
            this.main.nes.buttonUp(index % 2 + 1, mapping[b]);
          }
        }
      }
    }
  }

  clearDefaults() {
    localStorage.removeItem('gamepads');
  }
}

// Mapping keyboard code to [controller, button]
const DEFAULT_MAP = {
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

const BUTTON_NAMES = [
  [Controller.BUTTON_UP, 'UP'],
  [Controller.BUTTON_DOWN, 'DOWN'],
  [Controller.BUTTON_LEFT, 'LEFT'],
  [Controller.BUTTON_RIGHT, 'RIGHT'],
  [Controller.BUTTON_B, 'B'],
  [Controller.BUTTON_A, 'A'],
  [Controller.BUTTON_SELECT, 'SELECT'],
  [Controller.BUTTON_START, 'START'],
];

// TODO - UI to map (and then store in localstorage)?

/*
interface Gamepad {
  index: number;
  mapping: Record<number, number>;
}
*/

async function getSavedMapping(gamepad) {
  const gamepads = JSON.parse(localStorage.getItem('gamepads') || '{}');
  let mapping = gamepads[gamepad.id];
  if (mapping) return mapping;
  mapping = await readMapping(gamepad.index);
  setSavedMapping(gamepad, mapping);
  return mapping;
}

function setSavedMapping(gamepad, mapping) {
  const gamepads = JSON.parse(localStorage.getItem('gamepads') || '{}');
  gamepads[gamepad.id] = mapping;
  localStorage.setItem('gamepads', JSON.stringify(gamepads));
}

async function readMapping(index) {
  const map = {};
  const controller = new AbortController();
  const signal = controller.signal;
  const signalPromise = new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  });
  signalPromise.catch(() => {
    modal.remove();
    overlay.remove();
  });
  // make a couple elements, add them to the DOM.
  const modal = appendDiv('gamepad-modal');
  const overlay = appendDiv('gamepad-modal-overlay');
  overlay.addEventListener('click', () => controller.abort());
  for (const [button, name] of BUTTON_NAMES) {
    modal.textContent = `Press the ${name} button`;
    const physical =
        await Promise.race([signalPromise, getNextButton(index, signal)]);
    map[physical] = button;
  }
  controller.abort();
  return map;
}

function appendDiv(className) {
  const el = document.createElement('div');
  el.classList.add(className);
  document.body.appendChild(el);
  return el;
}

function getNextButton(index, signal) {
  return new Promise((resolve, reject) => {
    let pressed = new Set();
    function poll() {
      let anyPressed = false;
      const bs = navigator.getGamepads()[index].buttons;
      for (let i = 0; i < bs.length; i++) {
        if (bs[i].pressed) {
          pressed.add(i);
          anyPressed = true;
        }
      }
      if (!anyPressed) {
        if (pressed.size === 1) {
          resolve([...pressed][0]);
          return;
        } else if (pressed.size > 1) {
          pressed.clear();
        }
      }
      if (!signal.aborted) setTimeout(poll, 50);
    }
    poll();
  });
}
