import OBR from "@owlbear-rodeo/sdk";
import { BC_TRANSITIONS_DISMISS, DISPLAY_ID, parseTransition, prefersReducedMotion } from "./protocol";
import { mountRestPresentation } from "./presentation";
import "./style.css";

document.documentElement.classList.add("presentation-root");
document.body.className = "presentation";
let raw: any = null;
try { raw = JSON.parse(decodeURIComponent(location.hash.slice(1))); } catch {}
const event = parseTransition(raw);
const modalId = event ? `${DISPLAY_ID}/${event.id}` : DISPLAY_ID;
const lang = raw?.lang === "en" ? "en" : "zh";
document.documentElement.lang = lang;
let closed = false;
let closing = false;
let alive = true;
let offScene = () => {};
let presentation: ReturnType<typeof mountRestPresentation> | undefined;
const close = async () => {
  if (closed || closing || !alive) return;
  closing = true;
  offScene(); presentation?.dispose();
  try {
    await OBR.modal.close(modalId);
    closed = true;
    if (event) void OBR.broadcast.sendMessage(BC_TRANSITIONS_DISMISS, { id: event.id }, { destination: "LOCAL" }).catch(() => {});
  } catch {
    if (!alive) return;
    const app = document.getElementById("app")!;
    app.replaceChildren();
    const retry = document.createElement("button"); retry.className = "rest-retry";
    retry.textContent = lang === "en" ? "Could not close — return to map" : "未能关闭，重试返回地图";
    retry.onclick = () => { void close(); }; app.append(retry);
  } finally { closing = false; }
};
window.addEventListener("pagehide", () => { alive = false; offScene(); presentation?.dispose(); }, { once: true });
if (!event || event.expiresAt <= Date.now()) close();
else {
  presentation = mountRestPresentation(document.getElementById("app")!, event, lang,
    raw?.reduced === true || prefersReducedMotion(), close);
  OBR.onReady(() => {
    if (closed || event.expiresAt <= Date.now()) { close(); return; }
    offScene = OBR.scene.onReadyChange(() => close());
  });
}
