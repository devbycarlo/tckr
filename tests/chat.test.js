'use strict';
// Network-free tests for the chat box + natural-language timer parser.
// Runs the real page script inside a vm context with a minimal DOM stub.
// Run: npm test  (node --test, auto-discovers tests/)

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
      if (!event.stopPropagation) event.stopPropagation = () => {};
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

// A Date subclass pinned to a fixed instant so deadline math is deterministic.
function fixedDateClass(iso) {
  const RealDate = Date;
  return class FixedDate extends RealDate {
    constructor(...args) {
      if (args.length) super(...args);
      else super(iso);
    }
    static now() { return new RealDate(iso).getTime(); }
  };
}

function buildEnv({ fixedNow = null, fetchImpl = null } = {}) {
  let display;
  const elements = {};
  const document = makeTarget({
    activeElement: null,
    visibilityState: 'visible',
    body: { style: {} },
    getElementById: (id) => elements[id] || null,
    createTextNode: (text) => ({ textContent: text }),
    createElement: () => makeTarget({ textContent: '', className: '', classList: makeClassList(), setAttribute() {} }),
  });
  display = makeTarget({
    textContent: '05:00',
    classList: makeClassList(),
    firstChild: null,
    appendChild(node) { this.firstChild = node; return node; },
    focus() { document.activeElement = display; display.dispatchEvent('focus'); },
    blur() { document.activeElement = document.body; display.dispatchEvent('blur'); },
  });
  const chatInput = makeTarget({
    value: '',
    focus() { document.activeElement = chatInput; chatInput.dispatchEvent('focus'); },
    blur() { document.activeElement = document.body; chatInput.dispatchEvent('blur'); },
  });
  const chatLog = makeTarget({
    children: [],
    scrollTop: 0,
    scrollHeight: 0,
    appendChild(node) { this.children.push(node); return node; },
    prepend(node) { this.children = [node, ...this.children.filter((c) => c !== node)]; return node; },
    removeChild(node) { this.children = this.children.filter((c) => c !== node); },
  });
  const chatForm = makeTarget({});
  const queue = makeTarget({ innerHTML: '' });
  const timerLabel = makeTarget({ textContent: '' });
  Object.assign(elements, { display, chatInput, chatLog, chatForm, queue, timerLabel, chat: makeTarget({}) });
  document.activeElement = document.body;

  const window = makeTarget({
    AudioContext: FakeAudioContext,
    getSelection: () => ({ rangeCount: 0, removeAllRanges() {}, addRange() {} }),
  });

  const intervals = new Map();
  let nextId = 1;
  const sandbox = {
    window,
    document,
    navigator: {},
    console: { debug() {}, log() {}, warn() {}, error() {} },
    setInterval(fn) { const id = nextId++; intervals.set(id, fn); return id; },
    clearInterval(id) { intervals.delete(id); },
  };
  const storage = new Map();
  sandbox.localStorage = {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  };
  const timeouts = new Map();
  sandbox.setTimeout = (fn, ms) => { const id = nextId++; timeouts.set(id, { fn, ms }); return id; };
  sandbox.clearTimeout = (id) => timeouts.delete(id);
  sandbox.AbortController = class {
    constructor() {
      const listeners = [];
      this.signal = { aborted: false, addEventListener: (t, fn) => { if (t === 'abort') listeners.push(fn); } };
      this.abort = () => { this.signal.aborted = true; listeners.forEach((fn) => fn()); };
    }
  };
  if (fetchImpl) sandbox.fetch = fetchImpl;
  if (fixedNow) sandbox.Date = fixedDateClass(fixedNow);
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
    chatInput,
    chatLog,
    chatForm,
    queue,
    timerLabel,
    tick: sandbox.__tick,
    get: (expr) => vm.runInContext(expr, sandbox),
    submit(text) {
      chatInput.value = text;
      chatForm.dispatchEvent('submit');
    },
    agentMessages: () => chatLog.children.filter((c) => c.className === 'msg agent').map((c) => c.textContent),
    storage,
    fireTimeouts() { for (const { fn } of [...timeouts.values()]) fn(); },
    async drain() {
      for (let i = 0; i < 12; i++) await Promise.resolve();
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
    },
  };
}

