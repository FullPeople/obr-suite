import OBR from "@owlbear-rodeo/sdk";
import { TABLE_ACTIVATE } from "./activation";
const button = document.querySelector<HTMLButtonElement>("#open")!;
let alive = true, sending = false;
button.disabled = true;
OBR.onReady(() => {
  if (!alive) return;
  button.disabled = false;
  button.onclick = async () => {
    if (!alive || sending) return;
    sending = true; button.disabled = true; button.title = "";
    try { await OBR.broadcast.sendMessage(TABLE_ACTIVATE, {}, { destination: "LOCAL" }); }
    catch {
      if (alive) button.title = "未能发送，请重试 / Could not send. Please retry.";
    } finally { sending = false; if (alive) button.disabled = false; }
    // Only the background closes the action after attempting openTable. A
    // broadcast ACK is not evidence that the actual window has opened.
  };
});
window.addEventListener("pagehide", () => { alive = false; button.disabled = true; button.onclick = null; }, { once: true });
