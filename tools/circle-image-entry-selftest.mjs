// Run from a checkout: node tools/circle-image-entry-selftest.mjs [--verify-mutations].
// Uses the actual module and installed ToolApi, PopoverApi, PlayerApi, ViewportApi.
// No network, real room, browser or SDK installation changes are involved.
import assert from "node:assert/strict";
import { build } from "rolldown";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL, fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
const repoArg = process.argv.indexOf("--repo");
const repo = repoArg < 0 ? process.cwd() : resolve(process.argv[repoArg + 1]);
const mutation = process.argv.find(arg => arg.startsWith("--mutation="))?.split("=")[1];
const out = mkdtempSync(join(tmpdir(), "circle-image-entry-"));
const source = resolve(repo, "src/modules/circleImage/index.ts");
const host = resolve(repo, "tools/fixtures/circle-image-entry-sdk.ts");
const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex");
const sourceHash = hash(source);
const warnings = [], originalWarn = console.warn;
console.warn = (...args) => warnings.push(args.map(String).join(" "));
globalThis.window = new EventTarget();
window.location = globalThis.location = { origin: "https://fixture.invalid" };
const mutants = {
  "swallowed-lifecycle": ['return propagateError ? operation : entryQueue;', 'return entryQueue;'],
  "forget-retired": ['    retired.add(own);', '    /* mutation: drop cleanup ownership */'],
  "no-locale": ['if (isCurrent(own)) void queueEntry(() => refreshEntry(own));', 'if (false) void queueEntry(() => refreshEntry(own));'],
  "remove-for-label": ['await OBR.tool.create({ ...own.tool,', 'if (own.registered) await OBR.tool.remove(TOOL_ID); await OBR.tool.create({ ...own.tool,'],
  "stale-label-cache": ['  own.label = undefined;', '  /* mutation: retain the last acknowledged label */'],
  "stale-role": ['if (revision === own.roleRevision && role.status === "fulfilled") own.role = role.value;', 'if (role.status === "fulfilled") own.role = role.value;'],
  "old-window-close": ['      || request.windowNonce !== own.windowNonce) return;', '      ) return;'],
  "remote-close": [' || event.connectionId !== own.connectionId', ''],
  "late-width": ['if (!shouldOpen()) return;\n  own.windowNonce = crypto.randomUUID();', 'own.windowNonce = crypto.randomUUID();'],
};
let mutationApplied = false;
await build({ input: "circle-entry-probe", platform: "node", plugins: [{ name: "native-host-boundary", resolveId(id) {
  if (id === "circle-entry-probe") return "\0entry";
  if (id === "@owlbear-rodeo/sdk" || /(^|\/)state$/.test(id)) return host;
}, load(id) { if (id === "\0entry") return `export * from ${JSON.stringify(source)}; export {fixture} from ${JSON.stringify(host)}; export {ModuleLifecycle} from ${JSON.stringify(resolve(repo, "src/utils/moduleLifecycle.ts"))};`; }, transform(code, id) {
  code = code.replaceAll("import.meta.env.BASE_URL", '"/"');
  if (mutation && id.replaceAll("\\", "/").endsWith("/circleImage/index.ts")) {
    const [before, after] = mutants[mutation] ?? [];
    assert.ok(before && code.includes(before), `mutation anchor missing: ${mutation}`);
    mutationApplied = true; code = code.replace(before, after);
    if (mutation === 'old-window-close') code = code.replace('if (!isCurrent(own) || request.windowNonce !== own.windowNonce) return;', 'if (!isCurrent(own)) return;');
  }
  return code;
} }], output: { file: join(out, "probe.mjs"), format: "esm" } });
if (mutation) assert.ok(mutationApplied);
const { setupCircleImage: setup, teardownCircleImage: teardown, fixture: f, ModuleLifecycle } = await import(pathToFileURL(join(out, "probe.mjs")).href);
const TOOL = "com.obr-suite/circleimage/tool", POPOVER = "com.obr-suite/circleimage/editor";
const ZH = "圆形图片 / 去底", EN = "Circle crop / Remove background";
const CLOSE_CHANNEL = "com.obr-suite/circleimage/window-close", RESULT_CHANNEL = "com.obr-suite/circleimage/window-close-result";
const nonce = () => new URL(f.popovers.get(POPOVER).config.url).searchParams.get("circleSession");
const requestClose = (windowNonce, connectionId = f.connectionId) => f.event(`OBR_BROADCAST_MESSAGE_${CLOSE_CHANNEL}`, { connectionId, data: { windowNonce, requestId: crypto.randomUUID() } });
const CREATE = "OBR_TOOL_CREATE", REMOVE = "OBR_TOOL_REMOVE", OPEN = "OBR_POPOVER_OPEN", CLOSE = "OBR_POPOVER_CLOSE", ROLE = "OBR_PLAYER_GET_ROLE", WIDTH = "OBR_VIEWPORT_GET_WIDTH";
const delay = ms => new Promise(done => setTimeout(done, ms));
async function until(fn, reason = "host boundary") { const end = Date.now() + 1800; while (!fn()) { assert.ok(Date.now() < end, `${reason} timed out`); await delay(2); } }
const settled = () => delay(12);
const count = type => f.calls.filter(call => call.type === type).length;
const label = () => f.tools.get(TOOL)?.icons[0].label;
const checks = [];
function check(value, message) { assert.ok(value, message); checks.push(message); }
async function click() { await f.event("OBR_TOOL_EVENT_CLICK", { id: TOOL, context: { activeTool: f.activeTool, metadata: f.toolMetadata } }); }
async function held(type) { await until(() => f.held?.type === type, `held ${type}`); }
function release() { assert.ok(f.held); f.held.resolve(); }
async function clean() { await teardown(); await settled(); check(!f.tools.size && !f.popovers.size && f.listenerCount("language") === 0 && f.listenerCount("OBR_PLAYER_EVENT_CHANGE") === 0 && f.listenerCount(`OBR_BROADCAST_MESSAGE_${CLOSE_CHANNEL}`) === 0, "teardown removes owned entries/windows and both session subscriptions"); }