const NOW = new Date('2026-11-19T18:15:00'); // 6:15 PM local

function parse(env, text, now = NOW) {
  return env.get(`parseChat(${JSON.stringify(text)}, new Date(${now.getTime()}))`);
}

// ---------- Parser: single intent ----------

test('parser: explicit mm:ss duration with a known food label', () => {
  const env = buildEnv();
  const r = parse(env, 'eggs 6:30');
  assert.ok(!r.error, r.error);
  assert.strictEqual(r.timers.length, 1);
  assert.strictEqual(r.timers[0].label, 'Eggs');
  assert.strictEqual(r.timers[0].seconds, 390);
  assert.strictEqual(r.timers[0].startIn, 0);
});

test('parser: "Soft-boiled eggs from cold water" uses knowledge default 6m30s + ice-bath tip', () => {
  const env = buildEnv();
  const r = parse(env, 'Soft-boiled eggs from cold water');
  assert.ok(!r.error, r.error);
  assert.strictEqual(r.timers.length, 1);
  assert.strictEqual(r.timers[0].label, 'Eggs');
  assert.strictEqual(r.timers[0].seconds, 390);
  assert.match(r.timers[0].tip, /ice bath/i);
  assert.match(r.reply, /ice bath/i);
});

test('parser: explicit duration overrides the knowledge default but keeps the tip', () => {
  const env = buildEnv();
  const r = parse(env, 'hard-boiled eggs 12 minutes');
  assert.strictEqual(r.timers[0].seconds, 720);
  assert.match(r.timers[0].tip, /ice bath|peel/i);
});

test('parser: "Remind me to check the laundry in 35 minutes" -> 35m Laundry, starts now', () => {
  const env = buildEnv();
  const r = parse(env, 'Remind me to check the laundry in 35 minutes');
  assert.ok(!r.error, r.error);
  assert.strictEqual(r.timers.length, 1);
  assert.strictEqual(r.timers[0].label, 'Laundry');
  assert.strictEqual(r.timers[0].seconds, 2100);
  assert.strictEqual(r.timers[0].startIn, 0);
});

test('parser: mixed units "1.5 hours roast chicken" -> 5400s Chicken', () => {
  const env = buildEnv();
  const r = parse(env, '1.5 hours roast chicken');
  assert.strictEqual(r.timers[0].seconds, 5400);
  assert.strictEqual(r.timers[0].label, 'Chicken');
});

test('parser: "Timer until 3:15 PM" computes the delta against the clock', () => {
  const env = buildEnv();
  const now = new Date('2026-11-19T14:00:00'); // 2:00 PM
  const r = parse(env, 'Timer until 3:15 PM', now);
  assert.ok(!r.error, r.error);
  assert.strictEqual(r.timers.length, 1);
  assert.strictEqual(r.timers[0].seconds, 4500);
  assert.strictEqual(r.timers[0].startIn, 0);
});

test('parser: 24h clock "timer until 19:00"', () => {
  const env = buildEnv();
  const r = parse(env, 'timer until 19:00');
  assert.strictEqual(r.timers[0].seconds, 2700);
});

test('parser: a past deadline rolls to tomorrow and says so', () => {
  const env = buildEnv();
  const r = parse(env, 'laundry until 6:00 AM'); // now 6:15 PM
  assert.strictEqual(r.timers[0].seconds, 11 * 3600 + 45 * 60);
  assert.match(r.reply, /tomorrow/i);
});

test('parser: no duration and no deadline -> helpful error', () => {
  const env = buildEnv();
  const r = parse(env, 'hello there');
  assert.ok(r.error);
  assert.match(r.error, /duration/i);
});

