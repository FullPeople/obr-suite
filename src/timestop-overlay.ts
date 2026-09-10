import OBR from "@owlbear-rodeo/sdk";
import { TIME_STOP_MODAL, TIME_STOP_READY, TIME_STOP_VIEW, TIME_STOP_HIDE, TIME_STOP_HIDDEN, TIME_STOP_RETRY,
  CG_BARS_MS, CG_FADE_MS, validCgUrl } from "./modules/timeStopProtocol";

const params = new URLSearchParams(location.search);
const nonce = params.get("window") ?? "";
const cg = params.get("cg");
const lang = params.get("lang") === "en" ? "en" : "zh";
const reduced = params.get("reduced") === "1" || matchMedia("(prefers-reduced-motion: reduce)").matches;
const bars = [...document.querySelectorAll<HTMLElement>(".cinema")];
const wrap = document.getElementById("cgWrap")!;
const image = document.getElementById("cgImg") as HTMLImageElement;
const notice = document.getElementById("notice")!;
const retry = document.getElementById("retry") as HTMLButtonElement;
const exit = document.getElementById("exit") as HTMLButtonElement;
document.documentElement.lang = lang;
document.body.classList.toggle("reduced", reduced);
let alive = true, closing = false, started = false, generation = 0, connection = "";
let imageReady = false, barsReady = false;
let connecting = false, retryConnection = false;
const timers = new Set<ReturnType<typeof setTimeout>>();
const unsubs: Array<() => void> = [];
function later(fn: () => void, ms: number) {
  const timer = setTimeout(() => { timers.delete(timer); if (alive) fn(); }, ms);
  timers.add(timer);
}
function reveal() {
  if (!alive || closing || !imageReady || !barsReady) return;
  wrap.classList.add("visible");
}
function show(error = false) {
  if (!alive) return;
  closing = false;
  document.body.classList.remove("leaving");
  document.body.classList.remove("connection-error");
  retryConnection = false; exit.hidden = true;
  retry.textContent = lang === "en" ? "Try closing again" : "重试关闭";
  retry.hidden = !error;
  notice.textContent = error ? (lang === "en" ? "The overlay could not close. Try again." : "遮罩未能关闭，请重试。") : "";
  if (started) { bars.forEach(bar => bar.classList.add("show")); reveal(); return; }
  started = true;
  const own = ++generation;
  requestAnimationFrame(() => { if (alive && !closing && own === generation) bars.forEach(bar => bar.classList.add("show")); });
  later(() => { barsReady = true; reveal(); }, reduced ? 100 : CG_BARS_MS);
  if (validCgUrl(cg)) {
    // The URL never changes inside this window. Remember a load during fading
    // out, but reveal() cannot display it until a failed close is explicitly restored.
    const ready = () => { if (alive) { imageReady = true; reveal(); } };
    image.addEventListener("load", ready, { once: true });
    image.addEventListener("error", () => {
      if (!alive || closing || own !== generation) return;
      notice.textContent = lang === "en" ? "This image could not load." : "这张图片暂时无法加载。";
    }, { once: true });
    image.src = cg;
    if (image.complete && image.naturalWidth) ready();
  }
}
function hide() {
  if (!alive || closing) return;
  closing = true; generation++;
  wrap.classList.remove("visible"); bars.forEach(bar => bar.classList.remove("show"));
  document.body.classList.add("leaving");
  retry.hidden = true; notice.textContent = "";
  later(() => {
    void OBR.broadcast.sendMessage(TIME_STOP_HIDDEN, { nonce }, { destination: "LOCAL" }).catch(() => {});
  }, reduced ? 120 : CG_FADE_MS + 40);
}
retry.textContent = lang === "en" ? "Try closing again" : "重试关闭";
retry.addEventListener("click", () => {
  if (retryConnection) { void connect(); return; }
  retry.disabled = true;
  void OBR.broadcast.sendMessage(TIME_STOP_RETRY, { nonce }, { destination: "LOCAL" })
    .catch(() => { if (alive) notice.textContent = lang === "en" ? "The overlay could not close. Try again." : "遮罩未能关闭，请重试。"; })
    .finally(() => { if (alive) retry.disabled = false; });
});
function dispose() {
  alive = false; generation++;
  timers.forEach(clearTimeout); timers.clear(); unsubs.splice(0).forEach(off => off());
  image.removeAttribute("src");
}
window.addEventListener("pagehide", dispose, { once: true });
exit.textContent = lang === "en" ? "Return to map" : "返回地图";
exit.addEventListener("click", () => {
  if (!alive || exit.disabled) return;
  exit.disabled = true;
  void OBR.modal.close(nonce ? TIME_STOP_MODAL + "/" + nonce : TIME_STOP_MODAL).then(dispose).catch(() => {
    if (alive) notice.textContent = lang === "en" ? "Could not close. Please try again." : "暂时未能关闭，请重试。";
  }).finally(() => { if (alive) exit.disabled = false; });
});
async function connect() {
  if (!alive || connecting) return;
  connecting = true; retry.disabled = true;
  unsubs.splice(0).forEach(off => off());
  try {
    const [localConnection, role] = await Promise.all([OBR.player.getConnectionId(), OBR.player.getRole()]);
    if (!alive) return;
    if (!localConnection) throw Error("Missing local connection");
    connection = localConnection;
    wrap.classList.toggle("dm", role === "GM");
    const valid = (event: { connectionId: string; data: unknown }) =>
      alive && event.connectionId === connection && (event.data as { nonce?: unknown })?.nonce === nonce;
    unsubs.push(OBR.broadcast.onMessage(TIME_STOP_VIEW, event => {
      if (valid(event)) show((event.data as { error?: unknown }).error === true);
    }), OBR.broadcast.onMessage(TIME_STOP_HIDE, event => { if (valid(event)) hide(); }));
    // New pages wait for their exact owner's intent. A delayed old iframe
    // cannot flash its image before its background has checked its lifetime.
    if (nonce) await OBR.broadcast.sendMessage(TIME_STOP_READY, { nonce }, { destination: "LOCAL" });
    else show(); // Older cached background URLs remain viewable during an upgrade.
    if (alive) { document.body.classList.remove("connection-error"); exit.hidden = true; retry.hidden = true; }
  } catch {
    if (!alive) return;
    unsubs.splice(0).forEach(off => off());
    // Unknown identity never authorizes image presentation. Offer a visible
    // recovery or an exact-window exit instead of an empty blocking modal.
    closing = true;
    wrap.classList.remove("visible"); bars.forEach(bar => bar.classList.remove("show"));
    retryConnection = true; retry.hidden = false; exit.hidden = false;
    document.body.classList.add("connection-error");
    notice.textContent = lang === "en" ? "The cinematic view could not connect. Try again or return to the map." : "演出画面暂时无法连接，请重试或返回地图。";
    retry.textContent = lang === "en" ? "Retry connection" : "重试连接";
  } finally { connecting = false; if (alive) retry.disabled = false; }
}
OBR.onReady(() => { void connect(); });
