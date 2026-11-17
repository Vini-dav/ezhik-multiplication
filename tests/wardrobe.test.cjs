const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Run the actual inline application with a small DOM stub; no test dependencies.
function load(saved) {
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const elements = new Map();
  const element = () => ({
    style: {}, classList: { toggle() {} },
    querySelectorAll: () => [], addEventListener() {}, getContext: () => ({})
  });
  const data = new Map(saved ? [['umnozh.v1', JSON.stringify(saved)]] : []);
  let failSave = false;
  let now = new Date(2026, 10, 16, 12).getTime();
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const context = vm.createContext({
    Date: Clock,
    localStorage: {
      getItem: key => data.get(key) || null,
      setItem(key, value) {
        if (failSave) throw new Error('Storage full');
        data.set(key, value);
      }
    },
    document: {
      getElementById(id) {
        if (!elements.has(id)) elements.set(id, element());
        return elements.get(id);
      },
      querySelectorAll: () => [], addEventListener() {},
      createElement: element, body: { appendChild() {} }
    },
    setTimeout() {}, clearTimeout() {}, clearInterval() {}
  });
  const exposed = `globalThis.app = {
    state: () => S, defaults, ensureDay, checkNorm, allKeys, normNeed,
    changeWinterItem, hog, items: WINTER_ITEMS, backupText, parseBackup, restoreBackup
  };`;
  vm.runInContext(script.replace("show('home');", exposed), context);
  return {
    app: context.app, data,
    nextDay() { now += 86400000; context.app.ensureDay(); },
    failSave() { failSave = true; }
  };
}

function completeNorm(app) {
  app.state().day.solved = app.allKeys().slice(0, app.normNeed());
  return app.checkNorm(true);
}

test('legacy progress loads unchanged with empty wardrobe and the same storage key', () => {
  const { app, data } = load({ xp: 1234, name: 'Маша', ach: { first: '2026-11-15' } });
  assert.equal(app.state().xp, 1234);
  assert.equal(app.state().name, 'Маша');
  assert.equal(app.state().ach.first, '2026-11-15');
  assert.equal(app.state().snow, 0);
  assert.equal(app.state().winterOwned.length, 0);
  assert.equal(data.size, 1);
});

test('four items cost five completed study days each; repeated completion earns nothing', () => {
  const { app, nextDay } = load();
  for (const item of app.items) {
    for (let day = 0; day < 5; day++) {
      if (day || app.state().day.done) nextDay();
      assert.equal(completeNorm(app), true);
      assert.equal(app.checkNorm(true), false);
      assert.equal(app.state().snow, (day + 1) * 20);
    }
    app.changeWinterItem(item.id);
    assert.equal(app.state().snow, 0);
    assert.ok(app.state().winterOwned.includes(item.id));
    assert.ok(app.state().winterEquipped.includes(item.id));
  }
  assert.equal(app.state().winterOwned.length, 4);
  assert.equal(app.state().winterEquipped.length, 4);
  assert.equal(app.state().xp, 0, 'shop currency must not change XP');
});

test('cannot buy without funds or buy an unknown item', () => {
  const { app } = load();
  app.changeWinterItem('hat');
  app.changeWinterItem('unknown');
  assert.equal(app.state().snow, 0);
  assert.equal(app.state().winterOwned.length, 0);
});

