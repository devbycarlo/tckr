'use strict';
// Network-free regression tests for the inline timer script in index.html.
// Runs the real page script inside a vm context with a minimal DOM stub.
// Run: npm test  (node --test tests/)

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const SCRIPT = HTML.match(/<script>([\s\S]*?)<\/script>/)[1];

function makeTarget(extra = {}) {
  const listeners = new Map();
  return Object.assign({
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    dispatchEvent(type, event = {}) {
      if (!event.preventDefault) event.preventDefault = () => {};
      for (const fn of listeners.get(type) || []) fn(event);
    },
  }, extra);
}

function makeClassList() {
  const set = new Set();
  return {
    add: (c) => set.add(c),
    remove: (c) => set.delete(c),
    contains: (c) => set.has(c),
  };
}

function audioParam() {
  return {
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
  };
}

class FakeAudioContext {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
    this.destination = {};
  }
  resume() {}
  createOscillator() {
    return { type: '', frequency: audioParam(), connect() {}, start() {}, stop() {} };
  }
  createGain() {
    return { gain: audioParam(), connect() {} };
  }
}

function buildEnv() {
  let display;
  const document = makeTarget({
    activeElement: null,
    visibilityState: 'visible',
    body: { style: {} },
    getElementById: (id) => (id === 'display' ? display : null),
    createTextNode: (text) => ({ textContent: text }),
  });
  display = makeTarget({
    textContent: '05:00',
    classList: makeClassList(),
    firstChild: null,
    appendChild(node) { this.firstChild = node; return node; },
    focus() { document.activeElement = display; display.dispatchEvent('focus'); },
    blur() { document.activeElement = document.body; display.dispatchEvent('blur'); },
  });
  document.activeElement = document.body;

  const window = makeTarget({
    AudioContext: FakeAudioContext,
    getSelection: () => ({ rangeCount: 0, removeAllRanges() {}, addRange() {} }),
  });

  // Deterministic fake clock: no real waiting, no drift.
  const intervals = new Map();
  let nextId = 1;
  const sandbox = {
    window,
    document,
    navigator: {}, // no wakeLock / serviceWorker -> those paths stay inert
    console: { debug() {}, log() {}, warn() {}, error() {} },
    setInterval(fn) { const id = nextId++; intervals.set(id, fn); return id; },
    clearInterval(id) { intervals.delete(id); },
  };
  sandbox.__tick = (n = 1) => {
    for (let i = 0; i < n; i++) {
      for (const fn of [...intervals.values()]) fn();
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(SCRIPT, sandbox);

  return {
    display,
    document,
    tick: sandbox.__tick,
    get: (expr) => vm.runInContext(expr, sandbox),
  };
}

// Simulates the real event order of a mouse click outside the display:
// pointerdown -> blur (focus moves) -> click.
function clickOutside(env) {
  env.document.dispatchEvent('pointerdown');
  env.display.blur();
  env.document.dispatchEvent('click');
}

test('regression: clicking away after an edit commits the time and keeps the timer running', () => {
  const env = buildEnv();
  env.display.focus();
  env.display.textContent = '00:10';
  clickOutside(env);
  assert.notStrictEqual(env.get('timerId'), null, 'timer must survive the click that committed the edit');
  env.tick(3);
  assert.strictEqual(env.get('remainingSeconds'), 7);
  assert.strictEqual(env.display.textContent, '00:07');
});

test('a click while running (not editing) still pauses the timer', () => {
  const env = buildEnv();
  env.display.focus();
  env.display.textContent = '00:10';
  clickOutside(env); // commit + start
  env.tick(2);
  assert.strictEqual(env.get('remainingSeconds'), 8);
  env.document.dispatchEvent('pointerdown');
  env.document.dispatchEvent('click');
  assert.strictEqual(env.get('timerId'), null);
  assert.strictEqual(env.get('remainingSeconds'), 8, 'pause must preserve remaining time');
});

test('a stale edit-commit flag self-heals on the next pointerdown', () => {
  const env = buildEnv();
  env.display.focus();
  env.display.textContent = '00:10';
  // pointerdown while editing, but the gesture never produces a click (drag away)
  env.document.dispatchEvent('pointerdown');
  env.display.blur();
  assert.notStrictEqual(env.get('timerId'), null);
  // Later unrelated click must pause normally
  env.document.dispatchEvent('pointerdown');
  env.document.dispatchEvent('click');
  assert.strictEqual(env.get('timerId'), null);
});

test('Enter commits the edit and starts the timer', () => {
  const env = buildEnv();
  env.display.focus();
  env.display.textContent = '00:05';
  env.display.dispatchEvent('keydown', { key: 'Enter' });
  assert.notStrictEqual(env.get('timerId'), null);
  assert.strictEqual(env.get('editing'), false);
});

test('countdown reaches zero: stops, shows 00:00, raises the alarm', () => {
  const env = buildEnv();
  env.display.focus();
  env.display.textContent = '00:02';
  env.display.dispatchEvent('keydown', { key: 'Enter' });
  env.tick(2);
  assert.strictEqual(env.get('remainingSeconds'), 0);
  assert.strictEqual(env.get('timerId'), null);
  assert.strictEqual(env.display.textContent, '00:00');
  assert.ok(env.display.classList.contains('alarm-active'));
  assert.strictEqual(env.document.body.style.backgroundColor, 'hsl(0, 45%, 17%)');
});

test('Space toggles start/pause when the display is not focused', () => {
  const env = buildEnv();
  env.document.dispatchEvent('keydown', { code: 'Space', repeat: false });
  assert.notStrictEqual(env.get('timerId'), null);
  env.document.dispatchEvent('keydown', { code: 'Space', repeat: false });
  assert.strictEqual(env.get('timerId'), null);
});

test('Space is ignored while editing the display', () => {
  const env = buildEnv();
  env.display.focus();
  env.document.dispatchEvent('keydown', { code: 'Space', repeat: false });
  assert.strictEqual(env.get('timerId'), null);
});

test('parseTime validates MM:SS bounds', () => {
  const env = buildEnv();
  assert.strictEqual(env.get("parseTime('05:00')"), 300);
  assert.strictEqual(env.get("parseTime('999:59')"), 999 * 60 + 59);
  assert.strictEqual(env.get("parseTime('00:60')"), null);
  assert.strictEqual(env.get("parseTime('1000:00')"), null);
  assert.strictEqual(env.get("parseTime('00:00')"), null);
  assert.strictEqual(env.get("parseTime('abc')"), null);
  assert.strictEqual(env.get("parseTime('5:00')"), 300);
  assert.strictEqual(env.get("parseTime('0:01')"), 1);
});