await Promise.all([setup(), setup()]);
check(label() === ZH && f.tools.size === 1, "initial Chinese GM entry uses the existing single tool ID");
check(f.listenerCount("language") === 1 && f.listenerCount("OBR_PLAYER_EVENT_CHANGE") === 1 && count(ROLE) === 1, "duplicate setup shares one initial role read and subscriptions");
const def = f.tools.get(TOOL);
check(def.icons[0].icon === "https://fixture.invalid/circleimage-icon.svg" && def.icons[0].filter.roles.join() === "GM" && def.defaultMode === undefined && def.defaultMetadata === undefined, "installed SDK keeps GM filter and icon URL without supplying tool mode or metadata resets");
await click(); await until(() => f.popovers.size === 1);
const editor = f.popovers.get(POPOVER), config = editor.config;
check(new URL(config.url).pathname === "/circleimage.html" && /^[a-f0-9-]{36}$/i.test(nonce()) && config.width === 420 && config.height === 600 && config.anchorPosition.left === 601 && config.anchorPosition.top === 60 && config.hidePaper && config.disableClickAway, "actual click opens the original editor URL, dimensions and canvas-friendly placement");
const baseline = { opens: f.opens, closes: f.closes, removes: count(REMOVE), active: f.activeTool, mode: f.activeMode, selection: JSON.stringify(f.selection), metadata: JSON.stringify(f.toolMetadata) };
await f.language("en"); await until(() => label() === EN, "live English label");
await f.language("zh"); await until(() => label() === ZH);
check(f.popovers.get(POPOVER) === editor && editor.draft === "unsaved crop and image" && f.opens === baseline.opens && f.closes === baseline.closes, "English/Chinese entry updates retain the editor instance and unfinished image work");
check(count(REMOVE) === baseline.removes && f.activeTool === baseline.active && f.activeMode === baseline.mode && JSON.stringify(f.selection) === baseline.selection && JSON.stringify(f.toolMetadata) === baseline.metadata && !f.calls.some(call => /ACTIVATE|MODE_|ACTION_|SELECT|METADATA/.test(call.type)), "language updates never unregister, activate, select, change mode or overwrite tool metadata");
f.failAfterApply = CREATE; await f.language("en"); await until(() => f.failAfterApply === ""); await settled();
check(label() === EN, "a rejected locale update reply can follow a host-applied English label");
const beforeRevertCreates = count(CREATE); await f.language("zh"); await until(() => label() === ZH, "revert after lost locale reply");
check(count(CREATE) === beforeRevertCreates + 1 && count(REMOVE) === baseline.removes && f.popovers.get(POPOVER) === editor && f.closes === baseline.closes && editor.draft === "unsaved crop and image", "reverting after a lost locale reply refreshes the same native ID and retains the editor draft");
const unchanged = f.calls.length; await f.language("zh"); await settled();
check(f.calls.length === unchanged, "same-language notifications have no SDK work");
await click(); await until(() => f.popovers.size === 0);
check(f.closes === baseline.closes + 1, "same-ID SDK callback replacement still toggles the current editor closed");
f.holdNext = CREATE; await f.language("en"); await held(CREATE);
await f.language("zh"); await f.language("en"); await f.language("zh"); release();
await until(() => label() === ZH && f.held === null); await settled();
check(label() === ZH && count(REMOVE) === baseline.removes, "rapid language events during an in-flight update converge to the latest label");
await click(); await until(() => f.popovers.size === 1);
await f.changeRole("PLAYER"); await until(() => f.popovers.size === 0);
const playerCalls = f.calls.length; await click(); await f.language("en"); await settled();
check(f.calls.length === playerCalls && f.tools.get(TOOL).icons[0].filter.roles.join() === "GM", "revoked GM editor closes and a retained SDK callback cannot reopen it for a player");
await f.changeRole("GM"); await until(() => label() === EN);
check(count(REMOVE) === baseline.removes, "promotion updates the current language without unregistering the existing native ID");
await clean();
const stopped = f.calls.length; await f.language("zh"); await f.changeRole("GM"); await click(); await settled();
check(f.calls.length === stopped, "language, role and retained SDK click events are inert after teardown");

