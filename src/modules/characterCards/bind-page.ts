import OBR from "@owlbear-rodeo/sdk";
import {characterDirectory,DELETED_CARDS} from './directory';
import {cloudEntries,readCardDocument,requestHostCatalog} from './card-source';
import { ICONS } from "../../icons";
import { applyI18nDom, t } from "../../i18n";
import { getLocalLang } from "../../state";
import { isDegenerateResourceId, stableResourceId } from "../resourceTracker/id";
import { restoreResourceIdBackup } from "../resourceTracker/storage";

const lang = getLocalLang();
const tt = (k: Parameters<typeof t>[1]) => t(lang, k);

const MODAL_ID = "com.obr-suite/cc-bind-picker";
const BIND_META = "com.character-cards/boundCardId";
const SCENE_META_KEY = "com.character-cards/list";
// Initiative module's per-token DEX-modifier metadata key. Mirrored
// here so binding a card automatically populates the value the
// initiative tracker uses for its tiebreaker / final-value math.
// (Source of truth lives in `modules/initiative/utils/metadata.ts`.)
const INIT_DEXMOD_META = "com.initiative-tracker/dexMod";

interface CardEntry {
  id: string;
  name: string;
  uploader: string;
  uploaded_at: string;
  url: string;
  cloud: boolean;
}

const params = new URLSearchParams(location.search);
const itemId = params.get("itemId");

const listEl = document.getElementById("list") as HTMLDivElement;
const curEl = document.getElementById("cur") as HTMLDivElement;
const unbindBtn = document.getElementById("unbind") as HTMLButtonElement;
const tokenNameEl = document.getElementById("tokenName") as HTMLDivElement;
const searchEl = document.getElementById("search") as HTMLInputElement;
const countEl = document.getElementById("count") as HTMLSpanElement;

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString();
}
function emptyState(text: string, hint?: string): string {
  return `<div class="empty-state">${ICONS.idCard}<div>${text}</div>${hint ? `<div class="hint-text">${hint}</div>` : ""}</div>`;
}
function cardRow(c: CardEntry, boundId: string | null): HTMLElement {
  const el = document.createElement("div");
  el.className = "list-row is-clickable" + (c.id === boundId ? " is-current" : "");
  el.setAttribute("role", "button");
  el.tabIndex = 0;
  el.dataset.name = c.name.toLowerCase();
  const meta: string[] = [];
  if (c.uploader) meta.push(escapeHtml(c.uploader));
  if (c.uploaded_at && fmtDate(c.uploaded_at)) meta.push(escapeHtml(tt("ccBindUploaded").replace("{date}", fmtDate(c.uploaded_at))));
  if (!meta.length) meta.push(escapeHtml(tt("ccBindRowHint")));
  el.innerHTML =
    `<span class="row-icon${c.cloud ? " cloud" : ""}">${c.cloud ? ICONS.upload : ICONS.book}</span>` +
    `<span class="row-text"><span class="row-title">${escapeHtml(c.name)}</span><span class="row-sub">${meta.join('<span class="dot">·</span>')}</span></span>` +
    `<span class="row-actions">${c.cloud ? `<span class="chip chip-warn">${ICONS.upload}${escapeHtml(tt("ccBindCloud"))}</span>` : ""}${c.id === boundId ? `<span class="chip chip-accent">${ICONS.check}${escapeHtml(tt("ccBindCurrent"))}</span>` : ""}</span>`;
  return el;
}

function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}

async function getCards(): Promise<CardEntry[]> {
  try {
    const [scene,room,host] = await Promise.all([OBR.scene.getMetadata(),OBR.room.getMetadata(),requestHostCatalog()]);
    const deleted=new Set(Array.isArray(room[DELETED_CARDS])?room[DELETED_CARDS] as unknown[]:[]),entries=new Map<string,CardEntry>();
    for(const entry of characterDirectory(scene,room))entries.set(entry.id,{id:entry.id,name:entry.name||entry.id,uploader:entry.uploader||'',uploaded_at:entry.uploaded_at||'',url:entry.url||'',cloud:false});
    // Cloud cards loaded into the room are registry rows, not directory entries.
    for(const entry of cloudEntries(room))if(!deleted.has(entry.id))entries.set(entry.id,{...entries.get(entry.id),id:entry.id,name:entry.name||entry.id,uploader:'',uploaded_at:'',url:'',cloud:true});
    // The workbench host reads the documents; its names win over the upload-time
    // names kept in metadata, which go stale once a card is renamed on its sheet.
    for(const card of host||[]){const known=entries.get(card.id);entries.set(card.id,{id:card.id,uploader:known?.uploader||'',uploaded_at:known?.uploaded_at||'',url:known?.url||'',cloud:card.cloud||!!known?.cloud,name:card.name});}
    return [...entries.values()];
  } catch {
    return [];
  }
}

