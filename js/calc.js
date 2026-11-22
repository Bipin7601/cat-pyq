/* On-screen calculator modelled on the CAT exam calculator: left-to-right evaluation, memory keys,
   backspace, sign, square root, percent and reciprocal. Pure logic (create/press/keyFor) plus a
   draggable panel (mount) for the browser. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Calc = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const MAX_DIGITS = 16;
  const SYM = {'+': '+', '-': '\u2212', '*': '\u00d7', '/': '\u00f7'};
  const DIV0 = 'Cannot divide by zero', BAD = 'Invalid input';

  function create() {
    return {display: '0', expr: '', acc: null, op: null, fresh: true, pending: false, mem: 0, error: false};
  }
  function fmt(n) {
    if (Object.is(n, -0)) n = 0;
    return String(parseFloat(n.toPrecision(12)));
  }
  function fail(s, msg) { return {...create(), mem: s.mem, display: msg, error: true}; }
  function compute(a, op, b) {
    if (op === '+') return a + b;
    if (op === '-') return a - b;
    if (op === '*') return a * b;
    if (b === 0) return null;
    return a / b;
  }
  // replace the display with a computed value (keeps acc/op; the value becomes the current operand)
  function setValue(s, v) {
    if (v === null || !isFinite(v)) return fail(s, v === null ? DIV0 : BAD);
    return {...s, display: fmt(v), fresh: true, pending: false};
  }

  function press(prev, key) {
    let s = {...prev};
    if (s.error) {
      if (key === 'C') return {...create(), mem: s.mem};
      if (/^[0-9.]$/.test(key)) s = {...create(), mem: s.mem};
      else if (key === 'MC') return {...s, mem: 0};
      else return s;
    }
    const val = parseFloat(s.display);

    if (/^[0-9]$/.test(key) || key === '.') {
      if (s.fresh) {
        s.display = key === '.' ? '0.' : key;
        s.fresh = false; s.pending = false;
        if (s.op === null) s.expr = '';
        return s;
      }
      if (key === '.' && s.display.includes('.')) return s;
      if (s.display.replace(/[-.]/g, '').length >= MAX_DIGITS) return s;
      s.display = s.display === '0' && key !== '.' ? key : s.display + key;
      return s;
    }

    if (key in SYM) {
      if (s.op !== null && s.pending) { s.op = key; s.expr = `${fmt(s.acc)} ${SYM[key]}`; return s; }
      let acc = val;
      if (s.op !== null) {
        acc = compute(s.acc, s.op, val);
        if (acc === null || !isFinite(acc)) return fail(s, acc === null ? DIV0 : BAD);
      }
      return {...s, acc, op: key, display: fmt(acc), expr: `${fmt(acc)} ${SYM[key]}`, fresh: true, pending: true};
    }

    switch (key) {
      case '=': {
        if (s.op === null) return {...s, fresh: true};
        const b = s.pending ? s.acc : val;
        const r = compute(s.acc, s.op, b);
        if (r === null || !isFinite(r)) return fail(s, r === null ? DIV0 : BAD);
        return {...s, display: fmt(r), expr: `${fmt(s.acc)} ${SYM[s.op]} ${fmt(b)} =`,
                acc: null, op: null, fresh: true, pending: false};
      }
      case 'back':
        if (s.fresh) return s;
        s.display = s.display.slice(0, -1);
        if (s.display === '' || s.display === '-') s.display = '0';
        return s;
      case 'C': return {...create(), mem: s.mem};
      case 'neg':
        if (s.display === '0') return s;
        return {...s, display: s.display.startsWith('-') ? s.display.slice(1) : '-' + s.display, pending: false};
      case 'sqrt': return val < 0 ? fail(s, BAD) : setValue(s, Math.sqrt(val));
      case 'inv': return val === 0 ? fail(s, DIV0) : setValue(s, 1 / val);
      case 'pct':
        if (s.op === '+' || s.op === '-') return setValue(s, s.acc * val / 100);
        return setValue(s, val / 100);
      case 'MC': return {...s, mem: 0};
      case 'MR': return {...s, display: fmt(s.mem), fresh: true, pending: false};
      case 'MS': return {...s, mem: val, fresh: true};
      case 'M+': return {...s, mem: parseFloat(fmt(s.mem + val)), fresh: true};
      case 'M-': return {...s, mem: parseFloat(fmt(s.mem - val)), fresh: true};
    }
    return s;
  }

  const KEYMAP = {Enter: '=', '=': '=', x: '*', X: '*', Backspace: 'back', Delete: 'C', '%': 'pct'};
  function keyFor(k) {
    if (/^[0-9.+\-*/]$/.test(k)) return k;
    return KEYMAP[k] || null;
  }

  // ---------- browser panel ----------
  const KEYS = [
    ['MC', 'MC', 'k-mem', 'Memory clear'], ['MR', 'MR', 'k-mem', 'Memory recall'], ['MS', 'MS', 'k-mem', 'Memory store'],
    ['M+', 'M+', 'k-mem', 'Memory add'], ['M-', 'M\u2212', 'k-mem', 'Memory subtract'],
    ['back', '\u232b', 'k-clear k-wide', 'Backspace'], ['C', 'C', 'k-clear', 'Clear'], ['neg', '\u00b1', 'k-fn', 'Change sign'],
    ['sqrt', '\u221a', 'k-fn', 'Square root'],
    ['7'], ['8'], ['9'], ['/', '\u00f7', 'k-op', 'Divide'], ['pct', '%', 'k-fn', 'Percent'],
    ['4'], ['5'], ['6'], ['*', '\u00d7', 'k-op', 'Multiply'], ['inv', '1/x', 'k-fn', 'Reciprocal'],
    ['1'], ['2'], ['3'], ['-', '\u2212', 'k-op', 'Subtract'], ['=', '=', 'k-eq', 'Equals'],
    ['0', '0', 'k-wide'], ['.', '.', '', 'Decimal point'], ['+', '+', 'k-op', 'Add'],
  ];
  const POS_KEY = 'catpyq.calc.pos';
  const store = {
    get() { try { return JSON.parse(localStorage.getItem(POS_KEY)); } catch (e) { return null; } },
    set(v) { try { localStorage.setItem(POS_KEY, JSON.stringify(v)); } catch (e) { /* storage blocked */ } },
  };

  function mount(toggle) {
    let state = create();
    const panel = document.createElement('section');
    panel.className = 'calc'; panel.id = 'calc'; panel.hidden = true; panel.tabIndex = -1;
    panel.setAttribute('aria-label', 'Calculator');
    panel.innerHTML =
      '<div class="calc-head"><span>Calculator</span>' +
      '<button type="button" class="calc-x" data-calc="close" aria-label="Close calculator">\u00d7</button></div>' +
      '<div class="calc-screen"><div class="calc-expr" id="calc-expr"></div>' +
      '<div class="calc-line"><span class="calc-mem" id="calc-mem" title="Memory in use"></span>' +
      '<output class="calc-val" id="calc-val" aria-live="polite">0</output></div></div>' +
      '<div class="calc-keys">' + KEYS.map(([k, label, cls, aria]) =>
        `<button type="button" data-key="${k}" class="${cls || ''}"${aria ? ` aria-label="${aria}"` : ''}>${label || k}</button>`).join('') +
      '</div>';
    document.body.appendChild(panel);
    const $ = id => panel.querySelector('#' + id);

    function render() {
      const v = $('calc-val');
      v.textContent = state.display;
      v.classList.toggle('err', state.error);
      v.classList.toggle('long', !state.error && state.display.length > 11);
      $('calc-expr').textContent = state.expr || ' ';
      $('calc-mem').textContent = state.mem !== 0 ? 'M' : '';
    }
    function key(k) { state = press(state, k); render(); }

    function clamp(x, y) {
      const w = panel.offsetWidth, h = panel.offsetHeight;
      return {x: Math.max(8, Math.min(x, innerWidth - w - 8)), y: Math.max(8, Math.min(y, innerHeight - h - 8))};
    }
    function place(x, y) { const p = clamp(x, y); panel.style.left = p.x + 'px'; panel.style.top = p.y + 'px'; return p; }

    function open() {
      panel.hidden = false;
      const saved = store.get();
      if (saved && isFinite(saved.x) && isFinite(saved.y)) place(saved.x, saved.y);
      else place(innerWidth - panel.offsetWidth - (innerWidth > 1000 ? 320 : 24), 132); // clear of the test palette
      toggle.setAttribute('aria-pressed', 'true');
      panel.focus({preventScroll: true});
    }
    function close() { panel.hidden = true; toggle.setAttribute('aria-pressed', 'false'); toggle.focus({preventScroll: true}); }

    toggle.setAttribute('aria-pressed', 'false');
    toggle.setAttribute('aria-controls', 'calc');
    toggle.addEventListener('click', () => (panel.hidden ? open() : close()));
    panel.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.calc === 'close') return close();
      if (b.dataset.key) key(b.dataset.key);
    });
    panel.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); return close(); }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('button')) return; // activate the focused key
      const k = keyFor(e.key);
      if (k) { e.preventDefault(); key(k); }
    });

    // drag by the title bar (mouse, pen and touch)
    const head = panel.querySelector('.calc-head');
    let drag = null;
    head.addEventListener('pointerdown', e => {
      if (e.target.closest('button') || e.button > 0) return;
      const r = panel.getBoundingClientRect();
      drag = {dx: e.clientX - r.left, dy: e.clientY - r.top, id: e.pointerId};
      head.setPointerCapture(e.pointerId); panel.classList.add('dragging'); e.preventDefault();
    });
    head.addEventListener('pointermove', e => { if (drag && e.pointerId === drag.id) place(e.clientX - drag.dx, e.clientY - drag.dy); });
    const end = e => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null; panel.classList.remove('dragging');
      store.set({x: parseFloat(panel.style.left), y: parseFloat(panel.style.top)});
    };
    head.addEventListener('pointerup', end); head.addEventListener('pointercancel', end);
    addEventListener('resize', () => { if (!panel.hidden) place(parseFloat(panel.style.left), parseFloat(panel.style.top)); });

    render();
    return {open, close, panel};
  }

  return {create, press, keyFor, mount};
});
