// Reusable class for getting input from the user.

import {Elemental} from './elemental.js';

export class Dialog {

  constructor() {
    this.promise = new Promise(x => Object.assign(x, this));
    const root = new Elemental(document.body).child('div').style({
      zIndex: 1000,
      position: 'fixed',
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    });
    root.child('div').style({
      background: 'white',
      opacity: 0.5,
      position: 'fixed',
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    });
    this.element = root.child('div').style({
      background: 'white',
      position: 'fixed',
      left: '20%',
      right: '20%',
      top: '20%',
      bottom: '20%',
      border: '1px solid #999',
    });
    root.child('div').text('x').style({
      position: 'fixed',
      right: '20%',
      top: '20%',
      width: '1em',
      height: '1em',
    }).handle('click', () => {
      this.reject(new Error('closed'));
    });
    const remove = () => document.body.remove(root.element);
    this.promise.then(remove, remove);
  }
}
