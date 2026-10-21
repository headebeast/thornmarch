// Tiny DOM toolkit. Elements are built with createElement/textContent — never innerHTML — so player-supplied
// strings (usernames, chat, room names, custom map names) can never inject markup.

export function h(tag, attrs = null, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') {
        for (const [sk, sv] of Object.entries(v)) {
          if (sk.startsWith('--')) el.style.setProperty(sk, sv);
          else el.style[sk] = sv;
        }
      }
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'text') el.textContent = v;
      else if (v === true) el.setAttribute(k, '');
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

export function show(el, visible = true) {
  el.classList.toggle('hidden', !visible);
}

/** Copy a canvas/Image region into a fresh canvas (used for sprite portraits in cards). */
export function spriteCanvas(source, sx, sy, sw, sh, size) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  c.className = 'sprite-canvas';
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  if (source) ctx.drawImage(source, sx, sy, sw, sh, 0, 0, size, size);
  return c;
}
