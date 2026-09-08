#!/usr/bin/env node
// Real Chromium DOM tests. No product dependency is added. Supply PLAYWRIGHT_PATH
// if Playwright is outside node's normal resolution; BROWSER_PATH is optional.
// node tools/settings-content-selftest.mjs [--mutations]
import { build } from "rolldown";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright");
const executablePath = process.env.BROWSER_PATH || [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
].find(existsSync);
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });

async function run(mutation) {
  const built = await build({
    input: resolve("tools/settings-content-selftest.entry.ts"),
    platform: "browser",
    plugins: mutation ? [{
      name: "settings-regression-mutant",
      transform(code, id) {
        if (!id.replaceAll("\\", "/").endsWith("/src/utils/settingsContent.ts")) return;
        const changed = mutation.transform(code);
        if (changed === code) throw new Error(`Mutation not applied: ${mutation.name}`);
        return changed;
      },
    }] : [],
    output: { format: "iife", name: "SettingsTest" },
    write: false,
  });
  const page = await browser.newPage();
  try {
    await page.setContent("<!doctype html><html><body></body></html>");
    await page.addStyleTag({ content: readFileSync("settings.html", "utf8").match(/<style>([\s\S]*?)<\/style>/)[1] });
    await page.addScriptTag({ content: built.output.find((part) => part.type === "chunk").code });
    return await page.evaluate(async () => {
      const { SettingsContent, renderSettingsModuleStatus } = globalThis.SettingsTest;
      const results = [];
      const assert = (ok, label) => { if (!ok) throw new Error(label); };
      const escape = (value) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;");
      const test = async (name, fn) => {
        try { await fn(); results.push({ name, pass: true }); }
        catch (error) { results.push({ name, pass: false, error: String(error) }); }
      };
      function fixture() {
        document.body.innerHTML = '<div id="status"></div><div id="body" style="height:150px;overflow:auto"></div>';
        const root = document.querySelector("#body");
        const renderer = new SettingsContent(root);
        let wired = 0;
        let changes = 0;
        const render = ({ values = { a: "Alpha", b: "Beta" }, editable = true, language = "en", scope = "library", footer = "" } = {}) => renderer.render({
          scope, language, editable,
          html: Object.entries(values).map(([id, value]) => `<label data-row="${id}">${id}<input data-settings-draft="${id}" value="${escape(value)}" ${editable ? "" : "disabled"}></label>`).join("")
            + `<details class="help"><summary>${language === "zh" ? "帮助" : "Help"}</summary>Instructions</details><div style="height:800px">${footer}</div>`,
          afterRender: () => {
            wired++;
            for (const input of root.querySelectorAll("input")) input.addEventListener("change", () => changes++);
          },
        });
        const edit = (id, value, start = 2, end = 4) => {
          const field = renderer.field(id);
          field.focus(); field.value = value; field.setSelectionRange(start, end, "backward");
          field.dispatchEvent(new Event("input", { bubbles: true }));
          return field;
        };
        render();
        return { root, renderer, render, edit, wired: () => wired, changes: () => changes };
      }
      await test("unrelated room events retain node, focus, draft and running controls", () => {
        const f = fixture(); const original = f.edit("a", "Unfinished name");
        const progress = document.createElement("button"); progress.disabled = true; progress.textContent = "Fetching…"; f.root.append(progress);
        for (let i = 0; i < 30; i++) f.render();
        assert(f.renderer.field("a") === original, "unrelated event replaced the input node");
        assert(document.activeElement === original && original.value === "Unfinished name", "draft or focus lost");
        assert(progress.isConnected && progress.disabled && f.wired() === 1, "async controls were remounted");
      });
      await test("remote different field updates immediately while caret, draft, scroll and help stay", () => {
        const f = fixture(); f.edit("a", "Draft name"); f.root.querySelector("details").open = true; f.root.scrollTop = 300;
        f.render({ values: { a: "Alpha", b: "Remote Beta" } });
        const field = f.renderer.field("a");
        assert(f.renderer.field("b").value === "Remote Beta", "remote field is stale");
        assert(field.value === "Draft name" && document.activeElement === field, "draft/focus lost");
        assert(field.selectionStart === 2 && field.selectionEnd === 4 && field.selectionDirection === "backward", "selection lost");
        assert(f.root.scrollTop === 300 && f.root.querySelector("details").open, `scroll or disclosure lost: scroll=${f.root.scrollTop}, open=${f.root.querySelector("details").open}`);
        assert(f.changes() === 0, "refresh accidentally submitted a field");
      });
      await test("same-field conflict shows saved remote value safely; acknowledgement clears draft note", () => {
        const f = fixture(); f.edit("a", "My draft");
        f.render({ values: { a: '<img src=x onerror="alert(1)">', b: "Beta" } });
        assert(f.renderer.field("a").value === "My draft", "remote overwrote draft");
        assert(f.root.querySelector("[data-settings-note]").textContent.includes('<img src=x onerror="alert(1)">'), "remote saved value hidden");
        assert(!f.root.querySelector("img"), "saved value interpreted as markup");
        f.render({ values: { a: "My draft", b: "Beta" } });
        assert(!f.root.querySelector("[data-settings-note]"), "saved acknowledgement still marked unsaved");
      });
      await test("library row reorder/removal cannot transfer a draft to another library", () => {
        const f = fixture(); f.edit("a", "Only A's draft");
        f.render({ values: { b: "Beta", a: "Alpha" } });
        assert(f.renderer.field("a").value === "Only A's draft" && f.renderer.field("b").value === "Beta", "draft followed row position");
        f.render({ values: { b: "Beta", c: "New library" } });
        assert(!f.renderer.field("a") && f.renderer.field("c").value === "New library", "deleted row draft reused");
      });
      await test("role revocation immediately disables controls and retains visible draft without writes", () => {
        const f = fixture(); f.edit("a", "My draft");
        f.render({ editable: false, values: { a: "Remote current", b: "Beta" } });
        assert(f.renderer.field("a").disabled && f.renderer.field("b").disabled, "GM controls stayed enabled");
        assert(f.renderer.field("a").value === "My draft" && f.root.textContent.includes("Remote current"), "draft or remote current value lost");
        assert(f.changes() === 0, "permission update submitted a field");
      });
      await test("language refresh preserves draft and translates notices", () => {
        const f = fixture(); f.edit("a", "本地输入"); f.render({ language: "zh" });
        assert(f.renderer.field("a").value === "本地输入" && f.root.textContent.includes("未提交的输入已保留"), "language switch lost draft or localized note");
        assert(f.root.querySelector("summary").textContent === "帮助", "localized controls stale");
      });
      await test("IME update is delayed until final input, but permission revocation is immediate", async () => {
        const f = fixture(); const field = f.edit("a", "输");
        field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
        f.render({ values: { a: "Alpha", b: "Remote during IME" } });
        assert(f.renderer.field("a") === field, "composition input detached");
        field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
        field.value = "输入完成";
        await new Promise((resolve) => setTimeout(resolve, 10));
        assert(f.renderer.field("a").value === "输入完成" && f.renderer.field("b").value === "Remote during IME", "final IME input or deferred remote update lost");
        f.renderer.field("a").dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
        f.render({ editable: false });
        assert(f.renderer.field("a").disabled, "IME postponed permission revocation");
      });
      await test("failed save leaves input and offers retry using latest typed value", () => {
        const f = fixture(); f.edit("a", "Failed draft"); let submitted;
        f.renderer.showSaveError("a", () => { submitted = f.renderer.field("a").value; });
        f.render({ values: { a: "Remote after failed save", b: "Beta" } });
        assert(f.root.textContent.includes("Remote after failed save") && f.root.textContent.includes("Save failed"), "remote refresh lost failure/retry or hid saved value");
        f.edit("a", "Corrected draft");
        f.root.querySelector("[data-settings-note] button").click();
        assert(submitted === "Corrected draft" && f.renderer.field("a").value === submitted, "retry lost latest input");
      });
      await test("new tab never inherits a draft from the previous tab", () => {
        const f = fixture(); f.edit("a", "Library draft"); f.render({ scope: "bubbles" });
        assert(f.renderer.field("a").value === "Alpha", "draft leaked across tab identities");
      });
      await test("module status and player retry leave settings fields untouched", async () => {
        const f = fixture(); const field = f.edit("a", "Still editing"); const slot = document.querySelector("#status"); let retried;
        const snapshot = { id: "dice", status: "starting", desired: true, attempts: 1, elapsedMs: 0, slow: false };
        const retry = async (id) => { retried = id; };
        renderSettingsModuleStatus(slot, { ...snapshot, status: "off", desired: false }, "en", retry);
        assert(slot.textContent === "", "disabled module has startup notice");
        renderSettingsModuleStatus(slot, { ...snapshot, status: "off" }, "en", retry);
        assert(slot.textContent === "Waiting to start", "queued enabled module appears inactive");
        renderSettingsModuleStatus(slot, { ...snapshot, status: "off" }, "zh", retry);
        assert(slot.textContent === "等待启动", "queued status is not localized");
        renderSettingsModuleStatus(slot, snapshot, "en", retry);
        assert(slot.textContent === "Starting…", "startup status missing");
        renderSettingsModuleStatus(slot, { ...snapshot, status: "error", error: "Network unavailable" }, "en", retry);
        assert(f.renderer.field("a") === field && document.activeElement === field, "status rebuilt settings or stole focus");
        assert(!slot.querySelector("button").disabled, "player retry unavailable");
        slot.querySelector("button").click(); await Promise.resolve();
        assert(retried === "dice" && f.changes() === 0, "retry changed settings instead of local module");
        renderSettingsModuleStatus(slot, { ...snapshot, status: "on" }, "en", retry);
        assert(slot.textContent === "" && field.value === "Still editing", "completed status or draft stale");
      });
      await test("draft notices fit below library controls using the actual settings stylesheet", () => {
        const f = fixture(); f.root.style.width = "360px";
        const render = (value) => f.renderer.render({
          scope: "layout", language: "en", editable: true,
          html: `<div class="lib-row"><div class="lib-row-head" data-settings-line><input class="lib-name" data-settings-draft="name" value="${escape(value)}"><button>Preview</button><button>Sources</button></div></div>`,
        });
        render("Original"); const width = f.renderer.field("name").getBoundingClientRect().width;
        f.renderer.field("name").value = "My draft";
        render("A remotely updated library name with a very long address https://example.test/" + "x".repeat(200));
        const note = f.root.querySelector("[data-settings-note]").getBoundingClientRect();
        const row = f.root.querySelector(".lib-row-head").getBoundingClientRect();
        assert(Math.abs(f.renderer.field("name").getBoundingClientRect().width - width) < 1, "notice squeezed input/action widths");
        assert(note.top >= row.bottom && f.root.scrollWidth <= f.root.clientWidth, "notice overflowed narrow settings panel");
      });
      return results;
    });
  } finally { await page.close(); }
}
try {
  const results = await run();
  for (const result of results) console.log(`${result.pass ? "PASS" : "FAIL"} ${result.name}${result.error ? `: ${result.error}` : ""}`);
  if (results.some((result) => !result.pass)) process.exitCode = 1;
  else if (process.argv.includes("--mutations")) {
    const mutations = [
      { name: "unconditional remount", transform: (s) => s.replace("if (sameTab && samePermissions && previous?.language", "if (false && sameTab && samePermissions && previous?.language") },
      { name: "discard local drafts", transform: (s) => s.replace("dirty: field.value !== field.defaultValue", "dirty: false") },
      { name: "hide relevant remote changes", transform: (s) => s.replace(" && previous.html === request.html", "") },
    ];
    for (const mutation of mutations) {
      const failures = (await run(mutation)).filter((result) => !result.pass);
      console.log(`${failures.length ? "KILLED" : "SURVIVED"} ${mutation.name}: ${failures.map((result) => result.name).join("; ")}`);
      if (!failures.length) process.exitCode = 1;
    }
  }
} finally { await browser.close(); }
