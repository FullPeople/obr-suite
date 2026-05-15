// DM-only scene-ready announcement modal.
//
// Content lives in `public/announcement.md` so the user can edit it
// without touching code. We fetch the markdown at runtime and parse a
// small dialect:
//
//   # Page title           → window title (decorative)
//   ## 标题 [kind]         → opens a section. The `[kind]` suffix
//                            picks the visual style. Recognised kinds:
//
//       [warn]       → red alert rows
//       [info]       → blue alert rows
//       [issues]     → "Issues / Requests" table — bug/feature/wip/done
//                      rows with severity tag (A-block "bug 需求表格高亮")
//       [highlights] → image+text feature-spotlight cards
//                      (B-block "新亮点图文")
//       [todo]       → bulleted todo list (per item: `desc | tag | size`)
//       [changelog]  → version log (per item: `version · description`)
//                      C-block "简单更新日志"
//       [footer]     → credit line above the close button
//
//     If no `[kind]` suffix is present the section renders as a plain
//     paragraph block.
//
//   - text                 → list item inside the current section
//   - desc | tag | size    → todo-section format. `size`=`large` → big tag.
//   - 1.0.57 · changes     → changelog-section format.
//   - bug | high | desc    → issues-section format.
//                            type ∈ bug/feature/wip/done, level optional.
//   - imageUrl | title | desc → highlights-section. imageUrl can be empty.
//   > comment              → author note, skipped.
//
// Inline:
//   **bold**   → <b>...</b>
//   `code`     → <code>...</code>
//   email@x.y  → mailto link
//
// This is a deliberately tiny parser — the announcement is short and
// rare to update, no need for a full markdown lib.

import OBR from "@owlbear-rodeo/sdk";
import { assetUrl } from "./asset-base";

const MODAL_ID = "com.obr-suite/dm-announcement";

type SectionKind = "warn" | "info" | "issues" | "highlights" | "todo" | "changelog" | "footer" | "raw";
type SectionLang = "zh" | "en" | undefined; // undefined = visible in both

interface Section {
  /** Localised heading text from the `##` line. Used for sections
   *  that render a visible header (todo, changelog). warn/info/footer
   *  ignore it. */
  heading: string;
  /** Visual style picked from the `[kind]` suffix on the heading line. */
  kind: SectionKind;
  /** Optional `[zh]` / `[en]` suffix — when set, the section only
   *  renders while the announcement modal's CN|EN toggle matches.
   *  When absent, the section is shown in both languages (use this
   *  for the footer / shared notices). */
  lang: SectionLang;
  /** Bulleted lines below the heading (without the leading `- `). */
  items: string[];
}

const KNOWN_KINDS: ReadonlySet<SectionKind> = new Set([
  "warn", "info", "issues", "highlights", "todo", "changelog", "footer", "raw",
]);

// Issues section: type → chip class. Anything not in this map renders
// as the default `t-other` chip so unknown types don't break layout.
const ISSUE_TYPE_LABELS: Record<string, { label: string; cls: string }> = {
  bug:     { label: "BUG",     cls: "t-bug" },
  feature: { label: "需求",    cls: "t-feature" },
  feat:    { label: "需求",    cls: "t-feature" },
  wip:     { label: "进行中",  cls: "t-wip" },
  done:    { label: "已修复",  cls: "t-done" },
  fixed:   { label: "已修复",  cls: "t-done" },
};
const ISSUE_LEVEL_LABELS: Record<string, { label: string; cls: string }> = {
  critical: { label: "紧急", cls: "l-critical" },
  high:     { label: "高",   cls: "l-high" },
  medium:   { label: "中",   cls: "l-medium" },
  med:      { label: "中",   cls: "l-medium" },
  low:      { label: "低",   cls: "l-low" },
};

