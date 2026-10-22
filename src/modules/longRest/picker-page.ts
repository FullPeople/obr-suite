// Long Rest picker — GM-only popover.
//
// Opened by the transitions control page when the GM chooses the
// "long rest" cutscene (kind: "long", not a preview). Lists every
// scene unit that has something to recover (see recover.ts) with
// checkboxes; the GM unchecks whoever did not rest with the party.
//
// On confirm the picker sends the SAME `BC_TRANSITIONS_RUN` message
// the control page would have sent, plus a `longRest.excluded` list.
// The transitions module (background) re-validates the GM role,
// applies the restores, then broadcasts the cutscene — so the picker
// itself never writes scene data.
//
// The picker owns its own requestId / issuedAt: the GM may take a
// while to choose, and the transitions protocol rejects stale
// `issuedAt` values (they are bounded by TRANSITION_TTL_MS).

import OBR from "@owlbear-rodeo/sdk";
import {
  BC_TRANSITIONS_RUN,
  BC_TRANSITIONS_STATUS,
  CONTROL_ID,
  PICKER_ID,
} from "../transitions/protocol";
import { collectCandidates, type RestoreCandidate } from "./recover";
import { getLocalLang, onLangChange } from "../../state";
import { t } from "../../i18n";
import "./picker.css";

let lang = getLocalLang();
const T = (key: Parameters<typeof t>[1]) => t(lang, key);
const app = document.getElementById("app")!;

interface HashPayload {
  /** Cutscene title text (may be empty for the stock long-rest art). */
  text?: string;
  /** Audience for the cutscene: "all" or specific player ids. */
  targets?: "all" | string[];
}

let candidates: RestoreCandidate[] = [];
const checked = new Set<string>();
let connection = "";
let requestId = "";
let busy = false;

const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function escHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

/** One line per planned change, e.g. "生命值 23 / 45 → 45". */
function planLines(candidate: RestoreCandidate): string {
  const lines: string[] = [];
  if (candidate.plan.hp) {
    lines.push(`${T("lrHp")} ${candidate.plan.hp.from} / ${candidate.plan.hp.to} → ${candidate.plan.hp.to}`);
  }
  for (const resource of candidate.plan.resources) {
    lines.push(`☾ ${escHtml(resource.name)} ${resource.from} / ${resource.to} → ${resource.to}`);
  }
  return lines.join("<br/>");
}

function badges(candidate: RestoreCandidate): string {
  const tags: string[] = [];
  if (candidate.card) tags.push(T("lrBadgeCard"));
  if (candidate.bestiary) tags.push(T("lrBadgeBestiary"));
  if (!candidate.card && !candidate.bestiary) tags.push(T("lrBadgeBare"));
  return tags.map((tag) => `<span class="tag">${escHtml(tag)}</span>`).join("");
}

function render(): void {
  const total = candidates.length;
  const picked = candidates.filter((candidate) => checked.has(candidate.item.id)).length;
  if (total === 0) {
    app.innerHTML = `<main class="pick">
      <header class="head"><h1>${escHtml(T("lrTitle"))}</h1>
        <button class="close" id="close" type="button" aria-label="${escHtml(T("lrCancel"))}">×</button></header>
      <p class="hint">${escHtml(T("lrEmpty"))}</p>
      <div class="actions">
        <button class="btn" id="cancel" type="button">${escHtml(T("lrCancel"))}</button>
        <button class="btn primary" id="play-only" type="button">${escHtml(T("lrPlayOnly"))}</button>
      </div>
    </main>`;
    el("close").addEventListener("click", () => { void closeSelf(); });
    el("cancel").addEventListener("click", () => { void closeSelf(); });
    el("play-only").addEventListener("click", () => { void run(false); });
    return;
  }
  app.innerHTML = `<main class="pick">
    <header class="head"><h1>${escHtml(T("lrTitle"))}</h1>
      <button class="close" id="close" type="button" aria-label="${escHtml(T("lrCancel"))}">×</button></header>
    <p class="hint">${escHtml(T("lrHint"))}</p>
    <div class="tools">
      <span class="count" id="count">${escHtml(T("lrSelected").replace("{n}", String(picked)).replace("{m}", String(total)))}</span>
      <span class="spacer"></span>
      <button class="btn slim" id="all" type="button">${escHtml(T("lrSelectAll"))}</button>
      <button class="btn slim" id="none" type="button">${escHtml(T("lrSelectNone"))}</button>
    </div>
    <div class="list" id="list">
      ${candidates.map((candidate) => `
        <label class="row ${checked.has(candidate.item.id) ? "on" : ""}">
          <input type="checkbox" data-id="${escHtml(candidate.item.id)}"
                 ${checked.has(candidate.item.id) ? "checked" : ""}/>
          <span class="body">
            <span class="name">${escHtml(candidate.name)}</span>
            <span class="tags">${badges(candidate)}</span>
            <span class="plan">${planLines(candidate)}</span>
          </span>
        </label>`).join("")}
    </div>
    <div class="actions">
      <button class="btn" id="cancel" type="button">${escHtml(T("lrCancel"))}</button>
      <button class="btn primary" id="confirm" type="button">${escHtml(T("lrConfirm"))}</button>
    </div>
    <p class="status" id="status" role="status"></p>
  </main>`;
  el("close").addEventListener("click", () => { void closeSelf(); });
  el("cancel").addEventListener("click", () => { void closeSelf(); });
  el("all").addEventListener("click", () => {
    for (const candidate of candidates) checked.add(candidate.item.id);
    render();
  });
  el("none").addEventListener("click", () => {
    checked.clear();
    render();
  });
  el("confirm").addEventListener("click", () => { void run(true); });
  app.querySelectorAll<HTMLInputElement>(".list input[type=checkbox]").forEach((box) => {
    box.addEventListener("change", () => {
      const id = box.dataset.id ?? "";
      if (box.checked) checked.add(id); else checked.delete(id);
      box.closest("label")?.classList.toggle("on", box.checked);
      const totalNow = candidates.length;
      const pickedNow = candidates.filter((candidate) => checked.has(candidate.item.id)).length;
      el("count").textContent = T("lrSelected").replace("{n}", String(pickedNow)).replace("{m}", String(totalNow));
    });
  });
}