test('purchases persist, and owned items can be toggled without another charge', () => {
  const { app, data } = load({ snow: 100, xp: 900 });
  app.changeWinterItem('hat');
  app.changeWinterItem('hat');
  assert.equal(app.state().winterEquipped.length, 0);
  app.changeWinterItem('hat');
  assert.equal(app.state().winterOwned.length, 1);
  assert.equal(app.state().snow, 0);
  assert.equal(app.state().xp, 900);
  const restored = load(JSON.parse(data.get('umnozh.v1'))).app;
  assert.ok(restored.state().winterEquipped.includes('hat'));
  assert.match(restored.hog('happy'), /#D63C4B/);
  assert.doesNotMatch(restored.hog('happy', []), /#D63C4B/);
});

test('a failed purchase save rolls back currency and ownership', () => {
  const { app, failSave } = load({ snow: 100 });
  failSave();
  app.changeWinterItem('coat');
  assert.equal(app.state().snow, 100);
  assert.equal(app.state().winterOwned.length, 0);
  assert.equal(app.state().winterEquipped.length, 0);
});

test('an already completed legacy day does not award snow retroactively', () => {
  const saved = load().app.defaults();
  saved.day.done = true;
  const { app } = load(saved);
  assert.equal(app.checkNorm(true), false);
  assert.equal(app.state().snow, 0);
});

test('backup round trip preserves progress and wardrobe, with an undo snapshot', () => {
  const source = load({ xp: 5000, snow: 100, name: 'Маша' });
  source.app.changeWinterItem('hat');
  completeNorm(source.app);
  const target = load({ xp: 300 });
  target.app.restoreBackup(source.app.backupText());
  assert.equal(target.app.state().xp, 5000);
  assert.equal(target.app.state().snow, 20);
  assert.ok(target.app.state().winterEquipped.includes('hat'));
  assert.equal(JSON.parse(target.data.get('umnozh.v1.before-import')).xp, 300);
  assert.equal(JSON.parse(target.data.get('umnozh.v1')).xp, 5000);
});

test('legacy backups may omit wardrobe fields', () => {
  const { app } = load();
  const backup = JSON.parse(app.backupText());
  delete backup.state.snow;
  delete backup.state.winterOwned;
  delete backup.state.winterEquipped;
  app.restoreBackup(JSON.stringify(backup));
  assert.equal(app.state().snow, 0);
  assert.equal(app.state().winterOwned.length, 0);
});

test('invalid or newer backup formats never overwrite current progress', () => {
  const { app, data } = load({ xp: 300 });
  const bad = [
    '{broken', '{}', JSON.stringify({ app: 'other-app', version: 1, state: {} }),
    JSON.stringify({ app: 'ezhik-multiplication', version: 1, state: {} }),
    app.backupText().replace('"version": 1', '"version": 2')
  ];
  for (const field of ['day', 'cards', 'history', 'ach', 'winterOwned']) {
    const backup = JSON.parse(app.backupText());
    backup.state[field] = null;
    bad.push(JSON.stringify(backup));
  }
  for (const text of bad) assert.throws(() => app.restoreBackup(text));
  assert.equal(app.state().xp, 300);
  assert.equal(data.size, 1);
});

test('storage failure cancels import without changing progress', () => {
  const { app, failSave } = load({ xp: 300 });
  const backup = load({ xp: 900 }).app.backupText();
  failSave();
  assert.throws(() => app.restoreBackup(backup));
  assert.equal(app.state().xp, 300);
});

test('preview build isolates both progress and caches on the shared Pages origin', () => {
  const { buildPreview } = require('../scripts/build-preview.cjs');
  const tempRoot = process.env.OPENCODE_TEST_TMP || (fs.existsSync('/tmp/opencode') ? '/tmp/opencode' : require('node:os').tmpdir());
  fs.mkdirSync(tempRoot, { recursive: true });
  const target = fs.mkdtempSync(path.join(tempRoot, 'ezhik-preview-test-'));
  buildPreview(path.join(__dirname, '..'), target);
  const html = fs.readFileSync(path.join(target, 'index.html'), 'utf8');
  const sw = fs.readFileSync(path.join(target, 'sw.js'), 'utf8');
  assert.ok(html.includes("const KEY='ezhik.preview.v1';"));
  assert.ok(html.includes("localStorage.getItem('umnozh.v1')"), 'read-only original backup');
  assert.ok(!html.includes("localStorage.setItem('umnozh.v1'"));
  assert.ok(sw.includes("const CACHE = 'ezhikPreview-v1';"));
  assert.ok(sw.includes("k.startsWith('ezhikPreview-') && k !== CACHE"));
});

test('service worker deletes only obsolete ezhik caches', async () => {
  const handlers = {};
  const deleted = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../sw.js'), 'utf8'), {
    self: {
      addEventListener(name, handler) { handlers[name] = handler; },
      clients: { claim() {} }
    },
    caches: {
      keys: async () => ['ezhik-v0', 'ezhik-v1', 'other-project-v1'],
      delete: async key => { deleted.push(key); return true; }
    }
  });
  let completion;
  handlers.activate({ waitUntil(promise) { completion = promise; } });
  await completion;
  assert.deepEqual(deleted, ['ezhik-v0']);
});