function parseAnnouncement(md: string): Section[] {
  const sections: Section[] = [];
  let cur: Section | null = null;
  // Heading suffixes can chain: "## title [kind] [lang]". We strip
  // them right-to-left so any combination order parses cleanly.
  const TRAILING_TAG = /\s*\[([a-z]+)\]\s*$/i;

  for (const rawLine of md.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    if (line.startsWith("# ")) continue; // page title — display title only
    if (line.startsWith(">")) continue; // author comment

    if (line.startsWith("## ")) {
      let heading = line.slice(3).trim();
      let kind: SectionKind = "raw";
      let lang: SectionLang = undefined;
      // Pop trailing [tag]s up to twice: one for kind, one for lang.
      for (let i = 0; i < 2; i++) {
        const m = heading.match(TRAILING_TAG);
        if (!m) break;
        const candidate = m[1].toLowerCase();
        if (candidate === "zh" || candidate === "en") {
          lang = candidate;
          heading = heading.replace(TRAILING_TAG, "").trim();
        } else if (KNOWN_KINDS.has(candidate as SectionKind)) {
          kind = candidate as SectionKind;
          heading = heading.replace(TRAILING_TAG, "").trim();
        } else {
          break; // unknown tag — leave it in the heading
        }
      }
      cur = { heading, kind, lang, items: [] };
      sections.push(cur);
      continue;
    }

    if (line.startsWith("- ") && cur) {
      cur.items.push(line.slice(2).trim());
      continue;
    }

    // Plain paragraph in current section — treat as a single item so
    // sections like [footer] / [raw] can carry free-form text.
    if (cur) cur.items.push(line);
  }
  return sections;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderInline(text: string): string {
  // Allow a tightly-whitelisted `<span style="color:#xxx">…</span>`
  // for inline color highlights inside the announcement. We extract
  // those before escapeHtml stamps them flat, recurse over the inner
  // text so bold / code / email still work inside the colored span,
  // then splice them back in at the end via a placeholder marker.
  const SPAN_RE = /<span\s+style="color:\s*(#[0-9a-fA-F]{3,8})\s*"\s*>([\s\S]*?)<\/span>/g;
  const stash: string[] = [];
  const stashed = text.replace(SPAN_RE, (_full, color, inner) => {
    const idx = stash.length;
    stash.push(`<span style="color:${color}">${renderInlineNoSpan(inner)}</span>`);
    return `__SPAN_${idx}__`;
  });
  let out = renderInlineNoSpan(stashed);
  out = out.replace(/__SPAN_(\d+)__/g, (_m, n) => stash[+n] ?? "");
  return out;
}

function renderInlineNoSpan(text: string): string {
  let out = escapeHtml(text);
  // **bold**
  out = out.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  // `code`
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  // bare email → mailto link
  out = out.replace(
    /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g,
    '<a href="mailto:$1">$1</a>'
  );
  // bare URL -> clickable link
  out = out.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener">$1</a>'
  );
  return out;
}

