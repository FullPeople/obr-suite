import OBR, { type Item } from "@owlbear-rodeo/sdk";
import { BOSS_KEY, bossConfig, eligibleBoss } from "./model";
import { t } from "./text";

export function startBossOptions(itemId: string): void {
  document.body.classList.add("config");
  const form = document.getElementById("bossOptions") as HTMLFormElement;
  const fields = document.getElementById("optionsFields") as HTMLFieldSetElement;
  const name = document.getElementById("targetName")!;
  const exact = document.getElementById("exact") as HTMLInputElement;
  const phase = document.getElementById("phase") as HTMLInputElement;
  const segments = document.getElementById("segments") as HTMLSelectElement;
  const status = document.getElementById("saveStatus")!;
  const close = document.getElementById("closeOptions") as HTMLButtonElement;
  for (const [id, key] of [["optionsTitle", "configure"], ["exactLabel", "exact"], ["phaseLabel", "phase"], ["segmentsLabel", "segments"], ["save", "save"], ["hpHint", "hpHint"]] as const) document.getElementById(id)!.textContent = t(key);
  segments.options[0].textContent = t("noSegments");
  close.title = t("close"); close.setAttribute("aria-label", t("close"));
  form.hidden = false; name.textContent = t("loading");
  let epoch = 0, request = 0, active = true, ready = false, gm = false, loaded = false, dirty = false, saving = false;
  let roleObserved = false, initialised = false;
  let viewSignature = "";
  const unsubs: Array<() => void> = [];
  const controls = () => { fields.disabled = !active || !ready || !gm || !loaded || saving; };
  function snapshot(item: Item | undefined): void {
    request++;
    const nextSignature = item ? JSON.stringify([item.id, item.name, eligibleBoss(item), bossConfig(item)]) : "missing";
    if (nextSignature === viewSignature) return;
    viewSignature = nextSignature;
    if (!item || !eligibleBoss(item) || !bossConfig(item).enabled) { epoch++; loaded = false; name.textContent = t("missing"); controls(); return; }
    name.textContent = item.name || t("emptyName");
    if (!dirty) { const config = bossConfig(item); exact.checked = config.exact; phase.value = config.phase; segments.value = String(config.segments); }
    loaded = true; controls();
  }
  async function refresh(): Promise<void> {
    const generation = epoch, read = ++request;
    try {
      const items = await OBR.scene.items.getItems([itemId]);
      if (active && ready && generation === epoch && read === request) snapshot(items.find(item => item.id === itemId));
    } catch (error) { if (active && generation === epoch) { loaded = false; name.textContent = t("failed"); controls(); } console.warn("[boss-bar] options read failed", error); }
  }
  form.addEventListener("input", () => { dirty = true; status.textContent = ""; });
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (!active || !ready || !gm || !loaded || saving) return;
    const generation = epoch, patch = { exact: exact.checked, phase: phase.value.trim().slice(0, 48), segments: Number(segments.value) };
    const current = () => active && ready && gm && loaded && generation === epoch;
    saving = true; controls(); status.textContent = "";
    void (async () => {
      try {
        if (await OBR.player.getRole() !== "GM" || !current()) return;
        let applied = false;
        await OBR.scene.items.updateItems([itemId], drafts => {
          if (!current()) return;
          for (const item of drafts) {
            if (item.id !== itemId || !eligibleBoss(item) || !bossConfig(item).enabled) continue;
            item.metadata[BOSS_KEY] = { ...bossConfig(item), ...patch }; applied = true;
          }
        });
        if (!current()) return;
        if (!applied) { loaded = false; name.textContent = t("missing"); return; }
        dirty = false; status.textContent = t("saved"); viewSignature = "";
        await refresh();
      } catch (error) { if (current()) status.textContent = t("failed"); console.warn("[boss-bar] options write failed", { itemId, error }); }
      finally { saving = false; controls(); }
    })();
  });
  close.addEventListener("click", () => { active = false; epoch++; controls(); void OBR.popover.close("com.obr-suite/boss-bar/options").catch(error => console.warn("[boss-bar] options close failed", error)); });
  window.addEventListener("pagehide", () => { active = false; epoch++; for (const off of unsubs) off(); });
  OBR.onReady(async () => {
    unsubs.push(OBR.scene.items.onChange(items => { if (ready && active) snapshot(items.find(item => item.id === itemId)); }),
      OBR.scene.onReadyChange(() => { epoch++; active = false; ready = false; loaded = false; name.textContent = t("missing"); controls(); }),
      OBR.player.onChange(player => {
        roleObserved = true;
        const changed = gm !== (player.role === "GM");
        gm = player.role === "GM";
        if (initialised && changed) { epoch++; loaded = false; active = false; name.textContent = t("gmOnly"); controls(); }
      }));
    try {
      const [isReady, role] = await Promise.all([OBR.scene.isReady(), OBR.player.getRole()]);
      if (!active) return;
      ready = isReady; if (!roleObserved) gm = role === "GM"; initialised = true;
      if (ready && gm && itemId) await refresh(); else { name.textContent = gm ? t("missing") : t("gmOnly"); controls(); }
    } catch (error) { if (active) { name.textContent = t("failed"); loaded = false; controls(); } console.warn("[boss-bar] options bootstrap failed", error); }
  });
}
