// Actual Chromium pixels over colored host content. SDK startup is deliberately
// absent: this tests the browser's iframe canvas, with the real page HTML/CSS.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const runtime = process.env.CODEX_NODE_MODULES || 'C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const { chromium } = await import(pathToFileURL(join(runtime, 'playwright/index.mjs')).href);
const { PNG } = (await import(pathToFileURL(join(runtime, 'pngjs/lib/png.js')).href)).default;
const repo = resolve(import.meta.dirname, '..');
const out = mkdtempSync(join(tmpdir(), 'boss-transparency-'));
const normalRootCandidate = process.argv.includes('--normal-root');
const sha = text => createHash('sha256').update(text).digest('hex');
const pages = {
  boss: ['boss-bar.html', 'src/modules/bossBar/style.css', 'display'],
  transition: ['transition-display.html', 'src/modules/transitions/style.css', 'presentation'],
  cinematic: ['timestop-overlay.html', null, ''],
};
const sources = {};
for (const [kind, paths] of Object.entries(pages)) {
  sources[kind] = {};
  for (const version of ['baseline', 'fixed']) {
    const read = file => version === 'fixed' ? readFileSync(join(repo, file), 'utf8') : execFileSync('git', ['-c', `safe.directory=${repo.replaceAll('\\', '/')}`, 'show', `3ca3e9a:${file}`], { cwd: repo, encoding: 'utf8' });
    const html = read(paths[0]);
    const css = paths[1] ? read(paths[1]) : '';
    sources[kind][version] = { html, css, htmlSha256: sha(html), cssSha256: sha(css) };
    writeFileSync(join(out, `${kind}-${version}.html`), html);
    if (paths[1]) writeFileSync(join(out, `${kind}-${version}.css`), css);
  }
}

