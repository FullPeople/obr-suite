// Real page/Canvas/FileReader/PNG bake and installed AssetsApi/PopoverApi;
// only language events and the OBR host transport are substituted.
import assert from 'node:assert/strict';
import { build } from 'rolldown';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE ?? 'C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const out = mkdtempSync(join(tmpdir(), 'circle-image-locale-'));
const baseline = process.argv.includes('--baseline');
// Keep the reproduction tied to the pre-fix source after this tool is committed.
const original = path => execFileSync('git', ['-c', `safe.directory=${process.cwd().replaceAll('\\', '/')}`, 'show', `44a53a4:${path}`], { encoding: 'utf8' });
let html = baseline ? original('circleimage.html') : readFileSync('circleimage.html', 'utf8');
await build({ input: resolve('src/modules/circleImage/popover-page.ts'), platform: 'browser', plugins: [{ name: 'circle-host',
  resolveId(id) { if (id === '@owlbear-rodeo/sdk' || /^(\.\.\/)+state$/.test(id)) return resolve('tools/fixtures/circle-image-locale-sdk.ts'); },
  transform(code, id) { if (baseline && id.replaceAll('\\', '/').endsWith('/circleImage/popover-page.ts')) return original('src/modules/circleImage/popover-page.ts'); return code; },
}], output: { file: join(out, 'page.js'), format: 'esm' } });
html = html.replace('/src/modules/circleImage/popover-page.ts', '/page.js');
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'text/javascript;charset=utf-8' : 'text/html;charset=utf-8');
  res.end(url.pathname === '/page.js' ? readFileSync(join(out, 'page.js')) : url.pathname === '/editor' ? html : '<meta charset="utf-8"><iframe id="editor" style="border:0;width:100vw;height:600px"></iframe><style>body{margin:0}</style>');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 420, height: 620 } });
