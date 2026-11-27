'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

function runOynaLauncher(search, hash, options = {}) {
  const html = read('oyna.html');
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(scriptMatch, 'oyna.html must contain inline launcher script');

  const elements = new Map();
  const makeEl = (id) => ({
    id,
    textContent: '',
    className: '',
    attrs: {},
    children: [],
    listeners: {},
    classList: {
      classes: new Set(),
      toggle(c, force) {
        if (force === undefined) {
          if (this.classes.has(c)) this.classes.delete(c);
          else this.classes.add(c);
        } else if (force) this.classes.add(c);
        else this.classes.delete(c);
      },
      remove(c) { this.classes.delete(c); }
    },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    replaceChildren(...nodes) { this.children = nodes; },
    getContext() { return {}; }
  });
  for (const id of [
    'playNow', 'toggleTimer', 'timerText', 'profileDesktop', 'profileTouch',
    'profileBadge', 'profileHint', 'diagWebgl', 'diagCpu', 'diagAudio',
    'telIdb', 'telQuota', 'telCache', 'telLocal', 'refreshTelemetry',
    'clearCacheBtn', 'resetSaveBtn', 'saveResetConfirm', 'confirmResetSaveBtn',
    'cancelResetSaveBtn', 'resetStatus', 'countdown'
  ]) {
    elements.set(id, makeEl(id));
  }

  const store = new Map(Object.entries(options.storageSeed || {}));
  const localStorageMock = options.throwStorage
    ? {
        get length() { throw new Error('SecurityError'); },
        key() { throw new Error('SecurityError'); },
        getItem() { throw new Error('SecurityError'); },
        setItem() { throw new Error('SecurityError'); },
        removeItem() { throw new Error('SecurityError'); }
      }
    : {
        get length() { return store.size; },
        key: (i) => Array.from(store.keys())[i] ?? null,
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k)
      };

  let replacedUrl = null;
  const timers = [];
  const doc = {
    getElementById: (id) => elements.get(id) || null,
    createElement: (tag) => ({ tag, id: '', textContent: '', getContext: () => ({}) }),
    createTextNode: (text) => ({ type: 'text', textContent: text })
  };
  const win = {
    location: {
      href: 'https://example.github.io/yasam-maratonu-4d/oyna.html' + search + hash,
      search,
      hash,
      replace: (u) => { replacedUrl = u; }
    },
    matchMedia: () => ({ matches: false }),
    WebGL2RenderingContext: function () {},
    AudioContext: function () {},
    localStorage: localStorageMock,
    indexedDB: null,
    caches: null
  };
  const sandbox = {
    window: win,
    document: doc,
    navigator: { hardwareConcurrency: 8 },
    localStorage: localStorageMock,
    URL,
    URLSearchParams,
    setInterval: (fn) => { timers.push(fn); return timers.length; },
    clearInterval: () => {}
  };

  vm.runInNewContext(scriptMatch[1], sandbox, { filename: 'oyna.html' });
  return { elements, store, getReplacedUrl: () => replacedUrl };
}

test('inline scripts in index.html and oyna.html are syntactically valid JS', () => {
  for (const name of ['index.html', 'oyna.html']) {
    const html = read(name);
    const matches = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    assert.ok(matches.length >= 1, `expected inline <script> in ${name}`);
    matches.forEach((m, i) => {
      assert.doesNotThrow(() => new vm.Script(m[1], { filename: `${name}#script${i}` }));
    });
  }
});