const colors = [[213, 49, 87, 255], [26, 165, 120, 255], [34, 92, 207, 255], [230, 183, 36, 255]];
const points = [[80, 60], [560, 60], [80, 410], [560, 410]];
let portA, portB;
const handler = (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  response.setHeader('content-type', 'text/html; charset=utf-8');
  response.setHeader('cache-control', 'no-store');
  if (url.pathname === '/child') {
    const kind = url.searchParams.get('kind'), version = url.searchParams.get('version');
    const source = sources[kind]?.[version];
    if (!source) { response.writeHead(404); response.end(); return; }
    let html = source.html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
    if (normalRootCandidate && version === 'fixed') html = html.replace(/(<meta\s+name="color-scheme"\s+content=")[^"]+/i, '$1normal');
    html = html.replace('<body>', `<body class="${pages[kind][2]}">`);
    // These are exactly the runtime classes of the presentation page, including
    // the historical version that only applied presentation-root from JS.
    if (kind === 'transition' && !/<html[^>]*class=/.test(html)) html = html.replace('<html ', '<html class="presentation-root" ');
    html = html.replace('</head>', `<style>${source.css}${normalRootCandidate && version === 'fixed' ? '\n:root{color-scheme:normal!important}' : ''}</style></head>`);
    response.end(html); return;
  }
  const scheme = url.searchParams.get('parent');
  const childPort = url.searchParams.get('origin') === 'cross' ? portB : portA;
  const child = `http://127.0.0.1:${childPort}/child?kind=${url.searchParams.get('kind')}&version=${url.searchParams.get('version')}`;
  response.end(`<!doctype html><html style="color-scheme:${scheme}"><head><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}#colors{position:fixed;inset:0;display:grid;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr}iframe{position:fixed;inset:0;width:100%;height:100%;border:0;background:transparent;pointer-events:none}</style></head><body><div id="colors">${colors.map(c => `<div style="background:rgb(${c.slice(0, 3).join(',')})"></div>`).join('')}</div><iframe src="${child}"></iframe></body></html>`);
};
const servers = [createServer(handler), createServer(handler)];
for (const server of servers) await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
portA = servers[0].address().port; portB = servers[1].address().port;
const results = [];
try {
  for (const [browserName, executablePath] of [
    ['chrome', process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'],
    ['edge', process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'],
  ]) {
    assert.ok(existsSync(executablePath), `${browserName} must actually be installed`);
    for (const os of ['light', 'dark']) {
      // Playwright's colorScheme media emulation overrides EVERY frame and
      // prevents the native inherited preference from the embedding iframe.
      // Set the browser preference at startup, with media emulation disabled.
      const browser = await chromium.launch({ executablePath, headless: true,
        args: os === 'dark' ? ['--force-dark-mode'] : ['--blink-settings=preferredColorScheme=1'] });
      try {
        const context = await browser.newContext({ viewport: { width: 640, height: 480 }, colorScheme: null, deviceScaleFactor: 1 });
        const page = await context.newPage();
        assert.equal(await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches), os === 'dark', 'browser process uses requested preference, with no per-frame media emulation');
        for (const parent of normalRootCandidate ? ['normal'] : ['normal', 'light', 'dark']) for (const origin of ['same', 'cross']) {
          for (const kind of Object.keys(pages)) for (const version of normalRootCandidate ? ['fixed'] : ['baseline', 'fixed']) {
            const key = `${browserName}-${os}-${parent}-${origin}-${kind}-${version}`;
            await page.goto(`http://127.0.0.1:${portA}/?${new URLSearchParams({ parent, origin, kind, version })}`, { waitUntil: 'load' });
            const child = page.frames().find(frame => frame.url().includes('/child?'));
            assert.ok(child, 'actual embedded document loaded');
            const computed = await child.evaluate(() => ({
              rootScheme: getComputedStyle(document.documentElement).colorScheme,
              rootBackground: getComputedStyle(document.documentElement).backgroundColor,
              bodyBackground: getComputedStyle(document.body).backgroundColor,
              meta: document.querySelector('meta[name="color-scheme"]')?.content ?? null,
              prefersDark: matchMedia('(prefers-color-scheme: dark)').matches,
            }));
            const frameScheme = await page.locator('iframe').evaluate(node => getComputedStyle(node).colorScheme);
            const screenshot = await page.screenshot({ path: join(out, `${key}.png`), animations: 'disabled' });
            const png = PNG.sync.read(screenshot);
            const pixels = points.map(([x, y]) => Array.from(png.data.subarray((png.width * y + x) * 4, (png.width * y + x) * 4 + 4)));
            const transparent = JSON.stringify(pixels) === JSON.stringify(colors);
            const result = { key, browser: browserName, browserVersion: browser.version(), os, parent, origin, kind, version, frameScheme, computed, pixels, transparent };
            results.push(result);
            if (version === 'baseline' && kind === 'boss' && parent === 'light') {
              assert.ok(!transparent, `${key}: historical dark-root defect must reproduce`);
              assert.equal(computed.rootBackground, 'rgba(0, 0, 0, 0)');
              assert.equal(computed.bodyBackground, 'rgba(0, 0, 0, 0)');
              assert.ok(pixels.every(pixel => pixel[0] === pixel[1] && pixel[1] === pixel[2] && pixel[0] < 40), 'historical canvas is dark despite transparent computed backgrounds');
            }
          }
        }
        await context.close();
      } finally { await browser.close(); }
    }
  }
} finally {
  for (const server of servers) await new Promise(resolve => server.close(resolve));
  const report = {
    scope: 'Real Chrome/Edge raster pixels over a colored parent. Browser launch flags select light/dark preference; Playwright per-frame colorScheme emulation is disabled to preserve native iframe preference inheritance. Actual product HTML/CSS, scripts removed; runtime display classes applied. No SDK or native Owlbear modal exercised. CSS read once at process start; baseline from Git 3ca3e9a. Not animation, interaction, or multi-client UAT.',
    scriptSha256: sha(readFileSync(import.meta.filename)),
    candidateOverride: normalRootCandidate ? 'Test-only override of child root and early meta to normal; parent normal only. Product files unchanged by this script.' : null,
    supportedParentSchemes: ['normal', 'light'],
    boundary: 'Explicit dark parent iframe is measured and reported, but is not supported by this normal-root fix. Parent normal/light must work under either browser preference. Actual Owlbear host styling needs separate verification.',
    pins: Object.fromEntries(Object.entries(sources).map(([kind, versions]) => [kind, Object.fromEntries(Object.entries(versions).map(([version, value]) => [version, { htmlSha256: value.htmlSha256, cssSha256: value.cssSha256 }]))])),
    cases: results.length,
    fixedTransparent: results.filter(r => r.version === 'fixed' && r.transparent).length,
    fixedOpaque: results.filter(r => r.version === 'fixed' && !r.transparent).map(r => r.key),
    baselineOpaque: results.filter(r => r.version === 'baseline' && !r.transparent).length,
    expectedParentPixels: colors,
    results,
  };
  writeFileSync(join(out, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ out, cases: report.cases, fixedTransparent: report.fixedTransparent, baselineOpaque: report.baselineOpaque }));
}
assert.equal(results.length, normalRootCandidate ? 24 : 144);
assert.deepEqual(results.filter(r => r.version === 'fixed' && r.parent !== 'dark' && !r.transparent).map(r => r.key), [], 'normal/light parent frames must preserve the four parent colors under both browser preferences');
console.log(normalRootCandidate ? 'PASS: 24 normal-root candidate pixel cases across three pages, two browsers, two preferences and two origins; parent normal only.' : 'PASS: 48 corrected normal/light-parent pixel cases; 24 explicit-dark-parent boundary measurements; 72 historical comparisons. This is not a claim of compatibility with every host scheme.');
