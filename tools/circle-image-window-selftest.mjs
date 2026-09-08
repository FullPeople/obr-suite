// Actual background + editor iframe + SDK Tool/Popover/Player/Viewport/Broadcast.
// The controlled host removes the iframe during close, before its SDK promise returns.
import assert from 'node:assert/strict';
import { build } from 'rolldown';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PACKAGE ?? 'C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const out = mkdtempSync(join(tmpdir(), 'circle-image-window-'));
const boundary = resolve('tools/fixtures/circle-image-window-sdk.ts');
const product = ['src/modules/circleImage/index.ts', 'src/modules/circleImage/popover-page.ts', 'src/modules/circleImage/window-protocol.ts'];
const hashes = () => Object.fromEntries(product.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]));
const beforeHashes = hashes();
const plugins = [{ name: 'circle-window-host', resolveId(id) {
  if (id === 'background-entry') return '\0background';
  if (id === '@owlbear-rodeo/sdk' || /^(\.\.\/)+state$/.test(id)) return boundary;
}, load(id) { if (id === '\0background') return `import {setupCircleImage,teardownCircleImage} from ${JSON.stringify(resolve(product[0]))}; window.__background={setup:setupCircleImage,teardown:teardownCircleImage}; await setupCircleImage();`; }, transform(code) { return code.replaceAll('import.meta.env.BASE_URL', '"/"'); } }];
await build({ input: { background: 'background-entry', page: resolve(product[1]) }, platform: 'browser', plugins, output: { dir: out, format: 'esm', entryFileNames: '[name].js', chunkFileNames: '[name]-[hash].js' } });
const html = readFileSync('circleimage.html', 'utf8').replace('/src/modules/circleImage/popover-page.ts', '/page.js');
const server = createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  res.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript;charset=utf-8' : 'text/html;charset=utf-8');
  if (pathname.endsWith('.js')) res.end(readFileSync(join(out, pathname.slice(1))));
  else res.end(pathname === '/circleimage.html' ? html : '<meta charset="utf-8"><title>Circle image lifecycle fixture</title><body><script type="module" src="/background.js"></script>');
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const browser = await chromium.launch({ headless: true, channel: 'msedge' });
const page = await browser.newPage({ viewport: { width: 960, height: 680 } });
const checks = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
const check = (value, message) => { assert.ok(value, message); checks.push(message); };
const WINDOW_CLOSE = 'com.obr-suite/circleimage/window-close', WINDOW_RESULT = 'com.obr-suite/circleimage/window-close-result';
let base;
const host = action => page.evaluate(action);
const latestFrame = async () => {
  await page.waitForSelector('iframe');
  const frame = await (await page.$('iframe')).contentFrame();
  await frame.waitForFunction(() => window.__circleWindowEndpoint);
  await frame.waitForFunction(() => !document.querySelector('#btnClose').disabled);
  return frame;
};
const clickTool = () => host(() => window.__circleWindowHost.click());
const frameCount = () => page.locator('iframe').count();
const getNonce = frame => new URL(frame.url()).searchParams.get('circleSession');
const waitClose = () => page.waitForFunction(() => !document.querySelector('iframe'));
try {
  for (let attempt = 0; ; attempt++) {
    base = `http://127.0.0.1:${server.address().port}`;
    try { await page.goto(base); break; } catch (error) {
      if (attempt >= 3 || !String(error).includes('ERR_UNSAFE_PORT')) throw error;
      await new Promise(done => server.close(done)); await new Promise(done => server.listen(0, '127.0.0.1', done));
    }
  }
  await page.waitForFunction(() => window.__circleWindowHost?.tool);
  await clickTool(); let frame = await latestFrame();
  const oldNonce = getNonce(frame);
  const image = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="90" height="90"><rect width="90" height="90" fill="#248aca"/></svg>');
  await frame.locator('#file-input').setInputFiles({ name: '作者图片.svg', mimeType: 'image/svg+xml', buffer: image });
  await frame.waitForSelector('#editor.active');
  const pixels = await frame.locator('canvas').evaluate(canvas => canvas.toDataURL());
  await frame.locator('#ring-width').evaluate(input => { input.value = '8'; input.dispatchEvent(new Event('input')); });
  await host(() => window.__circleWindowHost.language('zh'));
  check(await frame.locator('.ttl').innerText() === '图片处理' && await frame.locator('#ring-width').inputValue() === '8' && await host(() => window.__circleWindowHost.framesOpened) === 1, 'live Chinese entry/page labels preserve the same iframe and image controls');
  await host(() => window.__circleWindowHost.language('en'));
  check(getNonce(frame) === oldNonce && await frame.locator('canvas').evaluate(canvas => !!canvas.toDataURL()) && pixels.length > 100, 'language changes retain the current window generation and decoded canvas');
  await frame.locator('#btnClose').click(); await waitClose();
  const closeMessage = await host(() => window.__circleWindowHost.calls.find(call => call.type === 'OBR_BROADCAST_SEND_MESSAGE'));
  check(closeMessage.data.options.destination === 'LOCAL' && closeMessage.data.channel === WINDOW_CLOSE && closeMessage.data.data.windowNonce === oldNonce && Object.keys(closeMessage.data.data).sort().join() === 'requestId,windowNonce', 'actual editor sends only its window/request IDs through local SDK broadcast');
  await clickTool(); frame = await latestFrame();
  const newNonce = getNonce(frame);
  check(newNonce !== oldNonce && await host(() => window.__circleWindowHost.framesOpened) === 2, 'close destroys the iframe before SDK acknowledgement yet one native click reopens');
  await page.evaluate(({ channel, windowNonce }) => window.__circleWindowHost.message(channel, { windowNonce, requestId: crypto.randomUUID() }), { channel: WINDOW_CLOSE, windowNonce: oldNonce });
  await page.waitForTimeout(30);
  check(await frameCount() === 1 && getNonce(frame) === newNonce, 'a retired iframe close request cannot close the replacement window');
  await page.evaluate(({ channel, windowNonce }) => window.__circleWindowHost.message(channel, { windowNonce, requestId: crypto.randomUUID() }, 'another-player'), { channel: WINDOW_CLOSE, windowNonce: newNonce });
  await page.waitForTimeout(30);
  check(await frameCount() === 1, 'a different player connection cannot request closure even with the current window ID');

  await frame.locator('#file-input').setInputFiles({ name: 'image.svg', mimeType: 'image/svg+xml', buffer: image });
  await frame.waitForSelector('#editor.active'); await frame.waitForTimeout(50);
  const failurePixels = await frame.locator('canvas').evaluate(canvas => canvas.toDataURL());
  await host(() => window.__circleWindowHost.failClose = true);
  await frame.locator('#btnClose').click();
  await frame.locator('[role=alert]').waitFor({ state: 'visible' });
  check(await frame.locator('[role=alert]').innerText() === 'Could not close the editor. Click Close to retry.' && await frame.locator('#btnClose').isEnabled(), 'host close rejection stays on the same page with a usable English retry');
  check(await frame.locator('canvas').evaluate(canvas => canvas.toDataURL()) === failurePixels, 'close error presentation leaves exact canvas pixels and crop framing unchanged');
  check(await frame.evaluate(() => {
    const notice = document.querySelector('[role=alert]').getBoundingClientRect();
    const close = document.querySelector('#btnClose').getBoundingClientRect();
    return [...document.querySelectorAll('.tab')].every(tab => notice.bottom <= tab.getBoundingClientRect().top)
      && notice.right <= close.left && getComputedStyle(document.querySelector('.ttl')).visibility === 'hidden';
  }), 'English close notice uses the title space without obscuring tabs or Close');
  await page.locator('iframe').screenshot({ path: join(out, 'close-failed-en.png') });
  await host(() => window.__circleWindowHost.language('zh'));
  check(await frame.locator('canvas').evaluate(canvas => canvas.toDataURL()) === failurePixels, 'translating the close error also preserves exact canvas pixels');
  check(await frame.locator('[role=alert]').innerText() === '未能关闭编辑页，请再次点击关闭重试。' && await frameCount() === 1, 'close failure text translates in place without closing or reopening the editor');
  check(await frame.evaluate(() => {
    const notice = document.querySelector('[role=alert]').getBoundingClientRect();
    return [...document.querySelectorAll('.tab')].every(tab => notice.bottom <= tab.getBoundingClientRect().top)
      && notice.right <= document.querySelector('#btnClose').getBoundingClientRect().left;
  }), 'Chinese close notice leaves mode tabs and Close unobscured');
  await page.locator('iframe').screenshot({ path: join(out, 'close-failed-zh.png') });
  await host(() => window.__circleWindowHost.failClose = false);
  await frame.locator('#btnClose').click(); await waitClose();
  await clickTool(); frame = await latestFrame();
  check(await frameCount() === 1, 'retry closes successfully and the next tool click opens directly');

  const closeRequestsBeforeRead = await host(() => window.__circleWindowHost.calls.filter(call => call.type === 'OBR_BROADCAST_SEND_MESSAGE' && call.data.channel.endsWith('window-close')).length);
  await host(() => window.__circleWindowHost.failConnection = true);
  await frame.locator('#btnClose').click(); await frame.locator('[role=alert]').waitFor({ state: 'visible' });
  check(await frame.locator('#btnClose').isEnabled() && await host(() => window.__circleWindowHost.calls.filter(call => call.type === 'OBR_BROADCAST_SEND_MESSAGE' && call.data.channel.endsWith('window-close')).length) === closeRequestsBeforeRead, 'failed page identity read permits retry without dispatching an unauthenticated close');
  await frame.locator('#btnClose').click(); await waitClose();
  await clickTool(); frame = await latestFrame();

  await host(() => window.__circleWindowHost.failSend = true);
  await frame.locator('#btnClose').click(); await frame.locator('[role=alert]').waitFor({ state: 'visible' });
  check(await frame.locator('#btnClose').isEnabled() && await frameCount() === 1, 'local message dispatch rejection restores same-page retry without falsely closing');
  await frame.locator('#btnClose').click(); await waitClose();
  await clickTool(); frame = await latestFrame();

  await host(() => { window.__circleWindowHost.failClose = true; window.__circleWindowHost.failCloseReply = true; });
  await frame.locator('#btnClose').click();
  await frame.locator('[role=alert]').waitFor({ state: 'visible', timeout: 7000 });
  check(await frame.locator('#btnClose').isEnabled(), 'a lost local result times out once and restores the close button without a retry loop');
  await host(() => { window.__circleWindowHost.failClose = false; window.__circleWindowHost.failCloseReply = false; window.__circleWindowHost.holdClose = true; });
  await frame.locator('#btnClose').click();
  await page.waitForFunction(() => window.__circleWindowHost.releaseClose);
  const request = await host(() => window.__circleWindowHost.calls.filter(call => call.type === 'OBR_BROADCAST_SEND_MESSAGE' && call.data.channel.endsWith('window-close')).at(-1).data.data);
  await page.evaluate(({ channel, oldNonce, requestId }) => window.__circleWindowHost.message(channel, { windowNonce: oldNonce, requestId, status: 'error' }), { channel: WINDOW_RESULT, oldNonce, requestId: request.requestId });
  check(await frame.locator('#btnClose').isDisabled(), 'a retired window result cannot unlock or change a new pending close');
  await page.evaluate(({ channel, windowNonce, requestId }) => window.__circleWindowHost.message(channel, { windowNonce, requestId, status: 'error' }, 'another-player'), { channel: WINDOW_RESULT, windowNonce: request.windowNonce, requestId: request.requestId });
  check(await frame.locator('#btnClose').isDisabled(), 'a different connection cannot forge a close failure for the current window and request');
  await host(() => { window.__circleWindowHost.holdClose = false; window.__circleWindowHost.releaseClose(); }); await waitClose();
  await clickTool(); frame = await latestFrame();
  const activeNonce = getNonce(frame);
  await host(() => window.__background.teardown()); await waitClose();
  check(await host(() => window.__circleWindowHost.endpoints.reduce((sum, endpoint) => sum + endpoint.count('language') + endpoint.count('OBR_BROADCAST_MESSAGE_com.obr-suite/circleimage/window-close') + endpoint.count('OBR_BROADCAST_MESSAGE_com.obr-suite/circleimage/window-close-result'), 0)) === 0, 'teardown removes background close/language and real retired iframe subscriptions');
  const stoppedCalls = await host(() => window.__circleWindowHost.calls.length);
  await page.evaluate(({ channel, windowNonce }) => window.__circleWindowHost.message(channel, { windowNonce, requestId: crypto.randomUUID() }), { channel: WINDOW_CLOSE, windowNonce: activeNonce });
  await host(() => window.__circleWindowHost.language('en')); await clickTool(); await page.waitForTimeout(30);
  check(await host(() => window.__circleWindowHost.calls.length) === stoppedCalls && await frameCount() === 0, 'late page messages and native clicks cannot revive a stopped module');
  check(await host(() => window.__circleWindowHost.calls.filter(call => call.type === 'OBR_BROADCAST_SEND_MESSAGE').every(call => call.data.options.destination === 'LOCAL')) && await host(() => window.__circleWindowHost.activeTool) === 'rodeo.owlbear.tool/move', 'all lifecycle broadcasts stay on this client and the active canvas tool remains Move');
  assert.deepEqual(errors, []);
  assert.deepEqual(hashes(), beforeHashes);
  writeFileSync(join(out, 'result.json'), JSON.stringify({ passed: checks.length, checks, errors, hashes: beforeHashes, scope: 'Actual Edge background and editor iframe with installed SDK APIs; controlled host, no real room or upload.' }, null, 2));
  console.log(`PASS ${checks.length} circle window lifecycle checks; artifacts: ${out}`);
} finally { await browser.close(); await new Promise(done => server.close(done)); }
