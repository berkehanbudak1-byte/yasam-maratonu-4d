import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), 'utf8');

function createOynaHarness(options = {}) {
  const html = read('oyna.html');
  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(scriptMatch, 'oyna.html must contain inline launcher script');

  const href = options.href || 'https://example.github.io/yasam-maratonu-4d/oyna.html';
  const parsedUrl = new URL(href);
  const search = options.search ?? parsedUrl.search;
  const hash = options.hash ?? parsedUrl.hash;

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
  elements.get('timerText').textContent = 'Oyun 3 saniye içinde otomatik başlatılıyor... (Redirecting to WebAssembly engine)';
  elements.get('toggleTimer').textContent = 'Otomatik Başlatmayı Durdur / Pause Auto-Launch';

  const store = new Map(Object.entries(options.storageSeed || {}));
  const localStorageMock = {
    get length() { return store.size; },
    key: (i) => Array.from(store.keys())[i] ?? null,
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  };

  const cacheSet = new Set(options.caches || []);
  const deletedCaches = [];
  const cachesMock = {
    keys: async () => Array.from(cacheSet),
    delete: async (k) => {
      deletedCaches.push(k);
      return cacheSet.delete(k);
    }
  };

  const unregisteredScopes = [];
  const swRegs = (options.swScopes || []).map((scope) => ({
    scope,
    unregister: async () => {
      unregisteredScopes.push(scope);
      return true;
    }
  }));

  const deletedDbs = [];
  const idbNames = options.idbNames || [];
  const indexedDBMock = options.withIdb
    ? {
        databases: async () => idbNames.map((name) => ({ name })),
        open: () => {
          const req = {};
          queueMicrotask(() => req.onerror && req.onerror());
          return req;
        },
        deleteDatabase: (name) => {
          deletedDbs.push(name);
          const req = {};
          queueMicrotask(() => req.onsuccess && req.onsuccess());
          return req;
        }
      }
    : null;

  let replacedUrl = null;
  const doc = {
    getElementById: (id) => elements.get(id) || null,
    createElement: (tag) => ({ tag, id: '', textContent: '', getContext: () => ({}) }),
    createTextNode: (text) => ({ type: 'text', textContent: text })
  };

  const win = {
    location: {
      href,
      search,
      hash,
      replace: (u) => { replacedUrl = u; }
    },
    matchMedia: () => ({ matches: false }),
    WebGL2RenderingContext: function () {},
    AudioContext: function () {},
    localStorage: localStorageMock,
    indexedDB: indexedDBMock,
    caches: cachesMock
  };

  const sandbox = {
    window: win,
    document: doc,
    navigator: {
      hardwareConcurrency: 8,
      serviceWorker: {
        getRegistrations: async () => swRegs
      }
    },
    localStorage: localStorageMock,
    caches: cachesMock,
    indexedDB: indexedDBMock,
    URL,
    URLSearchParams,
    setInterval: () => 1,
    clearInterval: () => {}
  };

  vm.runInNewContext(scriptMatch[1], sandbox, { filename: 'oyna.html' });
  return {
    elements,
    store,
    cacheSet,
    deletedCaches,
    unregisteredScopes,
    deletedDbs,
    getReplacedUrl: () => replacedUrl
  };
}

test('all JS/MJS test files and inline HTML scripts pass syntax verification', () => {
  const testsDir = path.join(ROOT, 'tests');
  const files = fs.readdirSync(testsDir).filter((f) => f.endsWith('.js') || f.endsWith('.mjs')).sort();
  assert.ok(files.length > 0, 'expected test files in tests/');
  for (const file of files) {
    execFileSync(process.execPath, ['--check', path.join(testsDir, file)], { stdio: 'pipe' });
  }
  for (const file of ['index.html', 'oyna.html']) {
    const html = read(file);
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    assert.ok(scripts.length > 0, `expected inline script in ${file}`);
    scripts.forEach((m, i) => {
      assert.doesNotThrow(() => new vm.Script(m[1], { filename: `${file}#${i}` }));
    });
  }
});

