import { build } from 'rolldown';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const out = resolve('workbench-test-output/notices-181');
mkdirSync(out, { recursive: true });
const { chromium, expect } = createRequire('D:/Desktop/DND-card-web/package.json')('@playwright/test');
const plugins = [
  { name: 'environment', transform: code => code.replaceAll('import.meta.env.BASE_URL', JSON.stringify('/suite-dev/')).replaceAll('import.meta.env.DEV', 'false') },
  { name: 'sdk-boundary', resolveId: id => id === '@owlbear-rodeo/sdk' ? resolve('tools/fixtures/workbench-notice-181-sdk.ts') : null },
];
for (const [input, file] of [['tools/workbench-notice-181-selftest.entry.ts', 'host.js'], ['src/resource-toast-page.ts', 'toast.js']]) {
  await build({ input: resolve(input), plugins, output: { file: join(out, file), format: 'esm' } });
}
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<title>Notice lifecycle probe</title><button id="underlay">Underlying room remains clickable</button><script>let clicks=0;document.querySelector("button").onclick=()=>window.clicks=++clicks</script><script type="module" src="/host.js"></script>'); return; }
  if (path === '/suite-dev/resource-toast.html') { res.setHeader('Content-Type', 'text/html'); res.end(readFileSync('resource-toast.html', 'utf8').replace('/src/resource-toast-page.ts', '/toast.js')); return; }
  if (path === '/host.js' || path === '/toast.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(readFileSync(join(out, path.slice(1)))); return; }
  res.writeHead(404); res.end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
const errors = [], results = [], measurements = {};
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
const notice = (id, extra = {}) => ({ noticeId: id, tokenId: 'hero', tokenName: '测试角色', resource: { id: 'hp', name: '生命值', current: 9, max: 10, type: 'number', icon: 'gem' }, delta: -1, prevValue: 10, ...extra });
async function open(query = '') { const page = await context.newPage(); await page.goto(base + '/' + query); await page.waitForFunction(() => typeof window.publishNotice === 'function'); return page; }
async function ready(page) { await expect.poll(() => page.evaluate(() => window.noticeMock.messages.filter(m => m.channel.endsWith('/toast-ready')).length)).toBeGreaterThan(0); }
async function publish(page, data) { await page.evaluate(data => window.publishNotice(data), data); }
async function latency(page, data) {
  return page.evaluate(async data => {
    const frame = document.querySelector('#notice-overlay'); const stack = frame.contentDocument.querySelector('#stack');
    const start = performance.now();
    const elapsed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { observer.disconnect(); reject(Error('toast did not render')); }, 2000);
      const observer = new MutationObserver(() => { if (stack.querySelector('.toast')) { observer.disconnect(); clearTimeout(timer); resolve(performance.now() - start); } });
      observer.observe(stack, { childList: true });
    });
    void window.publishNotice(data); return elapsed;
  }, data);
}
async function check(name, run) { await run(); results.push(name); console.log('PASS', results.length, name); }
try {
  await check('scene prewarm, first notice and post-idle notice do not rebuild or intercept input', async () => {
    const page = await open(); await ready(page);
    assert.equal(await page.evaluate(() => window.noticeMock.opens.length), 1);
    assert.equal(await page.evaluate(() => window.noticeMock.closes.length), 0);
    const flags = await page.evaluate(() => window.noticeMock.opens[0]);
    assert(flags.fullScreen && flags.hidePaper && flags.hideBackdrop && flags.disablePointerEvents);
    await page.locator('#underlay').click(); assert.equal(await page.evaluate(() => window.clicks), 1);
    const firstMs = await latency(page, notice('first'));
    assert(firstMs < 250, `first warmed display ${firstMs}ms`);
    await page.screenshot({ path: join(out, 'first-notice.png') });
    await page.waitForTimeout(6100);
    const idle = await page.evaluate(() => ({ opens: window.noticeMock.opens.length, closes: window.noticeMock.closes.length, toasts: document.querySelector('iframe').contentDocument.querySelectorAll('.toast').length, animations: document.querySelector('iframe').contentDocument.getAnimations().length }));
    assert.deepEqual(idle, { opens: 1, closes: 0, toasts: 0, animations: 0 });
    const idleMs = await latency(page, notice('after-idle'));
    assert(idleMs < 250, `idle display ${idleMs}ms`);
    assert.equal(await page.evaluate(() => window.noticeMock.opens.length), 1);
    measurements.latencyMs = { first: firstMs, afterIdle: idleMs };
    await page.close();
  });
  await check('lost READY is recovered by handshake without iframe recreation', async () => {
    const page = await open('?dropReady=1'); await ready(page);
    const elapsed = await latency(page, notice('lost-ready'));
    assert(elapsed < 250);
    assert.equal(await page.evaluate(() => window.noticeMock.opens.length), 1);
    await expect.poll(() => page.evaluate(() => window.noticeMock.messages.filter(m => m.channel.endsWith('/toast-ready')).length)).toBeGreaterThan(1);
    await page.close();
  });
  await check('lost ACK retries and renderer reconstruction display and sound exactly once', async () => {
    const page = await open(); await ready(page);
    await page.evaluate(() => { window.noticeMock.dropAck = true; });
    await publish(page, notice('lost-ack'));
    await expect.poll(() => page.evaluate(() => window.noticeMock.opens.length)).toBe(2);
    await page.evaluate(() => { window.noticeMock.dropAck = false; });
    await page.waitForTimeout(700);
    const state = await page.evaluate(() => ({ visuals: window.noticeMock.visuals.length, sounds: window.noticeMock.messages.filter(m => m.channel === 'com.obr-suite/sfx').length, fallback: window.noticeMock.notifications.length, ack: window.noticeMock.messages.filter(m => m.channel.endsWith('/toast-ack')).length }));
    assert.equal(state.visuals, 1); assert.equal(state.sounds, 1); assert.equal(state.fallback, 0); assert(state.ack >= 2);
    await page.waitForTimeout(800); assert.equal(await page.evaluate(() => window.noticeMock.notifications.length), 0);
    await page.close();
  });
  await check('modal failure falls back privately, recovers next notice, and never replays fallback', async () => {
    const page = await open('?failOpen&deferHostRole');
    await page.waitForFunction(() => typeof window.noticeMock.resolveHostRole === 'function');
    const data = notice('private-fallback', { privateFor: ['other'], privateSummary: '有人消耗了资源', summary: '秘密角色消耗了秘密法术' });
    await publish(page, data);
    await page.evaluate(() => { window.noticeMock.changeRole('PLAYER'); window.noticeMock.resolveHostRole(); });
    await expect.poll(() => page.evaluate(() => window.noticeMock.notifications.length), { timeout: 4500 }).toBe(1);
    assert.equal(await page.evaluate(() => window.noticeMock.notifications[0].text), '有人消耗了资源');
    const wire = await page.evaluate(() => window.noticeMock.messages.filter(m => m.destination === 'REMOTE'));
    assert(!JSON.stringify(wire).includes('秘密')); assert(!JSON.stringify(wire).includes('privateFor'));
    await page.evaluate(() => { window.noticeMock.failOpen = false; }); await publish(page, notice('recovered'));
    await expect.poll(() => page.evaluate(() => window.noticeMock.visuals.length)).toBe(1);
    assert.equal(await page.evaluate(() => window.noticeMock.notifications.length), 1);
    await page.close();
  });
  await check('complete ACK loss does not duplicate an already displayed notice as native fallback', async () => {
    const page = await open(); await ready(page);
    await page.evaluate(() => { window.noticeMock.dropAck = true; });
    await publish(page, notice('all-acks-lost'));
    await page.waitForTimeout(3500);
    const state = await page.evaluate(() => ({ visuals: window.noticeMock.visuals.length, sounds: window.noticeMock.messages.filter(m => m.channel === 'com.obr-suite/sfx').length, fallback: window.noticeMock.notifications.length, opens: window.noticeMock.opens.length }));
    assert.deepEqual(state, { visuals: 1, sounds: 1, fallback: 0, opens: 2 });
    await page.close();
  });
  await check('renderer applies a new PLAYER role before stale initial GM result', async () => {
    const page = await open('?deferToastRole');
    await page.waitForFunction(() => typeof window.noticeMock.resolveToastRole === 'function');
    await page.evaluate(() => { window.noticeMock.changeRole('PLAYER'); window.noticeMock.resolveToastRole(); });
    await ready(page);
    await publish(page, notice('private-render', { privateFor: ['other'], privateSummary: '有人恢复了资源', summary: '秘密角色恢复了秘密法术' }));
    await expect.poll(() => page.evaluate(() => window.noticeMock.visuals.length)).toBe(1);
    const text = await page.frameLocator('#notice-overlay').locator('#stack').innerText();
    assert(text.includes('有人恢复了资源')); assert(!text.includes('秘密'));
    await page.close();
  });
  await check('rapid scene close/reopen serializes late modal work and cleans up on close', async () => {
    const page = await open('?openDelay=200');
    await page.waitForFunction(() => window.noticeMock.opens.length === 1);
    await page.evaluate(() => { window.noticeMock.scene(false); window.noticeMock.scene(true); });
    await ready(page); await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.noticeMock.opens.length), 2);
    assert.equal(await page.evaluate(() => window.noticeMock.closes.length), 1);
    await publish(page, notice('new-scene'));
    await expect.poll(() => page.evaluate(() => window.noticeMock.visuals.length)).toBe(1);
    await page.evaluate(() => window.noticeMock.scene(false));
    await expect(page.locator('#notice-overlay')).toHaveCount(0);
    await page.waitForTimeout(700);
    assert.equal(await page.evaluate(() => window.noticeMock.notifications.length), 0);
    await page.close();
  });
  assert.deepEqual(errors, []);
  writeFileSync(join(out, 'results.json'), JSON.stringify({ results, ...measurements, errors, realSdkRoom: false, at: new Date().toISOString() }, null, 2));
  console.log('PASS', results.filter(r => typeof r === 'string').length, 'notice lifecycle cases; real production host/renderer over simulated SDK boundary');
} finally { await context.close(); await browser.close(); await new Promise(resolve => server.close(resolve)); }