function setBusy(value: boolean): void {
  busy = value;
  const confirmBtn = el<HTMLButtonElement>("confirm");
  if (confirmBtn) confirmBtn.disabled = value;
  const playOnly = el<HTMLButtonElement>("play-only");
  if (playOnly) playOnly.disabled = value;
}

/** Send the run request; `restore` decides whether the long-rest recovery rides along. */
async function run(restore: boolean): Promise<void> {
  if (busy) return;
  setBusy(true);
  const status = el("status");
  if (status) status.textContent = T("lrSending");
  const payload = parsePayload();
  requestId = crypto.randomUUID();
  const excluded = restore
    ? candidates.filter((candidate) => !checked.has(candidate.item.id)).map((candidate) => candidate.item.id)
    : [];
  try {
    await OBR.broadcast.sendMessage(BC_TRANSITIONS_RUN, {
      kind: "long",
      text: payload.text ?? "",
      targets: payload.targets ?? "all",
      preview: false,
      requestId,
      issuedAt: Date.now(),
      ...(restore ? { longRest: { excluded } } : {}),
    }, { destination: "LOCAL" });
  } catch {
    setBusy(false);
    if (status) status.textContent = T("lrFailed");
  }
}

function parsePayload(): HashPayload {
  try {
    const raw = location.hash.replace(/^#/, "");
    if (!raw) return {};
    const parsed = JSON.parse(decodeURIComponent(raw)) as HashPayload;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Cancel: close only ourselves — the control page stays open behind. */
async function closeSelf(): Promise<void> {
  try { await OBR.popover.close(PICKER_ID); } catch {}
}

/** After a confirmed run both popovers go, landing the GM on the canvas. */
async function closeAll(): Promise<void> {
  try { await OBR.popover.close(PICKER_ID); } catch {}
  try { await OBR.popover.close(CONTROL_ID); } catch {}
}

async function refresh(): Promise<void> {
  const items = await OBR.scene.items.getItems().catch(() => []);
  candidates = collectCandidates(items);
  for (const candidate of candidates) checked.add(candidate.item.id);
  render();
  const resize = new ResizeObserver(() => {
    void OBR.popover.setHeight(PICKER_ID, Math.min(560, Math.ceil(app.scrollHeight))).catch(() => {});
  });
  resize.observe(app);
}

OBR.onReady(async () => {
  connection = await OBR.player.getConnectionId();
  const role = await OBR.player.getRole();
  if (role !== "GM") {
    app.innerHTML = `<main class="pick"><header class="head"><h1>${escHtml(T("lrTitle"))}</h1></header>
      <p class="hint">${escHtml(T("lrGmOnly"))}</p></main>`;
    setTimeout(() => { void OBR.popover.close(PICKER_ID); }, 1_500);
    return;
  }
  await refresh();
  OBR.broadcast.onMessage(BC_TRANSITIONS_STATUS, (message) => {
    const data = message.data as { requestId?: string; ok?: boolean; preview?: boolean; reason?: string };
    if (message.connectionId !== connection || data?.requestId !== requestId) return;
    if (data.ok) {
      void closeAll();
      return;
    }
    setBusy(false);
    const status = el("status");
    if (status) status.textContent = T("lrFailed");
  });
});

const langUnsub = onLangChange((next) => { lang = next; render(); });
window.addEventListener("pagehide", () => { langUnsub(); });