async function getCurrentBinding(): Promise<string | null> {
  if (!itemId) return null;
  try {
    const items = await OBR.scene.items.getItems([itemId]);
    const m = items[0]?.metadata?.[BIND_META];
    return typeof m === "string" ? m : null;
  } catch {
    return null;
  }
}

// Prefill from the bound card's document: initiative bonus for the tracker,
// HP/AC for the bubbles bar and the parser's auto-resource bundle (one entry
// per non-zero spell-slot level, sorcery points, special-resource tracker; the
// same shape as an OBR Resource on the token). Best-effort: binding succeeds
// even when the document cannot be read.
interface BubblesSeed {
  health?: number;
  maxHealth?: number;
  ac?: number;
}
interface AutoResource {
  id?: string;
  name: string;
  type?: "count" | "bar" | "number";
  current?: number;
  max: number;
  icon?: string;
}
function initiativeFrom(d: any): number | null {
  const init = d?.core_stats?.initiative;
  const n = typeof init === "number" ? init : Number(init);
  return Number.isFinite(n) ? Math.round(n) : null;
}
function bubblesFrom(d: any): BubblesSeed {
  const cs = d?.core_stats || {};
  const hp = cs.hp || {};
  const seed: BubblesSeed = {};
  if (typeof hp.current === "number") seed.health = hp.current;
  if (typeof hp.max === "number") seed.maxHealth = hp.max;
  if (typeof cs.ac === "number") seed.ac = cs.ac;
  return seed;
}
function autoResourcesFrom(d: any): AutoResource[] | null {
  const arr = d?.auto_resources;
  if (!Array.isArray(arr)) return null;
  return arr.filter((r: any): r is AutoResource =>
    r && typeof r === "object" && typeof r.name === "string"
    && typeof r.max === "number"
  );
}
async function fetchCardSeed(cardId: string): Promise<{initBonus: number | null; bubblesSeed: BubblesSeed | null; autoResources: AutoResource[] | null}> {
  try {
    const roomId = (OBR.room?.id || "default").replace(/[^a-zA-Z0-9_-]/g, "_");
    const d = await readCardDocument(roomId, cardId);
    return { initBonus: initiativeFrom(d), bubblesSeed: bubblesFrom(d), autoResources: autoResourcesFrom(d) };
  } catch {
    return { initBonus: null, bubblesSeed: null, autoResources: null };
  }
}

const RESOURCES_KEY = "com.obr-suite/resources/data";
// One-time snapshot of a token's resource array taken before the id
// repair rewrites degenerate/duplicate ids — the rollback (撤销 ID 修复)
// restores from it. Written only when absent so re-binds never clobber
// the true pre-repair original.
const RESOURCES_BACKUP_KEY = "com.obr-suite/resources/backup-pre-idfix";

const BUBBLES_META = "com.obr-suite/bubbles/data";
const EXTERNAL_BUBBLES_META = "com.owlbear-rodeo-bubbles-extension/metadata";

/** Old data.json files (JSON-upload path stores auto_resources verbatim,
 *  never re-parsed) can carry degenerate "auto-" ids forever — repair the
 *  fetched list before it touches any token. Deterministic: the same
 *  card list always sanitizes to the same ids. */
function sanitizeAutoResources(arr: AutoResource[]): AutoResource[] {
  const seen = new Set<string>();
  return arr.map((ar) => {
    if (!isDegenerateResourceId(ar.id) && !seen.has(ar.id!)) {
      seen.add(ar.id!);
      return ar;
    }
    return { ...ar, id: stableResourceId(ar.name, seen) };
  });
}