// ---------- Parser: multi-timer orchestration ----------

test('parser: chicken/asparagus finishing at 7:00 PM staggers the starts', () => {
  const env = buildEnv();
  const r = parse(env, 'Roast chicken takes 45 mins, asparagus takes 12 mins, everything needs to finish at 7:00 PM');
  assert.ok(!r.error, r.error);
  assert.strictEqual(r.timers.length, 2);
  const [chicken, asparagus] = r.timers;
  assert.strictEqual(chicken.label, 'Chicken');
  assert.strictEqual(chicken.seconds, 2700);
  assert.strictEqual(chicken.startIn, 0);
  assert.strictEqual(asparagus.label, 'Asparagus');
  assert.strictEqual(asparagus.seconds, 720);
  assert.strictEqual(asparagus.startIn, 1980); // 33 minutes later
  assert.match(r.reply, /7:00 PM/);
});

test('parser: impossible deadline warns instead of silently finishing late', () => {
  const env = buildEnv();
  const now = new Date('2026-11-19T18:50:00'); // only 10m until 7 PM
  const r = parse(env, 'Roast chicken takes 45 mins, asparagus takes 12 mins, everything needs to finish at 7:00 PM', now);
  assert.ok(!r.error, r.error);
  const chicken = r.timers.find((t) => t.label === 'Chicken');
  assert.strictEqual(chicken.startIn, 0);
  assert.match(r.reply, /won't make the deadline/i);
});

test('parser: multiple timers without a deadline all start now', () => {
  const env = buildEnv();
  const r = parse(env, 'pasta 10 minutes and tea 3 minutes');
  assert.strictEqual(r.timers.length, 2);
  // JSON round-trip normalizes vm-realm arrays so deepStrictEqual compares values, not prototypes.
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r.timers.map((t) => [t.label, t.seconds, t.startIn]))), [
    ['Pasta', 600, 0],
    ['Tea', 180, 0],
  ]);
});

test('parser: single duration + deadline starts it late enough to finish on time', () => {
  const env = buildEnv();
  const r = parse(env, 'tea finish at 6:20 PM'); // delta 300s, tea 180s
  assert.strictEqual(r.timers.length, 1);
  assert.strictEqual(r.timers[0].seconds, 180);
  assert.strictEqual(r.timers[0].startIn, 120);
});

// ---------- Chat UI + scheduler engine ----------

test('chat: submitting a single intent sets the label, starts the timer, and replies', () => {
  const env = buildEnv();
  env.submit('Remind me to check the laundry in 35 minutes');
  assert.strictEqual(env.get('remainingSeconds'), 2100);
  assert.strictEqual(env.get('primaryLabel'), 'Laundry');
  assert.strictEqual(env.timerLabel.textContent, 'Laundry');
  assert.notStrictEqual(env.get('timerId'), null);
  const msgs = env.agentMessages();
  assert.strictEqual(msgs.length, 1);
  assert.match(msgs[0], /Laundry/);
  assert.strictEqual(env.chatInput.value, '', 'input clears after submit');
});

test('chat: orchestration queues the second timer and both finish together', () => {
  const env = buildEnv({ fixedNow: '2026-11-19T18:15:00' });
  env.submit('Roast chicken takes 45 mins, asparagus takes 12 mins, everything needs to finish at 7:00 PM');
  assert.strictEqual(env.get('remainingSeconds'), 2700);
  assert.strictEqual(env.get('primaryLabel'), 'Chicken');
  assert.strictEqual(env.get('chatTimers.length'), 1);
  assert.strictEqual(env.get('chatTimers[0].state'), 'queued');
  assert.strictEqual(env.get('chatTimers[0].delay'), 1980);
  assert.match(env.queue.innerHTML, /Asparagus/);
  env.tick(1980); // 33 minutes later the asparagus starts
  assert.strictEqual(env.get('remainingSeconds'), 720);
  assert.strictEqual(env.get('chatTimers[0].state'), 'running');
  assert.strictEqual(env.get('chatTimers[0].remaining'), 720);
  env.tick(720); // both hit zero on the same tick
  assert.strictEqual(env.get('remainingSeconds'), 0);
  assert.strictEqual(env.get('timerId'), null);
  assert.ok(env.display.classList.contains('alarm-active'));
  assert.match(env.queue.innerHTML, /done/i);
});

