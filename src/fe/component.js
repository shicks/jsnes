import {child} from './utils.js';

// A component of the grid.  Handles drag-and-drop rearrangement, closing, etc.
export class Component {
  constructor() {
    this.outer = child(document.getElementById('grid'), 'div', 'component');
    this.corner = child(this.outer, 'div', 'corner');
    this.addCornerButton('x', () => this.remove());
    Component.map.set(this.outer, this);
    this.element = child(this.outer, 'div');
  }

  addCornerButton(text, handler) {
    const button = child(this.corner, 'div');
    button.textContent = text;
    button.addEventListener('click', handler);
  }

  remove() { this.outer.remove(); }

  // Returns a string representation of this component's state, to be merged
  // into the URL fragment.
  getState() { return ''; }
  // Sets the state of this component from a URL fragment.  May assume presence
  // of localstorage, etc.
  setState(state) {}

  // Abstract update method called on each frame.
  frame() {}

  // Update method for stepping execution - defaults to same as frame.
  // This runs every time the CPU breaks.
  step() { this.frame(); }
}

// Map from elements to components.
Component.map = new WeakMap();