// Initial player and delayed role reads must not resurrect GM-only UI.
f.role = "PLAYER"; f.lang = "en"; await setup();
check(!f.tools.size, "a client enabled as a player has no native registration");
await f.changeRole("GM"); await until(() => label() === EN);
check(f.tools.size === 1, "a later GM promotion registers once in the current language");
await clean();
f.role = "GM"; f.holdNext = ROLE; const staleRole = setup(); await held(ROLE);
await f.changeRole("PLAYER"); release(); await staleRole;
check(!f.tools.size, "a later player event supersedes a slow initial GM role reply");
await clean();
f.role = "GM"; f.lang = "zh"; f.holdNext = ROLE; const latestLang = setup(); await held(ROLE);
await f.language("en"); release(); await latestLang;
check(label() === EN, "language changed during the initial role read is used for first registration");
await clean();
f.holdNext = ROLE; const lateRole = setup(); await held(ROLE); await teardown();
const beforeRoleRelease = count(CREATE); release(); await lateRole;
check(count(CREATE) === beforeRoleRelease && !f.tools.size, "teardown before the initial role reply prevents any late registration");
await clean();

// Old SDK create/remove and new session registration must retain their order.
f.lang = "zh"; f.holdNext = CREATE; const oldStartup = setup(); await held(CREATE);
const cleanup = teardown(), restarted = setup(); await f.language("en"); await settled();
check(f.listenerCount("language") === 1 && f.listenerCount("OBR_PLAYER_EVENT_CHANGE") === 1, "immediate restart replaces subscriptions while the old create is pending");
const restartStart = f.calls.length; release(); await Promise.all([oldStartup, cleanup, restarted]); await settled();
check(label() === EN && f.tools.size === 1 && f.calls.slice(restartStart).filter(call => [CREATE, REMOVE].includes(call.type)).map(call => call.type).join() === `${REMOVE},${CREATE}`, "late old registration is removed before the new same-ID registration and cannot remove the new session");
await click(); await until(() => f.popovers.size === 1);
check(f.popovers.size === 1, "the restarted SDK callback belongs to the new live session");
await clean();

// A stale viewport reply must never dispatch even a short-lived editor open.
await setup(); f.holdNext = WIDTH; const beforeWidthOpen = count(OPEN);
await click(); await held(WIDTH); const widthCleanup = teardown(); release(); await widthCleanup;
check(count(OPEN) === beforeWidthOpen && !f.popovers.size, "late viewport reply after teardown does not dispatch an unauthorized editor open");
await clean();
await setup(); f.holdNext = WIDTH; const beforeRevokedOpen = count(OPEN);
await click(); await held(WIDTH); await f.changeRole("PLAYER"); release(); await settled();
check(count(OPEN) === beforeRevokedOpen && !f.popovers.size, "late viewport reply after GM revocation does not dispatch an editor open");
await clean();
f.role = "GM"; await setup(); f.holdNext = WIDTH; const beforeToggleOpen = count(OPEN);
await click(); await held(WIDTH); await click(); release(); await settled();
check(count(OPEN) === beforeToggleOpen && !f.popovers.size, "a second click cancels a pending open before its viewport reply");
await clean();

