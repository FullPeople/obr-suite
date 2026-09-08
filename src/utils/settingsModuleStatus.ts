import type { ModuleLifecycleSnapshot } from "./moduleLifecycleProtocol";

/** Module progress belongs to its own small slot, never the settings body. */
export function renderSettingsModuleStatus(
  slot: HTMLElement,
  snapshot: ModuleLifecycleSnapshot | undefined,
  language: "zh" | "en",
  retry: (id: string) => Promise<void>,
): void {
  const signature = JSON.stringify([snapshot?.id, snapshot?.status, snapshot?.desired, snapshot?.slow, snapshot?.error, language]);
  if (slot.dataset.statusSignature === signature) return;
  slot.dataset.statusSignature = signature;
  slot.replaceChildren();
  if (!snapshot || (snapshot.status === "off" && !snapshot.desired) || snapshot.status === "on") return;
  const zh = language === "zh";
  const label = document.createElement("span");
  label.textContent = snapshot.status === "off"
    ? (zh ? "等待启动" : "Waiting to start")
    : snapshot.status === "starting"
    ? (zh ? (snapshot.slow ? "仍在启动…" : "启动中…") : (snapshot.slow ? "Still starting…" : "Starting…"))
    : snapshot.status === "stopping"
      ? (zh ? "停止中…" : "Stopping…")
      : (zh ? "此设备运行异常" : "Error on this device");
  if (snapshot.error) label.title = snapshot.error;
  slot.append(label);
  if (snapshot.status !== "error") return;
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = zh ? "重试" : "Retry";
  button.title = zh ? "仅重试此设备，不修改房间开关" : "Retry on this device without changing the room setting";
  button.style.marginInlineStart = "6px";
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      await retry(snapshot.id);
    } catch {
      label.textContent = zh ? "重试请求未送达，请再试一次" : "Retry request failed. Please try again.";
    } finally {
      button.disabled = false;
    }
  });
  slot.append(button);
}