test('chat: a delayed timer auto-promotes into the idle display when its start arrives', () => {
  const env = buildEnv({ fixedNow: '2026-11-19T18:15:00' });
  env.submit('tea finish at 6:20 PM'); // starts in 120s
  assert.strictEqual(env.get('remainingSeconds'), 0);
  assert.notStrictEqual(env.get('timerId'), null, 'scheduler must run while a timer is queued');
  env.tick(120);
  assert.strictEqual(env.get('primaryLabel'), 'Tea');
  assert.strictEqual(env.get('remainingSeconds'), 180);
  assert.strictEqual(env.get('chatTimers.length'), 0);
  env.tick(180);
  assert.strictEqual(env.get('remainingSeconds'), 0);
  assert.strictEqual(env.get('timerId'), null);
});

test('chat: parallel timers count down independently; clicking a chip focuses it', () => {
  const env = buildEnv();
  env.submit('pasta 10 seconds and rice 6 seconds');
  assert.strictEqual(env.get('remainingSeconds'), 10);
  assert.strictEqual(env.get('primaryLabel'), 'Pasta');
  env.tick(2);
  assert.strictEqual(env.get('remainingSeconds'), 8);
  assert.strictEqual(env.get('chatTimers[0].remaining'), 4);
  const id = env.get('chatTimers[0].id');
  env.queue.dispatchEvent('click', {
    target: { closest: (sel) => (sel === '.chip' ? { dataset: { id: String(id) } } : null) },
  });
  assert.strictEqual(env.get('primaryLabel'), 'Rice');
  assert.strictEqual(env.get('remainingSeconds'), 4);
  assert.match(env.queue.innerHTML, /Pasta/);
  assert.notStrictEqual(env.get('timerId'), null, 'focusing a chip must not pause the timer');
});

test('chat: a new command replaces the previous schedule', () => {
  const env = buildEnv();
  env.submit('pasta 10 minutes and tea 3 minutes');
  env.submit('eggs 6:30');
  assert.strictEqual(env.get('chatTimers.length'), 0);
  assert.strictEqual(env.get('remainingSeconds'), 390);
  assert.strictEqual(env.get('primaryLabel'), 'Eggs');
});

test('chat: unparseable input replies with an error and leaves the timer alone', () => {
  const env = buildEnv();
  env.submit('hello there');
  assert.strictEqual(env.get('timerId'), null);
  assert.strictEqual(env.get('remainingSeconds'), 300);
  assert.match(env.agentMessages()[0], /duration/i);
});

test('Space is ignored while the chat input is focused', () => {
  const env = buildEnv();
  env.display.focus();
  env.display.textContent = '00:10';
  env.display.dispatchEvent('keydown', { key: 'Enter' });
  assert.notStrictEqual(env.get('timerId'), null);
  env.chatInput.focus();
  env.document.dispatchEvent('keydown', { code: 'Space', repeat: false });
  assert.notStrictEqual(env.get('timerId'), null, 'typing a space in chat must not pause the timer');
});

test('clicking inside the chat panel does not pause the timer', () => {
  const env = buildEnv();
  env.display.focus();
  env.display.textContent = '00:10';
  env.display.dispatchEvent('keydown', { key: 'Enter' });
  env.document.dispatchEvent('pointerdown');
  env.document.dispatchEvent('click', {
    target: { closest: (sel) => (sel.includes('#chat') ? {} : null) },
  });
  assert.notStrictEqual(env.get('timerId'), null);
});