test('oyna.html scopes SW, cache, IndexedDB, and localStorage resets strictly to yasam-maratonu-4d', async () => {
  const harness = createOynaHarness({
    href: 'https://example.github.io/yasam-maratonu-4d/oyna.html?stay=1',
    swScopes: [
      'https://example.github.io/yasam-maratonu-4d/',
      'https://example.github.io/yasam-maratonu/',
      'https://example.github.io/haber-web/',
      'https://example.github.io/'
    ],
    caches: [
      'yasam-maratonu-4d-v1',
      'ym4d-assets',
      'workbox-precache-https://example.github.io/yasam-maratonu-4d/',
      'yasam-maratonu-v1',
      'ym-dunya-v10',
      'workbox-precache-https://example.github.io/yasam-maratonu/',
      'haber-web-v1'
    ],
    storageSeed: {
      ym4d_launch_profile: 'touch',
      ym4d_custom: '1',
      yasam_maratonu_4d_flags: 'on',
      yasam_maratonu_dunya_save_v4: '{"day":7}',
      yasam_maratonu_launch_profile: 'touch',
      unrelated_key: 'keep'
    },
    withIdb: true,
    idbNames: ['/userfs', 'yasam-maratonu-4d-cache', 'other-godot-app']
  });

  await new Promise((resolve) => setImmediate(resolve));

  // Initial telemetry counts only yasam-maratonu-4d resources
  assert.equal(harness.elements.get('telCache').textContent, 'Önbellek: 3 Cache · 1 SW');
  assert.equal(harness.elements.get('telLocal').textContent, 'LocalStorage: 3 / 6 anahtar');

  // Clear asset cache must only touch yasam-maratonu-4d SWs and caches
  await harness.elements.get('clearCacheBtn').listeners.click();
  assert.deepEqual(harness.deletedCaches.sort(), [
    'workbox-precache-https://example.github.io/yasam-maratonu-4d/',
    'yasam-maratonu-4d-v1',
    'ym4d-assets'
  ]);
  assert.deepEqual(harness.unregisteredScopes, [
    'https://example.github.io/yasam-maratonu-4d/'
  ]);
  assert.ok(harness.cacheSet.has('yasam-maratonu-v1'));
  assert.ok(harness.cacheSet.has('ym-dunya-v10'));
  assert.ok(harness.cacheSet.has('haber-web-v1'));

  // Confirmed save reset clears only ym4d_ / yasam_maratonu_4d_ keys + /userfs/own DB
  await harness.elements.get('confirmResetSaveBtn').listeners.click();
  assert.equal(harness.store.has('ym4d_custom'), false);
  assert.equal(harness.store.has('yasam_maratonu_4d_flags'), false);
  assert.equal(harness.store.get('ym4d_launch_profile'), 'desktop');
  assert.equal(harness.store.get('yasam_maratonu_dunya_save_v4'), '{"day":7}');
  assert.equal(harness.store.get('yasam_maratonu_launch_profile'), 'touch');
  assert.equal(harness.store.get('unrelated_key'), 'keep');
  assert.deepEqual(harness.deletedDbs.sort(), ['/userfs', 'yasam-maratonu-4d-cache']);
});

test('oyna.html ?stay=1 invokes pauseCountdown so timer text and button update accurately', () => {
  const harness = createOynaHarness({
    href: 'https://example.github.io/yasam-maratonu-4d/oyna.html?stay=1'
  });
  const timerText = harness.elements.get('timerText').textContent;
  const toggleText = harness.elements.get('toggleTimer').textContent;
  assert.doesNotMatch(timerText, /otomatik başlatılıyor/i);
  assert.match(timerText, /duraklatıldı/i);
  assert.match(toggleText, /Devam Ettir|Resume/i);
});

test('oyna.html targets ./index.html for both https and file:// launches', () => {
  const html = read('oyna.html');
  assert.match(html, /id="playNow"[^>]*href="\.\/index\.html"/);

  const fileHarness = createOynaHarness({
    href: 'file:///apps/yasam-maratonu-4d/oyna.html?stay=1&profile=desktop'
  });
  assert.equal(
    fileHarness.elements.get('playNow').getAttribute('href'),
    './index.html?stay=1&profile=desktop&touch=0'
  );
});