const errors = [], checks = [];
page.on('pageerror', error => errors.push(error.message));
const check = (value, message) => { assert.ok(value, message); checks.push(message); };
let base, frame;
const pngSource = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240"><rect width="360" height="240" fill="white"/><path d="M30 30H240V180H30Z" fill="#2869a8"/><circle cx="255" cy="130" r="60" fill="#e89f42"/></svg>');
const file = { name: '作者图片.svg', mimeType: 'image/svg+xml', buffer: pngSource };
const load = async (params = 'lang=en') => {
  const url = `${base}/editor?${params}`;
  const navigated = page.waitForEvent('framenavigated', { predicate: candidate => candidate.url() === url });
  await page.evaluate(url => document.querySelector('iframe').src = url, url);
  frame = await navigated;
  await frame.waitForFunction(() => window.__circleHost);
  await frame.waitForTimeout(40);
};
const importImage = async () => { await frame.locator('#file-input').setInputFiles(file); await frame.waitForSelector('#editor.active'); await frame.waitForTimeout(60); };
const language = async lang => { await frame.evaluate(lang => window.__circleHost.language(lang), lang); await frame.waitForTimeout(30); };
const sent = () => frame.evaluate(() => window.__circleHost.calls.filter(call => call.type === 'OBR_ASSETS_UPLOAD_IMAGES').length);
const dialog = async action => { const pending = page.waitForEvent('dialog'); const operation = action(); const d = await pending; const message = d.message(); await d.dismiss(); await operation; return message; };
const range = (selector, value) => frame.locator(selector).evaluate((input, value) => { input.value = value; input.dispatchEvent(new Event('input', { bubbles: true })); }, value);
const snapshot = () => frame.evaluate(() => ({
  pixels: document.querySelector('canvas').toDataURL(),
  controls: [...document.querySelectorAll('input:not([type=file])')].map(input => [input.id, input.value]),
  mode: document.querySelector('.tab.on').dataset.mode,
  background: document.querySelector('.bg-toggle.on').dataset.kind,
  focus: document.activeElement.id,
}));
const uploadInfo = () => frame.evaluate(async () => {
  const { data } = window.__circleHost.calls.findLast(call => call.type === 'OBR_ASSETS_UPLOAD_IMAGES');
  const { file, ...fields } = data.images[0]; const bitmap = await createImageBitmap(file);
  const c = new OffscreenCanvas(bitmap.width, bitmap.height), context = c.getContext('2d'); context.drawImage(bitmap, 0, 0);
  return { count: data.images.length, typeHint: data.typeHint, mime: file.type, width: bitmap.width, height: bitmap.height, cornerAlpha: context.getImageData(0, 0, 1, 1).data[3], fields };
});
try {
  for (let attempt = 0; ; attempt++) {
    base = `http://127.0.0.1:${server.address().port}`;
    try { await page.goto(base); break; } catch (error) {
      if (attempt >= 3 || !String(error).includes('ERR_UNSAFE_PORT')) throw error;
      await new Promise(done => server.close(done)); await new Promise(done => server.listen(0, '127.0.0.1', done));
    }
  }
  await load();
  if (baseline) {
    check(await frame.locator('.ttl').innerText() === '图片处理', 'baseline English client still receives Chinese heading');
    const message = await dialog(() => frame.locator('#file-input').setInputFiles({ name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('bad') }));
    check(message === '请选择图片文件（JPG / PNG / WebP / SVG）', 'baseline English client still receives Chinese validation');
  } else {
    check(await frame.title() === 'Image editor' && await frame.locator('html').getAttribute('lang') === 'en', 'English document title and language');
    check(!/\p{Script=Han}/u.test(await frame.locator('body').innerText()), 'English fixed chrome contains no Chinese');
    check(await frame.locator('#btnClose').getAttribute('aria-label') === 'Close', 'localized accessible close control');
    check(await dialog(() => frame.locator('#file-input').setInputFiles({ name: 'bad.txt', mimeType: 'text/plain', buffer: Buffer.from('bad') })) === 'Choose an image file (JPG / PNG / WebP / SVG).', 'English file-type validation');
    check(await dialog(() => frame.locator('#file-input').setInputFiles({ name: 'large.png', mimeType: 'image/png', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) })) === 'This image exceeds 10 MB. Compress it first.', 'unchanged 10 MB limit with English validation');
    check(await dialog(() => frame.locator('#file-input').setInputFiles({ name: 'bad.png', mimeType: 'image/png', buffer: Buffer.from('not an image') })) === 'The image could not be loaded.', 'native image decode failure is English');
    await importImage();
    await range('#size-slider', '180'); await range('#zoom-slider', '170'); await range('#ring-width', '8');
    const bounds = await frame.locator('#canvas').boundingBox();
    await page.mouse.move(bounds.x + 100, bounds.y + 100); await page.mouse.down(); await page.mouse.move(bounds.x + 124, bounds.y + 89); await page.mouse.up();
    await frame.locator('#ring-width').focus(); const circleDraft = await snapshot();
    await language('zh'); check(await frame.locator('.ttl').innerText() === '图片处理', 'Chinese chrome after language change');
    assert.deepEqual(await snapshot(), circleDraft); checks.push('Chinese switch preserves exact native canvas pixels, crop parameters and keyboard focus');
    await page.screenshot({ path: join(out, 'circle-zh-420.png') });
    await language('en'); assert.deepEqual(await snapshot(), circleDraft); checks.push('English switch preserves the same crop draft');
    check(await sent() === 0, 'language changes never upload'); await page.screenshot({ path: join(out, 'circle-en-420.png') });
    await frame.evaluate(() => window.__circleHost.hold = true); await frame.locator('#btnDrag').click();
    await frame.waitForFunction(() => window.__circleHost.release); await language('zh');
    check(await frame.locator('#btnDrag').innerText() === '上传中…' && await frame.locator('#btnDrag').isDisabled(), 'pending upload stays disabled and translates');
    await language('en'); check(await frame.locator('#btnDrag').innerText() === 'Uploading…' && await sent() === 1, 'pending upload is not duplicated by language changes');
    const circle = await uploadInfo(); check(circle.mime === 'image/png' && circle.width === 180 && circle.height === 180 && circle.cornerAlpha === 0, 'real circle output stays a transparent-corner 180px PNG');
    check(circle.count === 1 && circle.typeHint === 'PROP' && /^Circle image-\d+$/.test(circle.fields.name), 'actual AssetsApi uses the existing upload shape and English generated name');
    await frame.evaluate(() => { window.__circleHost.hold = false; window.__circleHost.release(); }); await frame.waitForFunction(() => document.querySelector('#btnDrag').classList.contains('ok'));
    await language('zh'); check(await frame.locator('#btnDrag').innerText() === '✓ 已上传，从资源库拖入场景', 'success state translates without being reset');
    await load('lang=zh'); await importImage(); await frame.locator('#btnDrag').click(); await frame.waitForFunction(() => document.querySelector('#btnDrag').classList.contains('ok'));
    check(/^圆形图片-\d+$/.test((await uploadInfo()).fields.name), 'Chinese generated asset name remains available');
    await load(); await importImage(); await frame.locator('[data-mode=bgremove]').click(); await frame.locator('[data-kind=black]').click();
    await range('#bg-tolerance', '51'); await range('#bg-feather', '13'); await frame.locator('#bg-feather').focus();
    const bgDraft = await snapshot(); await language('zh'); assert.deepEqual(await snapshot(), bgDraft); await language('en'); assert.deepEqual(await snapshot(), bgDraft); checks.push('background-removal mode, color, tolerance, feather, pixels and focus survive both languages');
    await page.setViewportSize({ width: 320, height: 620 }); await frame.waitForTimeout(60);
    const overflow = await frame.evaluate(() => [...document.querySelectorAll('.ctrl-row,.btn-row')].some(el => el.scrollWidth > el.clientWidth + 1));
    check(!overflow, 'English control and action rows fit the 320px iframe');
    const overlap = await frame.evaluate(() => [...document.querySelectorAll('.ctrls:not([hidden]) .ctrl-row .lbl')].some(label => {
      const text = document.createRange(); text.selectNodeContents(label);
      return text.getBoundingClientRect().right > label.nextElementSibling.getBoundingClientRect().left - 2;
    }));
    check(!overlap, 'English field text does not overlap adjacent controls at 320px');
    await page.screenshot({ path: join(out, 'background-en-320.png') });
    await frame.evaluate(() => window.__circleHost.reject = '作者服务：额度不足 / quota');
    const failure = await dialog(() => frame.locator('#btnDrag').click());
    check(failure === 'Upload to library failed: 作者服务：额度不足 / quota', 'English upload-error prefix preserves the exact host detail');
    const bg = await uploadInfo(); check(bg.width === 360 && bg.height === 240 && /^Background removed-\d+$/.test(bg.fields.name), 'background output keeps source aspect and localized generated name');
    check(!await frame.locator('#btnDrag').isDisabled() && await frame.locator('#bg-tolerance').inputValue() === '51', 'upload failure permits retry without clearing controls');
    await language('zh'); await page.screenshot({ path: join(out, 'background-zh-320.png') });
    await frame.evaluate(() => { window.__circleHost.reject = ''; }); await language('en'); await frame.locator('#btnDrag').click();
    await frame.waitForFunction(() => document.querySelector('#btnDrag').classList.contains('ok'));
    const narrowSuccess = await snapshot(); await page.screenshot({ path: join(out, 'uploaded-en-320.png') });
    await language('zh'); assert.deepEqual(await snapshot(), narrowSuccess); checks.push('narrow success text does not resize the canvas or change crop state on Chinese switch');
    await page.screenshot({ path: join(out, 'uploaded-zh-320.png') });
    await language('en'); assert.deepEqual(await snapshot(), narrowSuccess); checks.push('narrow English success text also preserves exact canvas and focus');
    await load('lang=en&wait=1'); await importImage();
    check(await dialog(() => frame.locator('#btnDrag').click()) === 'OBR is still starting. Try again shortly.' && await sent() === 0, 'not-ready host blocks upload with English feedback');
    await frame.evaluate(() => window.__circleHost.becomeReady());
    await frame.evaluate(() => { HTMLCanvasElement.prototype.toBlob = function(done) { done(null); }; });
    check(await dialog(() => frame.locator('#btnDrag').click()) === 'Could not create the image: canvas.toBlob returned null', 'bake failure translates the wrapper and retains diagnostic detail');
    await frame.locator('#btnClose').click();
    check(await frame.evaluate(() => window.__circleHost.calls.some(call => call.type === 'OBR_POPOVER_CLOSE' && call.data.id === 'com.obr-suite/circleimage/editor')), 'actual PopoverApi preserves the close target');
    await frame.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    check(await frame.evaluate(() => window.__circleHost.listenerCount()) === 0, 'pagehide removes the added language subscription');
    await language('zh'); check(await frame.title() === 'Image editor', 'retired page does not translate again');
  }
  assert.deepEqual(errors, []);
  writeFileSync(join(out, 'result.json'), JSON.stringify({ baseline, passed: checks.length, checks, errors, scope: 'Native Edge iframe + real page and Canvas; simulated OBR host, no actual room upload.' }, null, 2));
  console.log(`${baseline ? 'BASELINE' : 'PASS'} ${checks.length}; artifacts: ${out}`);
} finally { await browser.close(); await new Promise(done => server.close(done)); }