// ---------- external agent fallback (webhook / URL trigger) ----------

test('agent: unknown request with a connected agent POSTs the exact request and applies the reply', async () => {
  const calls = [];
  const env = buildEnv({
    fetchImpl: async (url, opts) => {
      calls.push({ url, opts });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ label: 'Brisket', duration: '12 minutes', tip: 'Rest 10 minutes before slicing.' }),
      };
    },
  });
  env.submit('/agent https://agent.example.com/timer');
  env.submit('brisket');
  await env.drain();
  assert.equal(calls.length, 1, 'the typed request was sent to the agent endpoint');
  assert.equal(calls[0].url, 'https://agent.example.com/timer');
  assert.equal(JSON.parse(calls[0].opts.body).request, 'brisket');
  assert.equal(env.get('remainingSeconds'), 720);
  assert.equal(env.get('primaryLabel'), 'Brisket');
  assert.match(env.agentMessages().join('\n'), /external agent/i);
  assert.match(env.agentMessages().join('\n'), /Rest 10 minutes before slicing/i, 'tip must be shown to the user');
});

test('agent: built-in AI is used by default, with no webhook setup', async () => {
  const calls = [];
  const env = buildEnv({
    fetchImpl: async (url, opts) => {
      calls.push({ url, opts });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ label: 'Brisket', duration: '8 hours', tip: 'Rest before slicing.' }) } }],
        }),
      };
    },
  });
  env.submit('brisket');
  await env.drain();
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /text\.pollinations\.ai/);
  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.stream, false);
  assert.match(body.messages[0].content, /JSON object/);
  assert.equal(body.messages[1].content, 'brisket');
  assert.equal(env.get('remainingSeconds'), 28800);
  assert.equal(env.get('primaryLabel'), 'Brisket');
  assert.match(env.agentMessages().join('\n'), /Rest before slicing/i, 'the AI tip must reach the user');
});