test('index.html enforces Referrer-Policy and Godot-WASM-compatible CSP with intact GODOT_CONFIG', () => {
  const html = read('index.html');
  assert.match(html, /<meta\s+name="referrer"\s+content="no-referrer"\s*\/?>/i);
  const cspMatch = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"\s*\/?>/i);
  assert.ok(cspMatch, 'index.html must include a CSP meta tag');
  const csp = cspMatch[1];
  assert.match(csp, /default-src\s+'self'/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
  assert.match(csp, /script-src[^;]*'sha256-[A-Za-z0-9+/]+=*'/);
  assert.match(csp, /'wasm-unsafe-eval'/);
  assert.match(csp, /worker-src\s+'self'\s+blob:/);
  assert.match(csp, /connect-src\s+'self'\s+blob:\s+data:/);
  assert.match(csp, /object-src\s+'none'/);
  assert.match(csp, /base-uri\s+'self'/);
  assert.match(csp, /form-action\s+'none'/);
  assert.match(html, /const GODOT_CONFIG = \{/);
  assert.match(html, /"index\.wasm":35376909/);
  assert.match(html, /"index\.pck":219648/);
});

test('oyna.html enforces Referrer-Policy, strict hash-based CSP, and contains zero unsafe HTML/eval sinks', () => {
  const html = read('oyna.html');
  assert.match(html, /<meta\s+name="referrer"\s+content="no-referrer"\s*\/?>/i);
  const cspMatch = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"\s*\/?>/i);
  assert.ok(cspMatch, 'oyna.html must include a CSP meta tag');
  const csp = cspMatch[1];
  assert.match(csp, /default-src\s+'self'/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
  assert.match(csp, /script-src[^;]*'sha256-[A-Za-z0-9+/]+=*'/);
  assert.doesNotMatch(csp, /'unsafe-eval'/);
  assert.match(csp, /object-src\s+'none'/);
  assert.match(csp, /base-uri\s+'self'/);
  assert.match(csp, /form-action\s+'none'/);
  assert.doesNotMatch(html, /\son(?:click|load|error|change|input|submit|keydown|keyup|mouseover)=/i);

  const forbidden = /\.(?:innerHTML|outerHTML)\s*=|\binsertAdjacentHTML\s*\(|\bdocument\.write\s*\(|\beval\s*\(|\bnew\s+Function\s*\(/;
  assert.doesNotMatch(html, forbidden, 'oyna.html must not use innerHTML or eval sinks');
});

test('oyna.html allowlists URL query parameters and rejects unsafe hashes', () => {
  const res = runOynaLauncher(
    '?profile=touch&stay=1&evil=<script>&redirect=https://evil.test&__proto__=polluted&lang=en',
    '#javascript:alert(1)'
  );
  assert.equal(res.elements.get('playNow').getAttribute('href'), './index.html?stay=1&lang=en&profile=touch&touch=1');

  const res2 = runOynaLauncher('?profile=desktop&debug=1', '#hud/slot_2');
  assert.equal(res2.elements.get('playNow').getAttribute('href'), './index.html?debug=1&profile=desktop&touch=0#hud/slot_2');

  const res3 = runOynaLauncher('?profile=invalid', '#//evil.example');
  assert.equal(res3.elements.get('playNow').getAttribute('href'), './index.html?profile=desktop&touch=0');
});

test('oyna.html handles tampered or throwing localStorage gracefully', async () => {
  const tampered = runOynaLauncher('', '', {
    storageSeed: { ym4d_launch_profile: '<img src=x onerror=1>' }
  });
  assert.equal(tampered.elements.get('playNow').getAttribute('href'), './index.html?profile=desktop&touch=0');
  assert.equal(tampered.store.get('ym4d_launch_profile'), 'desktop');

  const blocked = runOynaLauncher('?stay=1', '', { throwStorage: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(blocked.elements.get('playNow').getAttribute('href'), './index.html?stay=1&profile=desktop&touch=0');
  assert.equal(blocked.elements.get('telLocal').textContent, 'LocalStorage: Kapalı');
});

test('oyna.html countdown resume uses safe DOM nodes and reset removes only ym4d_ keys', async () => {
  const res = runOynaLauncher('?stay=1', '', {
    storageSeed: { ym4d_launch_profile: 'touch', ym4d_extra: '1', unrelated_key: 'keep' }
  });

  // Resume countdown
  res.elements.get('toggleTimer').listeners.click();
  const children = res.elements.get('timerText').children;
  assert.equal(children.length, 3);
  assert.equal(children[1].tag, 'strong');
  assert.equal(children[1].id, 'countdown');
  assert.equal(children[1].textContent, '3');

  // Confirm save reset removes ym4d_ keys (then re-applies desktop profile) and keeps unrelated keys
  await res.elements.get('confirmResetSaveBtn').listeners.click();
  assert.equal(res.store.has('ym4d_extra'), false);
  assert.equal(res.store.get('ym4d_launch_profile'), 'desktop');
  assert.equal(res.store.get('unrelated_key'), 'keep');
});

test('pre-compiled Godot WebAssembly/PCK/engine files remain untouched', () => {
  for (const bin of ['index.wasm', 'index.pck', 'index.js', 'index.audio.worklet.js']) {
    assert.ok(fs.existsSync(path.join(ROOT, bin)), `${bin} must exist`);
  }
  const diff = execFileSync('git', ['diff', '--name-only'], { cwd: ROOT, encoding: 'utf8' });
  for (const bin of ['index.wasm', 'index.pck', 'index.js', 'index.audio.worklet.js']) {
    assert.ok(!diff.split('\n').includes(bin), `Godot export file ${bin} must NEVER be modified`);
  }
});