function renderSection(s: Section): string {
  if (s.kind === "warn" || s.kind === "info") {
    const cls = s.kind === "warn" ? "warn" : "info";
    return s.items
      .map((it, idx) => {
        const primary = idx === 0 ? " primary" : "";
        return `<div class="alert-row ${cls}${primary}"><span class="dot"></span><span class="text">${renderInline(it)}</span></div>`;
      })
      .join("");
  }
  if (s.kind === "issues") {
    // Per row: "type | level | desc"  OR  "type | desc" (level skipped).
    // type ∈ bug / feature / wip / done. level optional.
    const rows = s.items
      .map((it) => {
        const parts = it.split("|").map((p) => p.trim());
        let typeKey = (parts[0] || "").toLowerCase();
        let levelKey = "";
        let desc = "";
        if (parts.length >= 3) {
          levelKey = (parts[1] || "").toLowerCase();
          desc = parts.slice(2).join(" | ").trim();
        } else if (parts.length === 2) {
          desc = parts[1] || "";
        } else {
          desc = parts[0] || "";
          typeKey = "";
        }
        const t = ISSUE_TYPE_LABELS[typeKey];
        const typeChip = t
          ? `<span class="iss-type ${t.cls}">${escapeHtml(t.label)}</span>`
          : (typeKey
            ? `<span class="iss-type t-other">${escapeHtml(typeKey.toUpperCase())}</span>`
            : "");
        const lvl = ISSUE_LEVEL_LABELS[levelKey];
        const levelChip = lvl
          ? `<span class="iss-level ${lvl.cls}">${escapeHtml(lvl.label)}</span>`
          : "";
        return `<div class="iss-row">${typeChip}${levelChip}<span class="iss-desc">${renderInline(desc)}</span></div>`;
      })
      .join("");
    const heading = s.heading
      ? `<div class="section-title">${escapeHtml(s.heading)}</div>`
      : "";
    return `${heading}<div class="iss-list">${rows}</div>`;
  }
  if (s.kind === "highlights") {
    // Per row: "imageUrl | title | desc"  OR  "title | desc" (no image).
    // imageUrl can be a relative path (resolved via assetUrl), an
    // absolute URL, or empty (renders text-only card).
    const rows = s.items
      .map((it) => {
        const parts = it.split("|").map((p) => p.trim());
        let imageUrl = "";
        let title = "";
        let desc = "";
        if (parts.length >= 3) {
          imageUrl = parts[0] || "";
          title = parts[1] || "";
          desc = parts.slice(2).join(" | ").trim();
        } else if (parts.length === 2) {
          // No leading slash + no `http` → first part is title.
          // Otherwise first part is imageUrl, second is title.
          if (/^(https?:|\/)/i.test(parts[0])) {
            imageUrl = parts[0];
            title = parts[1] || "";
          } else {
            title = parts[0] || "";
            desc = parts[1] || "";
          }
        } else {
          title = parts[0] || "";
        }
        const resolvedSrc = imageUrl
          ? (/^https?:/i.test(imageUrl) ? imageUrl : assetUrl(imageUrl.replace(/^\//, "")))
          : "";
        const imgHtml = resolvedSrc
          ? `<img class="hl-img" src="${escapeHtml(resolvedSrc)}" alt="" loading="lazy">`
          : `<div class="hl-img hl-img-empty"></div>`;
        const titleHtml = title
          ? `<div class="hl-title">${renderInline(title)}</div>`
          : "";
        const descHtml = desc
          ? `<div class="hl-desc">${renderInline(desc)}</div>`
          : "";
        return `<div class="hl-card${resolvedSrc ? "" : " no-img"}">${imgHtml}<div class="hl-body">${titleHtml}${descHtml}</div></div>`;
      })
      .join("");
    const heading = s.heading
      ? `<div class="section-title">${escapeHtml(s.heading)}</div>`
      : "";
    return `${heading}<div class="hl-list">${rows}</div>`;
  }
  if (s.kind === "todo") {
    const rows = s.items
      .map((it) => {
        // "desc | tag | size"
        const parts = it.split("|").map((p) => p.trim());
        const desc = parts[0] || "";
        const tag = parts[1] || "";
        const tagSize = (parts[2] || "").toLowerCase();
        const tagHtml = tag
          ? `<span class="tag${tagSize === "large" ? " large" : ""}">${escapeHtml(tag)}</span>`
          : "";
        return `<div class="todo-item"><span class="marker">▸</span><span class="desc">${renderInline(desc)}</span>${tagHtml}</div>`;
      })
      .join("");
    const heading = s.heading
      ? `<div class="section-title">${escapeHtml(s.heading)}</div>`
      : "";
    return `${heading}<div class="todo-list">${rows}</div>`;
  }
  if (s.kind === "changelog") {
    const rows = s.items
      .map((it) => {
        // "version · description" — version is anything before the
        // first `·` or `-` separator. Fall back to whole string.
        const sepMatch = it.match(/^([^·\-—]+?)\s*[·\-—]\s*(.+)$/);
        const version = sepMatch ? sepMatch[1].trim() : it.trim();
        const desc = sepMatch ? sepMatch[2].trim() : "";
        const versionHtml = `<span class="cl-version">${escapeHtml(version)}</span>`;
        const descHtml = desc
          ? `<span class="cl-desc">${renderInline(desc)}</span>`
          : "";
        return `<div class="cl-row">${versionHtml}${descHtml}</div>`;
      })
      .join("");
    const heading = s.heading
      ? `<div class="section-title">${escapeHtml(s.heading)}</div>`
      : "";
    return `${heading}<div class="changelog-list">${rows}</div>`;
  }
  if (s.kind === "footer") {
    return `<div class="credit-line">${s.items.map(renderInline).join(" ")}</div>`;
  }
  // raw fallback — also render an `<h4>` if the section had a
  // heading, so user-defined free-form sections still display nicely.
  const heading = s.heading
    ? `<div class="section-title">${escapeHtml(s.heading)}</div>`
    : "";
  return `${heading}<div class="raw-block">${s.items.map(renderInline).join("<br>")}</div>`;
}

// Per-client preference for the announcement's CN|EN toggle. This is
// INDEPENDENT of the suite-wide language setting — users may want to
// read the English log even on a Chinese client, or vice-versa.
const LS_ANNOUNCE_LANG = "obr-suite/announce-lang";
function readAnnounceLang(): "zh" | "en" {
  try {
    const v = localStorage.getItem(LS_ANNOUNCE_LANG);
    return v === "en" ? "en" : "zh";
  } catch { return "zh"; }
}
function writeAnnounceLang(v: "zh" | "en") {
  try { localStorage.setItem(LS_ANNOUNCE_LANG, v); } catch {}
}

let cachedSections: Section[] | null = null;

function rerenderForLang(activeLang: "zh" | "en"): void {
  const bodyEl = document.getElementById("body");
  const creditEl = document.getElementById("credit");
  if (!bodyEl || !cachedSections) return;
  const visible = cachedSections.filter(
    (s) => s.lang === undefined || s.lang === activeLang,
  );
  const bodyHtml: string[] = [];
  let footerHtml = "";
  for (const s of visible) {
    if (s.kind === "footer") {
      footerHtml = renderSection(s);
    } else {
      bodyHtml.push(renderSection(s));
    }
  }
  bodyEl.innerHTML = bodyHtml.join("");
  if (creditEl) creditEl.innerHTML = footerHtml;
}

function applyLangButtons(activeLang: "zh" | "en"): void {
  const zhBtn = document.getElementById("ann-lang-zh");
  const enBtn = document.getElementById("ann-lang-en");
  if (zhBtn) zhBtn.classList.toggle("on", activeLang === "zh");
  if (enBtn) enBtn.classList.toggle("on", activeLang === "en");
}

async function loadAndRender(): Promise<void> {
  const bodyEl = document.getElementById("body");
  if (!bodyEl) return;

  let md = "";
  try {
    const url = assetUrl("announcement.md");
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    md = await res.text();
  } catch (e) {
    bodyEl.innerHTML = `<div class="alert-row warn"><span class="dot"></span><span class="text">公告加载失败：${escapeHtml(String((e as Error).message ?? e))}</span></div>`;
    return;
  }

  cachedSections = parseAnnouncement(md);
  const lang = readAnnounceLang();
  applyLangButtons(lang);
  rerenderForLang(lang);
}

// 2026-05-14 — stamp the running build version into the modal title.
// The dev build serves `manifest-dev.json`, stable serves
// `manifest.json`; we try dev first and fall back, so the same code
// works on both channels (the 404 on the wrong-channel file just
// falls through).
async function loadVersionIntoTitle(): Promise<void> {
  const titleEl = document.querySelector<HTMLElement>(".head .title");
  if (!titleEl) return;
  for (const name of ["manifest-dev.json", "manifest.json"]) {
    try {
      const res = await fetch(assetUrl(name), { cache: "no-cache" });
      if (!res.ok) continue;
      const m = await res.json();
      if (m && typeof m.version === "string" && m.version) {
        titleEl.textContent = `Full Suite v${m.version}`;
        return;
      }
    } catch {
      /* try the next candidate */
    }
  }
}

OBR.onReady(() => {
  void loadAndRender();
  void loadVersionIntoTitle();

  // 2026-05-14 — the announcement now ONLY closes via the "我知道了"
  // button. The previous auto-close timer (?auto=1 → 5 s) and the
  // Escape-to-close handler were both removed per user request: the
  // DM should explicitly acknowledge the announcement. The `?auto=1`
  // URL param + the .auto-progress bar are now inert.
  document.getElementById("btn-close")?.addEventListener("click", async () => {
    try { await OBR.modal.close(MODAL_ID); } catch {}
  });

  // Independent CN|EN toggle in the modal header — only switches which
  // language sections render here. It does NOT touch the suite-wide
  // language preference (which is set in the Settings panel).
  document.getElementById("ann-lang-zh")?.addEventListener("click", () => {
    writeAnnounceLang("zh");
    applyLangButtons("zh");
    rerenderForLang("zh");
  });
  document.getElementById("ann-lang-en")?.addEventListener("click", () => {
    writeAnnounceLang("en");
    applyLangButtons("en");
    rerenderForLang("en");
  });
});