async function bindTo(cardId: string | null) {
  if (!itemId) return;
  if(await OBR.player.getRole()!=='GM'||!await OBR.scene.isReady())return;
  if(cardId&&!(await getCards()).some(card=>card.id===cardId))return;
  // Resolve the new dex-mod + bubbles seed up front (before the bind
  // write) so we can include them in the same `updateItems` call —
  // single round-trip, and the initiative tracker / bubbles bar see
  // both fields land atomically.
  let initBonus: number | null = null;
  let bubblesSeed: BubblesSeed | null = null;
  let autoResources: AutoResource[] | null = null;
  if (cardId) {
    ({ initBonus, bubblesSeed, autoResources } = await fetchCardSeed(cardId));
    if (autoResources) autoResources = sanitizeAutoResources(autoResources);
  }
  // Filled inside the updateItems mutator (sync), logged after it
  // resolves — evidence per project discipline.
  const repairLog: Array<{ name: string; oldId: string; newId: string }> = [];
  try {
    if(await OBR.player.getRole()!=='GM'||!await OBR.scene.isReady())return;
    if(cardId&&!(await getCards()).some(card=>card.id===cardId))return;
    await OBR.scene.items.updateItems([itemId], (drafts) => {
      const d = drafts[0];
      if (!d) return;
      if (cardId) {
        d.metadata[BIND_META] = cardId;
        // Auto-prefill the initiative bonus from the card data. We
        // only WRITE the value (don't add the token to initiative)
        // — the user adds tokens to initiative explicitly via the
        // right-click menu. Only writes when we successfully read
        // the bonus; otherwise leaves any existing value alone.
        if (initBonus != null) d.metadata[INIT_DEXMOD_META] = initBonus;
        // Seed bubbles HP/AC from the card data. Character cards
        // take priority over bestiary spawn data — if the user
        // cc-binds a token that was previously a bestiary monster,
        // we OVERWRITE the monster's HP/AC with the card's values
        // so the bar reflects the player character, not the
        // monster. Per user spec: "if both bindings exist, char
        // card data wins". Hide flag is cleared too (player chars
        // are visible to everyone by default; the new lock toggle
        // controls combat-gated visibility instead).
        if (bubblesSeed) {
          const existing = (d.metadata[BUBBLES_META] as Record<string, unknown>)
            ?? (d.metadata[EXTERNAL_BUBBLES_META] as Record<string, unknown>)
            ?? {};
          const seed: Record<string, unknown> = { ...existing };
          if (typeof bubblesSeed.health === "number") seed.health = bubblesSeed.health;
          if (typeof bubblesSeed.maxHealth === "number") seed["max health"] = bubblesSeed.maxHealth;
          if (typeof bubblesSeed.ac === "number") seed["armor class"] = bubblesSeed.ac;
          if (!("temporary health" in seed)) seed["temporary health"] = 0;
          // Clear legacy GM-only flag from a prior bestiary bind so
          // the new lock toggle (default true) is the active gate.
          delete seed.hide;
          d.metadata[BUBBLES_META] = seed;
          if (d.metadata[EXTERNAL_BUBBLES_META] != null) d.metadata[EXTERNAL_BUBBLES_META] = seed;
        }
        // 2026-08-20 (checklist §2) — repair legacy degenerate/duplicate
        // resource ids on the token BEFORE merging. Runs on the RAW
        // array (readResources hides empty-id entries but they still
        // occupy metadata). Original array is backed up once as audit
        // evidence; each repaired entry keeps its old id in `legacyId`,
        // which is what the 撤销 ID 修复 rollback inverts. Doing the
        // repair+merge in ONE updateItems keeps them consistent with
        // each other, but note OBR updateItems is a client-side
        // read-modify-write with whole-metadata last-write-wins — a
        // pill click racing this bind can still be lost either way
        // (pre-existing limitation, not introduced here).
        {
          const cur = Array.isArray(d.metadata[RESOURCES_KEY])
            ? (d.metadata[RESOURCES_KEY] as any[])
            : [];
          const usedIds = new Set<string>();
          for (const r of cur) {
            if (r && typeof r === "object" && !isDegenerateResourceId(r.id) && !usedIds.has(r.id)) {
              usedIds.add(r.id);
            }
          }
          const seenGood = new Set<string>();
          for (const r of cur) {
            if (!r || typeof r !== "object") continue;
            const bad = isDegenerateResourceId(r.id) || seenGood.has(r.id);
            if (!bad) {
              seenGood.add(r.id);
              continue;
            }
            if (repairLog.length === 0 && !(RESOURCES_BACKUP_KEY in d.metadata)) {
              d.metadata[RESOURCES_BACKUP_KEY] = {
                ts: Date.now(),
                resources: JSON.parse(JSON.stringify(cur)),
              };
            }
            // Prefer the card's canonical id for this name so the same
            // ability gets the same id on every token; fall back to the
            // deterministic name-derived id.
            const canonical = (autoResources ?? []).find(
              (ar) => ar.name === r.name && typeof ar.id === "string" && !usedIds.has(ar.id),
            );
            const oldId = typeof r.id === "string" ? r.id : "";
            let newId: string;
            if (canonical) {
              newId = canonical.id!;
              usedIds.add(newId);
            } else {
              newId = stableResourceId(String(r.name ?? ""), usedIds);
            }
            r.legacyId = oldId;
            r.id = newId;
            seenGood.add(newId);
            repairLog.push({ name: String(r.name ?? "?"), oldId, newId });
          }
        }
        // 2026-05-15 — auto-resource merge. Spec: only NAME + MAX is
        // applied; if a resource with the same name already exists
        // we update ITS MAX only (preserve current). New names get a
        // full insert with current=max and the parser's icon hint.
        // This way a player who's used 2/4 spell slots keeps the
        // "2 left" state when the DM re-binds / re-parses the card.
        //
        // 2026-08-20 — occurrence-aware: matching is name + occurrence
        // index (Nth same-named card entry pairs with the Nth same-named
        // token entry), so two same-named abilities survive as two
        // independent trackers instead of collapsing in a by-name Map.
        if (autoResources && autoResources.length > 0) {
          const cur = Array.isArray(d.metadata[RESOURCES_KEY])
            ? (d.metadata[RESOURCES_KEY] as any[]).slice()
            : [];
          const usedIds = new Set<string>(
            cur.filter((r) => r && typeof r.id === "string").map((r) => r.id as string),
          );
          const byNameQueue = new Map<string, any[]>();
          for (const r of cur) {
            if (!r || typeof r !== "object") continue;
            const list = byNameQueue.get(r.name) ?? [];
            list.push(r);
            byNameQueue.set(r.name, list);
          }
          const consumed = new Map<string, number>();
          for (const ar of autoResources) {
            const queue = byNameQueue.get(ar.name) ?? [];
            const idx = consumed.get(ar.name) ?? 0;
            const existing = idx < queue.length ? queue[idx] : undefined;
            consumed.set(ar.name, idx + 1);
            if (existing) {
              // Only update max. Clamp `current` down if it now
              // exceeds the new max (e.g. multi-class re-level dropped
              // the slot count). Leave the rest of the entry alone.
              existing.max = ar.max;
              if (typeof existing.current === "number" && existing.current > ar.max) {
                existing.current = ar.max;
              }
            } else {
              const id = typeof ar.id === "string" && !isDegenerateResourceId(ar.id) && !usedIds.has(ar.id)
                ? (usedIds.add(ar.id), ar.id)
                : stableResourceId(ar.name, usedIds);
              cur.push({
                id,
                name: ar.name,
                type: ar.type || "count",
                current: typeof ar.current === "number" ? ar.current : ar.max,
                max: ar.max,
                icon: ar.icon || "gem",
              });
            }
          }
          d.metadata[RESOURCES_KEY] = cur;
        }
      } else {
        delete d.metadata[BIND_META];
        // Unbind also clears the auto-prefilled bonus — the user
        // can re-bind to a different card or set it manually via
        // the initiative panel. Bubbles metadata is intentionally
        // LEFT as-is so the DM doesn't lose mid-session HP edits
        // when temporarily unbinding to swap cards.
        delete d.metadata[INIT_DEXMOD_META];
      }
    });
    if (repairLog.length > 0) {
      for (const rep of repairLog) {
        console.info("[character-cards] resource-id repair", { itemId, ...rep });
      }
      console.info(
        `[character-cards] resource-id repair: ${repairLog.length} entr${repairLog.length === 1 ? "y" : "ies"} repaired on ${itemId} (backup at ${RESOURCES_BACKUP_KEY})`,
      );
    }
    // Toast removed per user feedback — actions are visible enough on
    // the modal that closes itself.
  } catch (e) {
    console.error("[character-cards] bind failed", e);
  }
  try { await OBR.modal.close(MODAL_ID); } catch {}
}

