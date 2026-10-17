/**
 * DemoForge stage — the in-page overlay script.
 *
 * Installed as an init script so it survives navigations. It owns a fixed,
 * pointer-events:none layer inside a closed shadow root (isolated from app
 * CSS) and exposes `window.__dfStage` for the renderer to drive: an animated
 * cursor, click ripples, a spotlight, callout labels, and zoom.
 *
 * The zoom transform is applied to <body>; the stage hangs off
 * <html>, so the cursor and overlays are never scaled with the content.
 */

export const STAGE_SCRIPT = String.raw`(() => {
  if (window.__dfStage) return;

  const POS_KEY = '__df_cursor_pos';
  let root = null;
  let shadow = null;
  let cursor = null;
  let spot = null;
  let callout = null;
  let pos = (() => {
    try { return JSON.parse(sessionStorage.getItem(POS_KEY)) || null; } catch (e) { return null; }
  })() || { x: Math.round(innerWidth * 0.5), y: Math.round(innerHeight * 0.6) };
  let cursorEnabled = true;
  let hidden = false;

  const CSS = [
    ':host { all: initial; }',
    '.layer { position: fixed; inset: 0; pointer-events: none; z-index: 2147483647; overflow: hidden; }',
    '.cursor { position: absolute; left: 0; top: 0; width: 26px; height: 26px; will-change: transform;',
    '  filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); transition: opacity .2s; }',
    '.cursor svg { width: 100%; height: 100%; transition: transform .12s ease-out; transform-origin: 3px 2px; }',
    '.cursor.down svg { transform: scale(.82); }',
    '.ripple { position: absolute; width: 14px; height: 14px; margin: -7px 0 0 -7px; border-radius: 50%;',
    '  border: 3px solid rgba(59,130,246,.9); background: rgba(59,130,246,.25); animation: df-ripple .55s ease-out forwards; }',
    '@keyframes df-ripple { to { transform: scale(4.2); opacity: 0; } }',
    '.spot { position: absolute; border-radius: 10px; opacity: 0;',
    '  box-shadow: 0 0 0 4px rgba(251,191,36,.95), 0 0 0 9999px rgba(15,23,42,.45);',
    '  transition: opacity .35s ease, left .35s ease, top .35s ease, width .35s ease, height .35s ease; }',
    '.spot.ring { box-shadow: 0 0 0 4px rgba(251,191,36,.95), 0 0 18px 6px rgba(251,191,36,.45); }',
    '.spot.on { opacity: 1; }',
    '.callout { position: absolute; max-width: 360px; padding: 9px 14px; border-radius: 10px;',
    '  background: #0f172a; color: #f8fafc; font: 600 15px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif;',
    '  box-shadow: 0 10px 30px rgba(0,0,0,.35); opacity: 0; transform: translateY(6px);',
    '  transition: opacity .3s ease, transform .3s ease; }',
    '.callout.on { opacity: 1; transform: translateY(0); }',
    '.callout::after { content: ""; position: absolute; left: var(--arrow-x, 24px); width: 12px; height: 12px;',
    '  background: #0f172a; transform: rotate(45deg); }',
    '.callout.below::after { top: -6px; }',
    '.callout.above::after { bottom: -6px; }',
  ].join('\n');

  const CURSOR_SVG =
    '<svg viewBox="0 0 26 26" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M3 2 L3 21 L8.2 16.4 L11.6 24 L15 22.5 L11.7 15.1 L18.6 15.1 Z" fill="#111827" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/>' +
    '</svg>';

  function ensure() {
    if (root && root.isConnected) return true;
    if (!document.documentElement) return false;
    root = document.createElement('demoforge-stage');
    shadow = root.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = CSS;
    const layer = document.createElement('div');
    layer.className = 'layer';
    cursor = document.createElement('div');
    cursor.className = 'cursor';
    cursor.innerHTML = CURSOR_SVG;
    spot = document.createElement('div');
    spot.className = 'spot';
    callout = document.createElement('div');
    callout.className = 'callout';
    layer.append(spot, callout, cursor);
    shadow.append(style, layer);
    document.documentElement.appendChild(root);
    place();
    return true;
  }

  function place() {
    if (!cursor) return;
    cursor.style.transform = 'translate(' + pos.x + 'px,' + pos.y + 'px)';
    cursor.style.opacity = cursorEnabled && !hidden ? '1' : '0';
  }

  function save() {
    try { sessionStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch (e) {}
  }

  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function moveTo(x, y, ms) {
    ensure();
    const from = { x: pos.x, y: pos.y };
    const dx = x - from.x;
    const dy = y - from.y;
    // Bow the path slightly so motion reads as a hand, not a robot.
    const bow = Math.min(80, Math.hypot(dx, dy) * 0.12);
    const cx = from.x + dx / 2 - (dy / (Math.hypot(dx, dy) || 1)) * bow;
    const cy = from.y + dy / 2 + (dx / (Math.hypot(dx, dy) || 1)) * bow;
    const start = performance.now();
    return new Promise((resolve) => {
      function frame(now) {
        const t = Math.min(1, (now - start) / Math.max(1, ms));
        const e = ease(t);
        const u = 1 - e;
        pos = {
          x: u * u * from.x + 2 * u * e * cx + e * e * x,
          y: u * u * from.y + 2 * u * e * cy + e * e * y,
        };
        place();
        if (t < 1) requestAnimationFrame(frame);
        else { pos = { x, y }; place(); save(); resolve(); }
      }
      requestAnimationFrame(frame);
    });
  }

  async function click() {
    ensure();
    cursor.classList.add('down');
    const r = document.createElement('div');
    r.className = 'ripple';
    r.style.left = pos.x + 'px';
    r.style.top = pos.y + 'px';
    cursor.parentNode.insertBefore(r, cursor);
    setTimeout(() => r.remove(), 700);
    await sleep(110);
    cursor.classList.remove('down');
  }

  function spotlight(rect, opts) {
    ensure();
    const pad = (opts && opts.pad) || 6;
    spot.className = 'spot' + (opts && opts.dim === false ? ' ring' : '');
    spot.style.left = rect.x - pad + 'px';
    spot.style.top = rect.y - pad + 'px';
    spot.style.width = rect.width + pad * 2 + 'px';
    spot.style.height = rect.height + pad * 2 + 'px';
    void spot.offsetWidth;
    spot.classList.add('on');
  }

  function showCallout(rect, text) {
    ensure();
    callout.textContent = text;
    callout.className = 'callout';
    callout.style.left = '0px';
    callout.style.top = '0px';
    const w = callout.offsetWidth;
    const h = callout.offsetHeight;
    const gap = 16;
    const below = rect.y + rect.height + gap + h < innerHeight - 8;
    const top = below ? rect.y + rect.height + gap : Math.max(8, rect.y - gap - h);
    const left = Math.min(Math.max(8, rect.x + rect.width / 2 - 28), innerWidth - w - 8);
    const arrowX = Math.min(Math.max(14, rect.x + rect.width / 2 - left - 6), w - 26);
    callout.classList.add(below ? 'below' : 'above');
    callout.style.left = left + 'px';
    callout.style.top = top + 'px';
    callout.style.setProperty('--arrow-x', arrowX + 'px');
    void callout.offsetWidth;
    callout.classList.add('on');
  }

  async function clear() {
    if (!ensure()) return;
    spot.classList.remove('on');
    callout.classList.remove('on');
    await sleep(320);
  }

  async function zoom(rect, scale, ms) {
    const body = document.body;
    if (!body) return;
    body.style.transition = 'transform ' + ms + 'ms cubic-bezier(.4,0,.2,1)';
    if (!rect || scale <= 1) {
      body.style.transform = '';
    } else {
      const ox = rect.x + rect.width / 2 + scrollX;
      const oy = rect.y + rect.height / 2 + scrollY;
      body.style.transformOrigin = ox + 'px ' + oy + 'px';
      body.style.transform = 'scale(' + scale + ')';
    }
    await sleep(ms);
  }

  function setCursorEnabled(on) { cursorEnabled = !!on; ensure(); place(); }
  function setHidden(on) {
    hidden = !!on;
    if (!ensure()) return;
    place();
    shadow.querySelector('.layer').style.visibility = hidden ? 'hidden' : 'visible';
  }

  window.__dfStage = {
    ensure, moveTo, click, spotlight, callout: showCallout, clear, zoom,
    setCursorEnabled, setHidden,
    get pos() { return { x: pos.x, y: pos.y }; },
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensure, { once: true });
  } else {
    ensure();
  }
})();`;
