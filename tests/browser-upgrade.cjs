// Optional integration check: NODE_PATH=/path/to/node_modules node tests/browser-upgrade.cjs
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { buildPreview } = require('../scripts/build-preview.cjs');

(async () => {
  const root = path.join(__dirname, '..');
  const tempRoot = fs.existsSync('/tmp/opencode') ? '/tmp/opencode' : require('node:os').tmpdir();
  const temp = fs.mkdtempSync(path.join(tempRoot, 'ezhik-browser-'));
  const oldSource = path.join(temp, 'old-source');
  fs.mkdirSync(oldSource);
  const files = ['index.html', 'sw.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png', '.nojekyll'];
  for (const file of files) {
    fs.writeFileSync(path.join(oldSource, file), execFileSync('git', ['show', `d4809888126a31bae20ab0f252d2db02004b4bfe:${file}`], { cwd: root }));
  }
  const oldSite = path.join(temp, 'old-site'), newSite = path.join(temp, 'new-site');
  buildPreview(oldSource, oldSite);
  buildPreview(root, newSite);
  let active = oldSite;
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
  const server = http.createServer((req, res) => {
    const name = new URL(req.url, 'http://localhost').pathname.replace('/ezhik-multiplication-preview/', '') || 'index.html';
    if (!files.includes(name)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(name)] || 'text/plain', 'Cache-Control': 'no-store' });
    res.end(fs.readFileSync(path.join(active, name)));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH || undefined });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route(/fonts\.googleapis\.com|fonts\.gstatic\.com/, route => route.abort());
    await page.goto(`http://127.0.0.1:${server.address().port}/ezhik-multiplication-preview/`);
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => {}));
    await page.click('#b-settings');
    await page.fill('#st-name', 'Тестовый ёж');
    await page.click('#st-save');
    await page.click('#b-norm');
    const answer = await page.locator('#qtext').innerText();
    const [a, b] = answer.split('×').map(Number);
    for (const digit of String(a * b)) await page.click(`[data-k="${digit}"]`);
    await page.click('[data-k="ok"]');
    await page.waitForTimeout(650);
    await page.click('#b-back');
    const before = await page.evaluate(async () => {
      const original = JSON.parse(localStorage.getItem('ezhik.preview.v1'));
      original.name = 'Основной ёж';original.xp = 6543;
      localStorage.setItem('umnozh.v1', JSON.stringify(original));
      await caches.open('ezhik-v1');
      await caches.open('another-project-v1');
      return { preview: JSON.parse(localStorage.getItem('ezhik.preview.v1')), original: localStorage.getItem('umnozh.v1') };
    });
    assert.ok(before.preview.xp > 0);
    active = newSite;
    await page.reload();
    assert.match(await page.locator('#hello').innerText(), /Тестовый ёж/);
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('ezhik.preview.v1')));
    assert.deepEqual(after, before.preview, 'old progress must survive an actual HTML update');
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then(reg => reg.update()));

    const originalDownload = page.waitForEvent('download');
    await page.click('#preview-backup-original');
    const originalFile = await originalDownload;
    assert.equal(JSON.parse(fs.readFileSync(await originalFile.path(), 'utf8')).state.xp, 6543);

    // Give only the test profile currency to inspect all four purchases.
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('ezhik.preview.v1'));s.snow = 400;
      localStorage.setItem('ezhik.preview.v1', JSON.stringify(s));
    });
    await page.reload();
    await page.click('#b-wardrobe');
    for (const id of ['hat', 'scarf', 'coat', 'boots']) await page.click(`[data-winter="${id}"]`);
    assert.equal(await page.locator('[data-winter][aria-pressed="true"]').count(), 4);
    await page.screenshot({ path: path.join(temp, 'wardrobe-mobile.png') });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.screenshot({ path: path.join(temp, 'wardrobe-dark.png') });
    await page.click('#winter-close');
    await page.click('#b-settings');
    await page.click('#st-backup');
    const download = page.waitForEvent('download');
    await page.click('#backup-export');
    const backup = JSON.parse(fs.readFileSync(await (await download).path(), 'utf8'));
    assert.equal(backup.state.winterEquipped.length, 4);
    backup.state.xp = 777;
    await page.setInputFiles('#backup-file', { name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup)) });
    await page.waitForFunction(() => !document.getElementById('backup-import').disabled);
    page.once('dialog', dialog => dialog.accept());
    await page.click('#backup-import');
    await page.waitForFunction(() => document.getElementById('ov').hidden);
    const final = await page.evaluate(async () => ({
      original: localStorage.getItem('umnozh.v1'),
      test: JSON.parse(localStorage.getItem('ezhik.preview.v1')),
      caches: await caches.keys()
    }));
    assert.equal(final.original, before.original, 'preview and import must never modify production progress');
    assert.equal(final.test.xp, 777);
    assert.equal(final.test.winterEquipped.length, 4);
    assert.ok(final.caches.includes('ezhik-v1'));
    assert.ok(final.caches.includes('another-project-v1'));
    assert.deepEqual(errors, []);
    console.log('PASS: real old→new browser update, purchases, backup export/import, production isolation');
    console.log('Screenshots: ' + temp);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
