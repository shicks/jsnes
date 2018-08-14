export function Controller() {
  this.state = new Array(8);
  for (var i = 0; i < this.state.length; i++) {
    this.state[i] = 0x40;
  }
}

Controller.BUTTON_A = 0;
Controller.BUTTON_B = 1;
Controller.BUTTON_SELECT = 2;
Controller.BUTTON_START = 3;
Controller.BUTTON_UP = 4;
Controller.BUTTON_DOWN = 5;
Controller.BUTTON_LEFT = 6;
Controller.BUTTON_RIGHT = 7;

Controller.prototype = {
  buttonDown: function(key) {
    if (this.state[key] == 0x41) return false;
    this.state[key] = 0x41;
    return true;
  },

  buttonUp: function(key) {
    if (this.state[key] == 0x40) return false;
    this.state[key] = 0x40;
    return true;
  }
};
