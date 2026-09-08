import OBR from "@owlbear-rodeo/sdk";
import { getLocalLang, onLangChange } from "../../state";
import { BC_TRANSITIONS_RUN, BC_TRANSITIONS_STATUS, CONTROL_ID, REDUCED_MOTION_KEY, type TransitionKind } from "./protocol";
import "./style.css";

let lang = getLocalLang();
let role: "GM" | "PLAYER" = "PLAYER";
let kind: TransitionKind = "short";
let connection = "";
let requestId = "";
let responseTimer: ReturnType<typeof setTimeout> | undefined;
const text = (zh: string, en: string) => lang === "zh" ? zh : en;
const app = document.getElementById("app")!;
app.innerHTML = `<main class="control"><header class="head"><h1 id="heading"></h1><button class="close" id="close">×</button></header>
  <div class="choices"><button class="choice" data-kind="short" aria-pressed="true"><span class="symbol">☕</span><span id="short-label"></span></button>
  <button class="choice" data-kind="long" aria-pressed="false"><span class="symbol">☾</span><span id="long-label"></span></button>
  <button class="choice" data-kind="text" aria-pressed="false"><span class="symbol">✦</span><span id="text-label"></span></button></div>
  <label class="field hidden" id="custom-field"><span id="custom-label"></span><input id="custom" maxlength="120"></label>
  <label class="field hidden" id="audience-field"><span id="audience-label"></span><select id="audience"></select></label>
  <div class="actions"><button id="preview"></button><button id="play" class="primary hidden"></button></div>
  <label class="preference"><input id="reduced" type="checkbox"><span id="reduced-label"></span></label>
  <p class="hint" id="hint"></p><div class="status" id="status" role="status"></div></main>`;
const el = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
function translate() {
  document.documentElement.lang = lang;
  el("heading").textContent = text("转场", "Transitions");
  el("close").ariaLabel = text("关闭", "Close");
  el("short-label").textContent = text("短休", "Short rest");
  el("long-label").textContent = text("长休", "Long rest");
  el("text-label").textContent = text("文字", "Custom");
  el("custom-label").textContent = text("演出文字", "Title");
  el<HTMLInputElement>("custom").placeholder = text("例如：翌日清晨…", "For example: The next morning…");
  el("audience-label").textContent = text("展示给", "Show to");
  el("preview").textContent = text("自己预览", "Preview for me");
  el("play").textContent = text("播放转场", "Play transition");
  el("reduced-label").textContent = text("减少动态（仅自己）", "Reduce motion for me");
  el("hint").textContent = text("仅播放演出，不会更改生命值、法术位或休息资源。", "Presentation only. HP, spell slots and rest resources stay unchanged.");
}
async function updateAudience() {
  const [nextRole, players] = await Promise.all([OBR.player.getRole(), OBR.party.getPlayers()]);
  role = nextRole;
  const select = el<HTMLSelectElement>("audience");
  const selected = select.value;
  select.replaceChildren(new Option(text("所有人", "Everyone"), "all"));
  for (const player of players) select.add(new Option(player.name || player.id, player.id));
  if ([...select.options].some((option) => option.value === selected)) select.value = selected;
  el("audience-field").classList.toggle("hidden", role !== "GM");
  el("play").classList.toggle("hidden", role !== "GM");
}
function busy(value: boolean) {
  el<HTMLButtonElement>("preview").disabled = value;
  el<HTMLButtonElement>("play").disabled = value;
}
async function run(preview: boolean) {
  const custom = el<HTMLInputElement>("custom").value.trim();
  if (kind === "text" && !custom) { el<HTMLInputElement>("custom").focus(); return; }
  requestId = crypto.randomUUID();
  busy(true);
  el("status").textContent = text("正在准备…", "Preparing…");
  if (responseTimer) clearTimeout(responseTimer);
  responseTimer = setTimeout(() => {
    busy(false);
    el("status").textContent = text("未收到回应，请稍后重试。", "No response. Please try again.");
  }, 6_000);
  const audience = el<HTMLSelectElement>("audience").value;
  try {
    await OBR.broadcast.sendMessage(BC_TRANSITIONS_RUN, { kind, text: custom,
      targets: audience === "all" ? "all" : [audience], preview, requestId, issuedAt: Date.now() }, { destination: "LOCAL" });
  } catch {
    if (responseTimer) clearTimeout(responseTimer);
    busy(false);
    el("status").textContent = text("未能播放，请重试。", "Unable to play. Please retry.");
  }
}
translate();
try { el<HTMLInputElement>("reduced").checked = localStorage.getItem(REDUCED_MOTION_KEY) === "1"; } catch {}
el("reduced").addEventListener("change", () => {
  try { localStorage.setItem(REDUCED_MOTION_KEY, el<HTMLInputElement>("reduced").checked ? "1" : "0"); } catch {}
});
app.querySelectorAll<HTMLButtonElement>("[data-kind]").forEach((button) => button.addEventListener("click", () => {
  kind = button.dataset.kind as TransitionKind;
  app.querySelectorAll<HTMLButtonElement>("[data-kind]").forEach((choice) => choice.setAttribute("aria-pressed", String(choice === button)));
  el("custom-field").classList.toggle("hidden", kind !== "text");
  if (kind === "text") el<HTMLInputElement>("custom").focus();
}));
el("preview").addEventListener("click", () => { void run(true); });
el("play").addEventListener("click", () => { void run(false); });
el("close").addEventListener("click", () => { void OBR.popover.close(CONTROL_ID); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") void OBR.popover.close(CONTROL_ID); });
OBR.onReady(async () => {
  connection = await OBR.player.getConnectionId();
  await updateAudience();
  const resize = new ResizeObserver(() => {
    void OBR.popover.setHeight(CONTROL_ID, Math.ceil(app.scrollHeight)).catch(() => {});
  });
  resize.observe(app);
  const unsubParty = OBR.party.onChange(() => { void updateAudience(); });
  const unsubPlayer = OBR.player.onChange(() => { void updateAudience(); });
  const unsubLang = onLangChange((value) => { lang = value; translate(); void updateAudience(); });
  const unsubStatus = OBR.broadcast.onMessage(BC_TRANSITIONS_STATUS, (event) => {
    const data = event.data as { requestId?: string; ok?: boolean; preview?: boolean; reason?: string };
    if (event.connectionId !== connection || data?.requestId !== requestId) return;
    if (responseTimer) clearTimeout(responseTimer);
    busy(false);
    el("status").textContent = data.ok ? text(data.preview ? "已开始预览。" : "已发送。", data.preview ? "Preview started." : "Sent.")
      : data.reason === "role" ? text("角色权限已变化，请使用自己预览。", "Your role changed. Use Preview for me.")
      : text("请确认场景已打开后重试。", "Open a scene and try again.");
  });
  window.addEventListener("pagehide", () => {
    if (responseTimer) clearTimeout(responseTimer);
    unsubParty(); unsubPlayer(); unsubLang(); unsubStatus();
    resize.disconnect();
  }, { once: true });
});
