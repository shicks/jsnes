export const child = (parent, type, ...classes) => {
  const e = document.createElement(type);
  parent.appendChild(e);
  for (const c of classes) {
    e.classList.add(c);
  }
  return e;
};

export const text = (parent, text) => {
  const n = document.createTextNode(text);
  parent.appendChild(n);
};

// Format a hex number
export const fmt = (x, p) => `$${x.toString(16).padStart(p, 0)}`;