OBR.onReady(async () => {
  applyI18nDom(lang);
  if(await OBR.player.getRole()!=='GM'){listEl.innerHTML=emptyState(lang==='zh'?'只有 GM 可以管理令牌绑定。':'Only the GM can manage token bindings.');tokenNameEl.textContent='';return;}
  const [cards, boundId] = await Promise.all([getCards(), getCurrentBinding()]);
  // Header subtitle: which token this picker is for.
  try {
    const [tok] = itemId ? await OBR.scene.items.getItems([itemId]) : [];
    const name = tok?.name?.trim();
    tokenNameEl.textContent = name ? tt("ccBindTokenLabel").replace("{name}", name) : "";
  } catch { tokenNameEl.textContent = ""; }

  // 撤销 ID 修复 — shown only when this token carries the pre-repair
  // backup written by a previous bind's resource-id repair.
  if (itemId) {
    try {
      const [tok] = await OBR.scene.items.getItems([itemId]);
      const hasBackup = !!(tok?.metadata as any)?.[RESOURCES_BACKUP_KEY];
      if (hasBackup) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.id = "undo-idfix";
        btn.textContent = lang === "zh" ? "撤销 ID 修复" : "Undo ID repair";
        btn.title = lang === "zh"
          ? "仅把资源 ID 恢复为修复前的旧 ID（含旧的重复/空 ID）；当前数值、修复后新增的资源全部保留。"
          : "Reverts only the resource IDs to their pre-repair values (including the old duplicate/empty ids); current values and resources added since the repair are kept.";
        btn.className = "btn btn-sm";
        btn.addEventListener("click", async () => {
          const confirmMsg = lang === "zh"
            ? "确认撤销 ID 修复？\n\n仅恢复资源 ID 为旧值（旧的重复/空 ID 会回来，相关计数可能重新串联）。数值和新增资源不受影响。"
            : "Undo the ID repair?\n\nOnly resource IDs revert to their old values (the old duplicate/empty ids return, so affected trackers may cross-link again). Values and added resources are untouched.";
          if (!window.confirm(confirmMsg)) return;
          if(await OBR.player.getRole()!=='GM'||!await OBR.scene.isReady())return;
          btn.disabled = true;
          const n = await restoreResourceIdBackup(itemId);
          const msg = n === null
            ? (lang === "zh" ? "撤销失败，请查看控制台。" : "Undo failed — see console.")
            : (lang === "zh" ? `已恢复 ${n} 条资源的旧 ID。` : `Reverted ${n} resource id${n === 1 ? "" : "s"}.`);
          try { await OBR.notification.show(msg, n === null ? "ERROR" : "SUCCESS"); } catch {}
          if (n !== null) btn.remove();
          else btn.disabled = false;
        });
        unbindBtn.insertAdjacentElement("afterend", btn);
      }
    } catch (e) {
      console.warn("[character-cards] backup-key probe failed", e);
    }
  }

  if (boundId) {
    const boundCard = cards.find((c) => c.id === boundId);
    curEl.innerHTML = `<span class="chip chip-accent">${ICONS.link}${escapeHtml(tt("ccBindCurrent"))}: ${escapeHtml(boundCard ? boundCard.name : tt("ccBindCardDeleted"))}</span>`;
    unbindBtn.style.display = "";
    unbindBtn.title = tt("ccBindUnbindTitle");
    unbindBtn.innerHTML = `${ICONS.xCircle}${escapeHtml(tt("ccBindUnbind"))}`;
    unbindBtn.addEventListener("click", () => bindTo(null));
  }

  if (cards.length === 0) {
    listEl.innerHTML = emptyState(tt("ccBindNoCards"), tt("ccBindNoCardsHint"));
    countEl.textContent = "";
    return;
  }

  listEl.innerHTML = "";
  const rows: HTMLElement[] = [];
  for (const c of cards) {
    const el = cardRow(c, boundId);
    el.addEventListener("click", () => bindTo(c.id));
    el.addEventListener("keydown", (ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); void bindTo(c.id); } });
    listEl.appendChild(el);
    rows.push(el);
  }
  const noMatch = document.createElement("div");
  noMatch.className = "empty-state";
  noMatch.innerHTML = `${ICONS.search}<div>${escapeHtml(tt("ccBindNoMatch"))}</div>`;
  noMatch.hidden = true;
  listEl.appendChild(noMatch);
  const applyFilter = () => {
    const q = searchEl.value.trim().toLowerCase();
    let shown = 0;
    for (const row of rows) {
      const on = !q || (row.dataset.name || "").includes(q);
      row.hidden = !on;
      if (on) shown++;
    }
    noMatch.hidden = shown > 0;
    countEl.textContent = tt("ccBindCount").replace("{n}", String(shown));
  };
  searchEl.addEventListener("input", applyFilter);
  applyFilter();
  if (cards.length > 6) searchEl.focus();
});
