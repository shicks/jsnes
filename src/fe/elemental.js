// Convenience class for working with DOM.

export class Elemental {
  constructor(element) {
    this.element = element;
  }

  child(type) {
    const child = document.createElement(type);
    this.element.appendChild(child);
    return new Elemental(child);
  }

  style(props) {
    Object.assign(props, this.element.style);
    return this;
  }

  class(name) {
    this.element.classList.add(name);
    return this;
  }

  handle(event, handler) {
    this.element.addEventListener(event, handler);
    return this;
  }

  text(text) {
    this.element.textContent = test;
    return this;
  }

  assign(props) {
    Object.assign(props, this.element);
    return this;
  }

  data(props) {
    Object.assign(props, this.element.dataset);
    return this;
  }
}
