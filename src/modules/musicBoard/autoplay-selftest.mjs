// Actual MusicAudio in a cross-origin parent's sibling iframes. No autoplay
// bypass flags, no mocked Audio/AudioContext. Local fixture, not Owlbear UAT.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { rolldown } from "rolldown";
const out = mkdtempSync(join(tmpdir(), "music-autoplay-"));
const build = await rolldown({ input: resolve("src/modules/musicBoard/audio.ts"), platform: "browser" });
await build.write({ file: join(out, "audio.js"), format: "esm" }); await build.close();
const samples = 44100 * 4, wav = Buffer.alloc(44 + samples * 2);
wav.write("RIFF"); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(88200, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write("data", 36); wav.writeUInt32LE(samples * 2, 40);
for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 220 / 44100) * 1800), 44 + i * 2);
const child = createServer((request, response) => {
  if (request.url === "/audio.js") { response.setHeader("Content-Type", "text/javascript"); response.end(readFileSync(join(out, "audio.js"))); }
  else if (request.url === "/tone.wav") { response.setHeader("Content-Type", "audio/wav"); response.setHeader("Access-Control-Allow-Origin", "*"); response.end(wav); }
  else if (request.url?.startsWith("/background")) response.end(`<script type="module">import {MusicAudio} from '/audio.js';window.engine=new MusicAudio(()=>{},()=>{});window.channel=new BroadcastChannel('music-probe');channel.onmessage=()=>engine.unlock();engine.apply({version:2,revision:1,author:'test',allowPlayers:true,tracks:[],queue:[],sfx:[],bus:{bgm:.8,sfx:1},recent:[],ts:Date.now(),bgm:{track:{id:'tone',name:'Fixture tone',url:location.origin+'/tone.wav',duration:4,loop:true,bus:'bgm'},playbackId:'one',position:0,startedAt:Date.now(),paused:false}});engine.unlock();</script>`);
  else response.end(`<button id="enable">Enable sound</button><script>window.channel=new BroadcastChannel('music-probe');document.getElementById('enable').onclick=()=>channel.postMessage('enable');</script>`);
});
await new Promise(resolve => child.listen(0, "127.0.0.1", resolve)); const childUrl = `http://127.0.0.1:${child.address().port}`;
const parent = createServer((request, response) => { const allow = request.url?.includes("deny") ? "autoplay 'none'" : "autoplay";
  response.end(`<iframe id="background" style="display:none" src="${childUrl}/background" allow="${allow}"></iframe><iframe id="control" src="${childUrl}/control" allow="${allow}"></iframe><button id="close" onclick="document.getElementById('control').remove()">Close controls</button>`); });
await new Promise(resolve => parent.listen(0, "127.0.0.1", resolve));
const runtime = process.env.CODEX_PLAYWRIGHT_DIR || "C:/Users/admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright";
const { chromium } = await import(pathToFileURL(join(runtime, "index.mjs")).href);
const browser = await chromium.launch({ headless: true, executablePath: process.env.BOSS_CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe",
  args: ["--disable-features=PreloadMediaEngagementData,MediaEngagementBypassAutoplayPolicies"] });
const results = [];
try {
  for (const policy of ["allow", "deny"]) {
    const context = await browser.newContext(); const page = await context.newPage(); await page.goto(`http://127.0.0.1:${parent.address().port}/${policy}`);
    const background = page.frames().find(frame => frame.url().includes("/background")); await background.waitForFunction(() => window.engine);
    await page.waitForTimeout(1400); const before = await background.evaluate(() => ({ status: engine.status, position: engine.progress().position }));
    await page.frameLocator("#control").locator("#enable").click(); await page.waitForTimeout(1500);
    const after = await background.evaluate(() => ({ status: engine.status, position: engine.progress().position }));
    await page.locator("#close").click(); await page.waitForTimeout(500);
    const closed = await background.evaluate(() => ({ status: engine.status, position: engine.progress().position }));
    results.push({ policy, before, after, closed }); await context.close();
  }
} finally { await browser.close(); await new Promise(resolve => parent.close(resolve)); await new Promise(resolve => child.close(resolve)); }
writeFileSync(join(out, "results.json"), JSON.stringify(results, null, 2)); console.log(JSON.stringify({ results, artifacts: out }, null, 2));
if (results[0].after.status !== "ready" || results[0].closed.status !== "ready") process.exitCode = 1;