test('agent: duration lookup happens in the background with no "No duration found" bubble', async () => {
  const env = buildEnv({ fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{"seconds":720}' }) });
  env.submit('water');
  await env.drain();
  const msgs = env.agentMessages().join('\n');
  assert.doesNotMatch(msgs, /No duration found/i);
  assert.doesNotMatch(msgs, /asking the/i);
  assert.equal(env.get('remainingSeconds'), 720);
});

test('agent: /agent off disables the built-in AI and keeps the local error', async () => {
  let calls = 0;
  const env = buildEnv({ fetchImpl: async () => { calls++; return { ok: true, text: async () => '{"seconds":720}' }; } });
  env.submit('/agent off');
  env.submit('brisket');
  await env.drain();
  assert.equal(calls, 0);
  assert.equal(env.get('remainingSeconds'), 300);
  assert.match(env.agentMessages().join('\n'), /duration/i);
});

test('agent: a 402 on the built-in AI fails over to the second provider', async () => {
  const urls = [];
  const env = buildEnv({
    fetchImpl: async (url) => {
      urls.push(url);
      if (/pollinations/.test(url)) return { ok: false, status: 402 };
      return { ok: true, status: 200, text: async () => '{"label":"Brisket","seconds":28800}' };
    },
  });
  env.submit('brisket');
  await env.drain();
  assert.equal(urls.length, 2);
  assert.match(urls[1], /apillmfree/);
  assert.equal(env.get('remainingSeconds'), 28800);
  assert.equal(env.get('primaryLabel'), 'Brisket');
  assert.doesNotMatch(env.agentMessages().join('\n'), /rate-limited/i);
});

test('agent: successful lookups are cached so repeats make no network calls', async () => {
  let calls = 0;
  const env = buildEnv({
    fetchImpl: async () => {
      calls++;
      return { ok: true, status: 200, text: async () => '{"seconds":720,"label":"Brisket"}' };
    },
  });
  env.submit('brisket');
  await env.drain();
  env.submit('BRISKET');
  await env.drain();
  assert.equal(calls, 1);
  assert.equal(env.get('remainingSeconds'), 720);
});

test('agent: when every built-in provider fails the message is actionable, not a rate-limit dead end', async () => {
  const env = buildEnv({ fetchImpl: async () => ({ ok: false, status: 402 }) });
  env.submit('brisket');
  await env.drain();
  assert.equal(env.get('remainingSeconds'), 300);
  assert.equal(env.get('timerId'), null);
  const msg = env.agentMessages().join('\n');
  assert.doesNotMatch(msg, /rate-limited/i);
  assert.doesNotMatch(msg, /try again in a minute/i);
  assert.match(msg, /10 minutes/);
});

function normalize(env, data, request = 'brisket') {
  return env.get('normalizeAgentReply(' + JSON.stringify(data) + ', ' + JSON.stringify(request) + ')');
}

test('agent reply: numeric seconds, duration string, timers array, plain text, MCP content, fenced JSON, chat completions', () => {
  const env = buildEnv();
  assert.equal(normalize(env, { seconds: 720 }).timers[0].seconds, 720);
  assert.equal(normalize(env, { duration: '12 minutes' }).timers[0].seconds, 720);
  assert.equal(normalize(env, { duration_seconds: 720 }).timers[0].seconds, 720);
  const multi = normalize(env, { timers: [{ label: 'Pasta', seconds: 600 }, { label: 'Tea', duration: '3 minutes', startIn: 120 }] });
  assert.equal(multi.timers.length, 2);
  assert.equal(multi.timers[0].label, 'Pasta');
  assert.equal(multi.timers[1].startIn, 120);
  assert.equal(normalize(env, '12 minutes').timers[0].seconds, 720);
  assert.equal(normalize(env, { content: [{ type: 'text', text: '{"seconds":720}' }] }).timers[0].seconds, 720);
  assert.equal(normalize(env, { result: { content: [{ type: 'text', text: '12 minutes' }] } }).timers[0].seconds, 720);
  assert.equal(normalize(env, { reply: 'Cook it for 12 minutes' }).timers[0].seconds, 720);
  assert.equal(normalize(env, '```json\n{"seconds":720,"label":"Brisket"}\n```').timers[0].seconds, 720);
  assert.equal(normalize(env, { choices: [{ message: { content: 'Cook for 12 minutes' } }] }).timers[0].seconds, 720);
});

test('agent reply: unusable answers are rejected', () => {
  const env = buildEnv();
  for (const bad of [{}, { seconds: -5 }, { seconds: 999999 }, { duration: 'soon' }, 'no time here', null, 42]) {
    assert.ok(normalize(env, bad).error, JSON.stringify(bad) + ' should be rejected');
  }
});

test('agent: network failure leaves the timer alone and explains', async () => {
  const env = buildEnv({ fetchImpl: async () => { throw new Error('offline'); } });
  env.submit('/agent https://agent.example.com/timer');
  env.submit('brisket');
  await env.drain();
  assert.equal(env.get('remainingSeconds'), 300);
  assert.equal(env.get('timerId'), null);
  assert.match(env.agentMessages().join('\n'), /external agent didn't answer/i);
});

test('agent: HTTP error status is handled gracefully', async () => {
  const env = buildEnv({ fetchImpl: async () => ({ ok: false, status: 500 }) });
  env.submit('/agent https://agent.example.com/timer');
  env.submit('brisket');
  await env.drain();
  assert.equal(env.get('remainingSeconds'), 300);
  assert.match(env.agentMessages().join('\n'), /external agent/i);
});

test('agent: a reply without a usable duration reports the problem', async () => {
  const env = buildEnv({ fetchImpl: async () => ({ ok: true, text: async () => '{}' }) });
  env.submit('/agent https://agent.example.com/timer');
  env.submit('brisket');
  await env.drain();
  assert.equal(env.get('remainingSeconds'), 300);
  assert.match(env.agentMessages().join('\n'), /usable duration/i);
});

test('agent: a newer command discards the stale agent response', async () => {
  let resolvePending;
  const env = buildEnv({ fetchImpl: () => new Promise((res) => { resolvePending = res; }) });
  env.submit('/agent https://agent.example.com/timer');
  env.submit('brisket');
  env.submit('eggs 6:30');
  resolvePending({ ok: true, text: async () => JSON.stringify({ seconds: 999, label: 'Brisket' }) });
  await env.drain();
  assert.equal(env.get('remainingSeconds'), 390);
  assert.equal(env.get('primaryLabel'), 'Eggs');
  assert.deepEqual(env.get('chatTimers.map((t) => t.label)'), [], 'no stale Brisket chip may survive');
});

test('agent: a slow reply is aborted after the timeout', async () => {
  const env = buildEnv({
    fetchImpl: (url, opts) => new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }),
  });
  env.submit('/agent https://agent.example.com/timer');
  env.submit('brisket');
  env.fireTimeouts();
  await env.drain();
  assert.equal(env.get('remainingSeconds'), 300);
  assert.match(env.agentMessages().join('\n'), /timed out/i);
});

test('agent: delayed agent timer lands in the queue as queued', async () => {
  const env = buildEnv({
    fetchImpl: async () => ({ ok: true, text: async () => JSON.stringify({ timers: [{ label: 'Roast', duration: '40 minutes', startIn: 600 }] }) }),
  });
  env.submit('/agent https://agent.example.com/timer');
  env.submit('brisket');
  await env.drain();
  assert.equal(env.get('remainingSeconds'), 0);
  assert.equal(env.get('chatTimers[0].state'), 'queued');
  assert.equal(env.get('chatTimers[0].delay'), 600);
  assert.match(env.agentMessages().join('\n'), /auto-starts in 10:00/);
});

test('agent command: built-in is default; set persists, status reports, off/auto toggle, bad URL rejected', () => {
  const env = buildEnv();
  env.submit('/agent');
  assert.match(env.agentMessages()[0], /built-in AI is on/i);
  env.submit('/agent notaurl');
  assert.match(env.agentMessages()[0], /full http\(s\) URL/);
  assert.equal(env.get('agentUrl'), '');
  env.submit('/agent https://agent.example.com/timer');
  assert.equal(env.get('agentUrl'), 'https://agent.example.com/timer');
  assert.equal(env.storage.get('tickr.agent.url'), 'https://agent.example.com/timer');
  env.submit('/agent');
  assert.match(env.agentMessages()[0], /Custom agent connected/);
  env.submit('/agent off');
  assert.equal(env.get('agentUrl'), '');
  assert.equal(env.get('agentDisabled'), true);
  assert.equal(env.storage.has('tickr.agent.url'), false);
  assert.equal(env.storage.get('tickr.agent.mode'), 'off');
  env.submit('/agent');
  assert.match(env.agentMessages()[0], /lookups are off/i);
  env.submit('/agent auto');
  assert.equal(env.get('agentDisabled'), false);
  assert.equal(env.storage.has('tickr.agent.mode'), false);
  env.submit('/agent');
  assert.match(env.agentMessages()[0], /built-in AI is on/i);
  assert.strictEqual(env.agentMessages().length, 8, 'newest message is first, oldest last');
  assert.match(env.agentMessages()[7], /built-in AI is on/i, 'oldest message stays at the bottom');
});

test('agent: local durations never hit the network', async () => {
  let calls = 0;
  const env = buildEnv({ fetchImpl: async () => { calls++; return { ok: true, text: async () => '{"seconds":720}' }; } });
  env.submit('/agent https://agent.example.com/timer');
  env.submit('pasta 10 minutes');
  await env.drain();
  assert.equal(calls, 0);
  assert.equal(env.get('remainingSeconds'), 600);
});