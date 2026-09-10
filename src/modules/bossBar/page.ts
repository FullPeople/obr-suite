import OBR from "@owlbear-rodeo/sdk";
import { getLocalLang } from "../../state";
import { BOSS_READY, BOSS_STATE, BOSS_PRESENTED, MAX_BOSSES, validPublicBoss, type BossState, type PublicBoss, type BossObstacle } from "./model";
import { BOSS_PREFERENCES_CHANGED, BOSS_PREFERENCES_KEY, getBossPreferences } from "./preferences";
import { t } from "./text";
import { bossPlacement } from "./layout";
import "./style.css";

const query = new URLSearchParams(location.search);
document.documentElement.lang = getLocalLang() === "en" ? "en" : "zh-CN";
document.title = t("title");

if (query.get("mode") === "config") {
  void import("./config-page").then(module => module.startBossOptions(query.get("itemId") || ""));
} else {
  const session = query.get("session") || "";
  const root = document.getElementById("bossBars")!;
  document.body.classList.add("display");
  let obstacles: BossObstacle[] = [];
  type Row = { node: HTMLElement; name: HTMLElement; phase: HTMLElement; track: HTMLElement; fill: HTMLElement; trail: HTMLElement; numbers: HTMLElement;
    dividers: HTMLElement; ratio: number; trailing: number; timer?: ReturnType<typeof setTimeout>; signature: string };
  const rows = new Map<string, Row>();
  let version = -1, latest: PublicBoss[] = [], sceneReady = false, alive = true;
  let pendingReplay: string = crypto.randomUUID(), observedRole: string | undefined;
  const unsubs: Array<() => void> = [];

  function clear(): void {
    for (const row of rows.values()) if (row.timer) clearTimeout(row.timer);
    rows.clear(); root.replaceChildren(); present([]);
  }
  let lastPresentation = "";
  function present(ids: string[]): void {
    const message = { session, version, ids };
    const signature = JSON.stringify(message);
    if (signature === lastPresentation || version < 0) return;
    lastPresentation = signature;
    void OBR.broadcast.sendMessage(BOSS_PRESENTED, message, { destination: "LOCAL" })
      .catch(error => console.warn("[boss-bar] presentation acknowledgement failed", error));
  }
  function position(): boolean {
    const placement = bossPlacement(innerWidth, innerHeight, latest.length === 1 ? 60 : latest.length === 2 ? 102 : 144,
      getBossPreferences().bottomInset, obstacles);
    root.style.left = `${placement.left}px`; root.style.top = `${placement.top}px`; root.style.width = `${placement.width}px`;
    root.hidden = !placement.visible;
    return placement.visible;
  }
  function render(): void {
    const preferences = getBossPreferences();
    document.body.classList.toggle("reduceMotion", preferences.reducedMotion);
    if (!sceneReady || !alive) { clear(); return; }
    const ids = new Set(latest.map(boss => boss.id));
    for (const [id, row] of rows) if (!ids.has(id)) { if (row.timer) clearTimeout(row.timer); row.node.remove(); rows.delete(id); }
    for (const boss of latest) {
      let row = rows.get(boss.id);
      if (!row) {
        const node = document.createElement("section"); node.className = "boss"; node.dataset.itemId = boss.id;
        node.innerHTML = '<div class="bossHeader"><h2 class="bossName"></h2><span class="bossPhase"></span></div><div class="track" role="progressbar"><div class="well"><div class="trail"></div><div class="fill"></div><div class="dividers"></div></div><span class="numbers"></span></div>';
        row = { node, name: node.querySelector(".bossName")!, phase: node.querySelector(".bossPhase")!, track: node.querySelector(".track")!,
          fill: node.querySelector(".fill")!, trail: node.querySelector(".trail")!, numbers: node.querySelector(".numbers")!, dividers: node.querySelector(".dividers")!,
          ratio: boss.ratio, trailing: boss.ratio, signature: "" };
        rows.set(boss.id, row); root.append(node);
      }
      const next = JSON.stringify(boss) + preferences.reducedMotion + getLocalLang();
      if (next === row.signature) continue;
      row.signature = next;
      row.name.textContent = boss.name || t("emptyName"); row.name.title = row.name.textContent;
      row.phase.textContent = boss.phase || (boss.ratio === 0 ? t("defeated") : "");
      row.phase.hidden = !row.phase.textContent;
      row.node.classList.toggle("defeated", boss.ratio === 0);
      row.track.setAttribute("aria-label", row.name.textContent);
      row.track.setAttribute("aria-valuemin", "0"); row.track.setAttribute("aria-valuemax", "100");
      row.track.setAttribute("aria-valuenow", String(Math.round(boss.ratio * 100)));
      row.numbers.textContent = boss.numbers ? `${boss.numbers.hp} / ${boss.numbers.max}` : "";
      row.dividers.replaceChildren();
      for (let i = 1; i < boss.segments; i++) { const mark = document.createElement("i"); mark.className = "divider"; mark.style.left = `${i * 100 / boss.segments}%`; row.dividers.append(mark); }
      if (row.timer) clearTimeout(row.timer);
      row.fill.style.width = `${boss.ratio * 100}%`;
      if (!preferences.reducedMotion && boss.ratio < row.ratio) {
        row.trailing = Math.max(row.trailing, row.ratio); row.trail.style.width = `${row.trailing * 100}%`;
        const currentRow = row;
        row.timer = setTimeout(() => { currentRow.trailing = boss.ratio; currentRow.trail.style.width = `${boss.ratio * 100}%`; currentRow.timer = undefined; }, 180);
      } else { row.trailing = boss.ratio; row.trail.style.width = `${boss.ratio * 100}%`; }
      row.ratio = boss.ratio;
    }
    // Preserve existing nodes and animation state while following deterministic order.
    latest.forEach((boss, index) => { const node = rows.get(boss.id)!.node; if (root.children[index] !== node) root.insertBefore(node, root.children[index] || null); });
    present(position() ? latest.map(boss => boss.id) : []);
  }
  function receive(value: unknown): void {
    if (!alive || !sceneReady || !value || typeof value !== "object") return;
    const message = value as BossState;
    const replay = !!pendingReplay && message.replay === pendingReplay;
    if ((pendingReplay && !replay) || message.session !== session || !Number.isSafeInteger(message.version)
      || (replay ? message.version < version : message.version <= version) || !Array.isArray(message.bosses)
      || message.bosses.length > MAX_BOSSES || !message.bosses.every(validPublicBoss) || new Set(message.bosses.map(boss => boss.id)).size !== message.bosses.length) return;
    pendingReplay = ""; version = message.version; latest = message.bosses; obstacles = Array.isArray(message.obstacles) ? message.obstacles : []; render();
  }
  function requestReplay(): void {
    pendingReplay = crypto.randomUUID();
    void OBR.broadcast.sendMessage(BOSS_READY, { session, requestId: pendingReplay }, { destination: "LOCAL" })
      .catch(error => console.warn("[boss-bar] ready request failed", error));
  }
  const onStorage = (event: StorageEvent) => { if (event.key === BOSS_PREFERENCES_KEY || event.key === "obr-suite/lang") render(); };
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  motion.addEventListener("change", render);
  window.addEventListener("storage", onStorage);
  window.addEventListener("resize", render);
  window.addEventListener("pagehide", () => { alive = false; latest = []; clear(); for (const off of unsubs) off(); window.removeEventListener("storage", onStorage); window.removeEventListener("resize", render); motion.removeEventListener("change", render); });
  OBR.onReady(async () => {
    if (!alive) return;
    let sceneObserved = false, roleObserved = false;
    unsubs.push(OBR.broadcast.onMessage(BOSS_STATE, event => receive(event.data)), OBR.broadcast.onMessage(BOSS_PREFERENCES_CHANGED, render),
      OBR.scene.onReadyChange(next => { sceneObserved = true; sceneReady = next; pendingReplay = crypto.randomUUID(); latest = []; clear(); if (next) requestReplay(); }),
      OBR.player.onChange(player => {
        roleObserved = true;
        if (observedRole !== undefined && observedRole !== player.role) { latest = []; clear(); if (sceneReady) requestReplay(); }
        observedRole = player.role;
      }));
    try {
      const [initialReady, initialRole] = await Promise.all([OBR.scene.isReady(), OBR.player.getRole()]);
      if (!alive) return;
      if (!sceneObserved) sceneReady = initialReady;
      if (!roleObserved) observedRole = initialRole;
      if (sceneReady) requestReplay();
    } catch (error) { clear(); console.warn("[boss-bar] display bootstrap failed", error); }
  });
}
