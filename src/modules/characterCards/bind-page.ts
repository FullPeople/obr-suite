import OBR from "@owlbear-rodeo/sdk";
import { ICONS } from "../../icons";
import { applyI18nDom, t } from "../../i18n";
import { getLocalLang } from "../../state";

const lang = getLocalLang();
const tt = (k: Parameters<typeof t>[1]) => t(lang, k);

const MODAL_ID = "com.obr-suite/cc-bind-picker";
const BIND_META = "com.character-cards/boundCardId";
const SCENE_META_KEY = "com.character-cards/list";

interface CardEntry {
  id: string;
  name: string;
  uploader: string;
  uploaded_at: string;
  url: string;
}

const params = new URLSearchParams(location.search);
const itemId = params.get("itemId");

const listEl = document.getElementById("list") as HTMLDivElement;
const curEl = document.getElementById("cur") as HTMLDivElement;
const unbindBtn = document.getElementById("unbind") as HTMLButtonElement;

function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}

async function getCards(): Promise<CardEntry[]> {
  try {
    const meta = await OBR.scene.getMetadata();
    const list = meta[SCENE_META_KEY];
    return Array.isArray(list) ? (list as CardEntry[]) : [];
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

async function bindTo(cardId: string | null) {
  if (!itemId) return;
  try {
    await OBR.scene.items.updateItems([itemId], (drafts) => {
      const d = drafts[0];
      if (!d) return;
      if (cardId) d.metadata[BIND_META] = cardId;
      else delete d.metadata[BIND_META];
    });
    // Toast removed per user feedback — actions are visible enough on
     // the modal that closes itself.
  } catch (e) {
    console.error("[character-cards] bind failed", e);
  }
  try { await OBR.modal.close(MODAL_ID); } catch {}
}

OBR.onReady(async () => {
  applyI18nDom(lang);
  const [cards, boundId] = await Promise.all([getCards(), getCurrentBinding()]);

  if (boundId) {
    const boundCard = cards.find((c) => c.id === boundId);
    curEl.textContent = boundCard
      ? `${tt("ccBindCurrent")}: ${boundCard.name}`
      : `${tt("ccBindCurrent")}: ${tt("ccBindCardDeleted")}`;
    unbindBtn.style.display = "inline-block";
    unbindBtn.addEventListener("click", () => bindTo(null));
  }

  if (cards.length === 0) {
    listEl.innerHTML = `<div class="empty">${tt("ccBindNoCards")}<br>${tt("ccBindUploadHint")} ${ICONS.idCard} ${tt("ccBindUploadHint2")}</div>`;
    return;
  }

  listEl.innerHTML = "";
  for (const c of cards) {
    const el = document.createElement("div");
    el.className = "card" + (c.id === boundId ? " cur" : "");
    el.innerHTML = `<span class="n">${escapeHtml(c.name)}</span><span class="m">${escapeHtml(c.uploader || "")}</span>`;
    el.addEventListener("click", () => bindTo(c.id));
    listEl.appendChild(el);
  }
});