// A dispatched SDK open cannot be canceled; old cleanup drains before new open.
await setup(); f.holdNext = OPEN; await click(); await held(OPEN);
const oldOpenCleanup = teardown(), afterOpenRestart = setup(); const delayedStart = f.calls.length;
const createsBeforeDraining = count(CREATE); await settled();
check(count(CREATE) === createsBeforeDraining, "restart does not register over a pending old editor cleanup");
release(); await Promise.all([oldOpenCleanup, afterOpenRestart]); await click(); await until(() => f.popovers.size === 1);
const lifecycle = f.calls.slice(delayedStart).filter(call => [OPEN, CLOSE].includes(call.type)).map(call => call.type);
check(lifecycle.join() === `${CLOSE},${OPEN}` && f.popovers.size === 1, "a late old editor open closes before the restarted session opens the same ID");
await clean();
await setup(); f.holdNext = OPEN; await click(); await held(OPEN); await click(); release(); await until(() => f.held === null); await settled();
check(!f.popovers.size, "double click while open is in flight drains its acknowledgement then closes");
await clean();

// The editor close button delegates to the background, which survives iframe destruction.
await setup(); await click(); await until(() => f.popovers.size === 1);
const firstNonce = nonce(), closeMessageCount = count(CLOSE);
await requestClose(firstNonce, "other-player-connection"); await requestClose(crypto.randomUUID()); await settled();
check(count(CLOSE) === closeMessageCount && f.popovers.size === 1, "other-player and wrong-window close requests cannot close the current editor");
await requestClose(firstNonce); await until(() => f.popovers.size === 0);
await click(); await until(() => f.popovers.size === 1);
const secondEditor = f.popovers.get(POPOVER), secondNonce = nonce();
check(secondNonce !== firstNonce, "page close followed by one native click reopens a fresh window with a new generation");
await requestClose(firstNonce); await settled();
check(f.popovers.get(POPOVER) === secondEditor, "a late close request from the retired iframe cannot close the new window");
f.failNext = CLOSE; await requestClose(secondNonce); await until(() => f.failNext === ""); await settled();
const failureMessage = f.calls.findLast(call => call.type === "OBR_BROADCAST_SEND_MESSAGE" && call.data.channel === RESULT_CHANNEL);
check(f.popovers.get(POPOVER) === secondEditor && failureMessage?.data.options.destination === "LOCAL" && failureMessage.data.data.status === "error" && failureMessage.data.data.windowNonce === secondNonce, "failed page-requested close preserves the editor and reports only a local failure for that window");
await requestClose(secondNonce); await until(() => f.popovers.size === 0);
await click(); await until(() => f.popovers.size === 1);
check(f.popovers.size === 1, "page-requested close can retry and single-click reopening remains synchronized");
await clean();
const afterWindowStop = f.calls.length; await requestClose(secondNonce); await settled();
check(f.calls.length === afterWindowStop, "retired-window close messages are inert after module teardown");

// Failure replies are not proof that the host never applied a request.
await setup(); await click(); await until(() => f.popovers.size === 1);
const failedCloseEditor = f.popovers.get(POPOVER), failedCloseOpens = f.opens;
f.failNext = CLOSE; await click(); await until(() => f.failNext === ""); await settled();
check(f.popovers.get(POPOVER) === failedCloseEditor, "host close rejection keeps the existing editor and draft");
await click(); await until(() => f.popovers.size === 0);
check(f.opens === failedCloseOpens, "the next click retries a rejected close without reopening or resetting the editor");
await clean();
f.failAfterApply = CREATE; await assert.rejects(setup(), /controlled lost reply/); check(f.tools.has(TOOL), "fixture reproduces host registration with a lost SDK reply");
await clean();
await setup(); f.failAfterApply = OPEN; await click(); await until(() => f.failAfterApply === ""); await settled();
check(!f.popovers.size, "a dispatched open with a rejected reply attempts cleanup of possible host-side success");
await click(); await until(() => f.popovers.size === 1);
check(f.popovers.size === 1, "the editor can be opened again after a failed open was cleaned up");
await clean();

