import OBR from "@owlbear-rodeo/sdk";
import { BC_TRANSITIONS_DISMISS, DISPLAY_ID, parseTransition } from "./protocol";
import { removeScreenTransitionForOwner } from "./screen-effect";
import "./style.css";

document.body.className = "presentation";
let raw: any = null;
try { raw = JSON.parse(decodeURIComponent(location.hash.slice(1))); } catch {}
const event = parseTransition(raw);
const popoverId = event ? `${DISPLAY_ID}/${event.id}` : DISPLAY_ID;
const lang = raw?.lang === "en" ? "en" : "zh";
let closed = false;
const close = () => {
  if (closed) return;
  closed = true;
  document.getElementById("app")!.replaceChildren();
  if (event) {
    void removeScreenTransitionForOwner(event.id);
    void OBR.broadcast.sendMessage(BC_TRANSITIONS_DISMISS, { id: event.id }, { destination: "LOCAL" }).catch(() => {});
  }
  void OBR.popover.close(popoverId).catch(() => {});
};
if (!event || event.expiresAt <= Date.now()) close();
else {
  const app = document.getElementById("app")!;
  if (event.kind === "text") app.style.height = "210px";
  const banner = document.createElement("article");
  banner.className = `banner ${event.kind} ${raw.reduced ? "reduced" : ""}`;
  const emblem = document.createElement("span");
  emblem.className = "emblem";
  emblem.textContent = event.kind === "short" ? "☕" : event.kind === "long" ? "☾" : "✦";
  const copy = document.createElement("div"); copy.className = "copy";
  const title = document.createElement("h1");
  title.textContent = event.kind === "text" ? event.text : event.kind === "short"
    ? (lang === "zh" ? "短暂歇息" : "A short rest") : (lang === "zh" ? "漫长的休憩" : "A long rest");
  const detail = document.createElement("p");
  detail.textContent = event.kind === "short" ? (lang === "zh" ? "放下行囊，稍作喘息。" : "Set down your pack. Take a breath.")
    : event.kind === "long" ? (lang === "zh" ? "夜色渐深，新的旅途将在黎明开启。" : "Night settles. A new journey awaits at dawn.") : "";
  const button = document.createElement("button");
  button.className = "close"; button.textContent = "×"; button.ariaLabel = lang === "zh" ? "关闭" : "Close";
  button.addEventListener("click", close);
  copy.append(title, detail); banner.append(emblem, copy, button); app.append(banner);
  const timer = setTimeout(close, Math.max(0, event.expiresAt - Date.now()));
  document.addEventListener("keydown", (key) => { if (key.key === "Escape") close(); });
  window.addEventListener("pagehide", () => { clearTimeout(timer); close(); }, { once: true });
  OBR.onReady(() => {
    if (event.expiresAt <= Date.now()) { close(); return; }
    const unsub = OBR.scene.onReadyChange(() => close());
    window.addEventListener("pagehide", unsub, { once: true });
  });
}