// Lifecycle failures stay observable and retain only unfinished cleanup ownership.
await setup(); await click(); await until(() => f.popovers.size === 1);
f.failNext = REMOVE;
await assert.rejects(teardown(), /cleanup failed/);
check(f.tools.has(TOOL) && !f.popovers.size && f.listenerCount("language") === 0, "failed native removal rejects teardown while still closing the window and retiring subscriptions");
const retryRemoveCalls = count(REMOVE); await teardown();
check(count(REMOVE) === retryRemoveCalls + 1 && !f.tools.size, "repeated teardown retries the exact pending native ID");
await clean();
await setup(); await click(); await until(() => f.popovers.size === 1);
f.failNext = CLOSE; await assert.rejects(teardown(), /cleanup failed/);
check(f.popovers.size === 1 && !f.tools.size, "failed popover cleanup rejects teardown and retains window ownership after native removal");
const retryCloseCalls = count(CLOSE), retryCreates = count(CREATE); await setup();
check(count(CLOSE) === retryCloseCalls + 1 && count(CREATE) === retryCreates + 1 && !f.popovers.size, "restart first retries the retained old window close before registering the new tool");
await clean();
const manager = new ModuleLifecycle({ circleImage: { setup, teardown } }, { retryDelays: [] });
f.failNext = "OBR_PLAYER_GET_CONNECTION_ID";
await manager.setDesired({ circleImage: true });
check(manager.snapshot()[0].status === "error" && !f.tools.size && f.listenerCount("language") === 0, "initial connection read failure reaches the actual lifecycle manager and partial setup is cleaned");
await manager.retry("circleImage");
check(manager.snapshot()[0].status === "on" && f.tools.size === 1, "the manager's existing retry restarts a failed initial connection read successfully");
f.failNext = REMOVE; await manager.setDesired({ circleImage: false });
check(manager.snapshot()[0].status === "error" && f.tools.has(TOOL), "the manager reports failed teardown instead of incorrectly marking a retained tool off");
await manager.retry("circleImage");
check(manager.snapshot()[0].status === "off" && !f.tools.size, "manager retry completes pending removal without recreating a disabled module");
f.failNext = ROLE; await manager.setDesired({ circleImage: true });
check(manager.snapshot()[0].status === "error" && !f.tools.size, "initial role-read failure also reports startup failure instead of silent missing UI");
await manager.retry("circleImage"); await manager.setDesired({ circleImage: false });
await clean();

check(!f.calls.some(call => /OBR_TOOL_(MODE|ACTION|ACTIVATE)|OBR_PLAYER_SELECT|OBR_TOOL_SET_METADATA/.test(call.type)), "the complete run never adds modes/actions, activates tools, changes selection or writes tool metadata");
check(hash(source) === sourceHash, "product source remains identical throughout the run");
console.warn = originalWarn;
const mutationResults = [];
if (process.argv.includes("--verify-mutations")) {
  for (const name of Object.keys(mutants)) {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), "--repo", repo, `--mutation=${name}`], { encoding: "utf8", timeout: 25000, windowsHide: true });
    assert.ok(child.status !== 0 && !child.error && /AssertionError/.test(child.stderr), `mutation was not caught: ${name}\n${child.stdout}\n${child.stderr}`);
    mutationResults.push({ name, caught: true, failure: child.stderr.match(/AssertionError[^\n]*: ([^\n]+)/)?.[1] ?? child.stderr.slice(-300) });
  }
}
writeFileSync(join(out, "result.json"), JSON.stringify({ passed: checks.length, checks, mutationResults, warnings, sourceHash, sdkVersion: JSON.parse(readFileSync(resolve(repo, "node_modules/@owlbear-rodeo/sdk/package.json"), "utf8")).version, actualSDK: ["ToolApi", "PopoverApi", "PlayerApi", "ViewportApi", "BroadcastApi"], controlledBoundary: "host message bus and local language store", realOwlbearUat: false }, null, 2));
console.log(`PASS: ${checks.length} circle-image entry checks; ${mutationResults.length} mutations caught. Evidence: ${out}`);
