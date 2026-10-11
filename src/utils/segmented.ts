// Progressive enhancement: a native <select> with a handful of options becomes
// a visible button group. The select stays in the DOM as the single source of
// truth (hidden), so every existing `select.value` read and `change` listener
// keeps working unchanged; the buttons just set the value and dispatch change.
export interface SegmentedOptions {
  /** Max option count to enhance; longer lists stay native drop-downs. */
  maxOptions?: number;
  /** Extra class on the generated group. */
  className?: string;
}
const STYLE_ID = "seg-select-style";
const CSS =
  `.seg-select{display:inline-flex;flex-wrap:wrap;align-items:stretch;gap:0;border:1px solid var(--border-strong,rgba(255,255,255,.36));border-radius:6px;overflow:hidden;background:var(--bg-card,var(--bg-strong,rgba(255,255,255,.04)));max-width:100%}` +
  `.seg-select>button{appearance:none;flex:1 1 auto;min-height:26px;padding:4px 10px;border:0;border-radius:0;background:transparent;color:var(--text,inherit);font:inherit;font-size:12px;line-height:1.2;cursor:pointer;white-space:nowrap}` +
  `.seg-select>button+button{border-left:1px solid var(--border-strong,rgba(255,255,255,.36))}` +
  `.seg-select>button:hover{background:rgba(255,255,255,.08)}` +
  `.seg-select>button[aria-pressed=true]{background:var(--accent,#5dade2);color:var(--accent-ink,#0b1320);font-weight:700}` +
  `.seg-select>button:focus-visible{outline:2px solid var(--accent,#5dade2);outline-offset:-2px}` +
  `.seg-select>button:disabled{opacity:.5;cursor:not-allowed}`;
function ensureStyle(doc: Document) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  doc.head.appendChild(style);
}
export function enhanceSelect(select: HTMLSelectElement, options: SegmentedOptions = {}): HTMLElement | null {
  const max = options.maxOptions ?? 5;
  if (!select || select.multiple || select.options.length === 0 || select.options.length > max) return null;
  if ((select as any).__segmented) return (select as any).__segmented as HTMLElement;
  ensureStyle(select.ownerDocument);
  const group = select.ownerDocument.createElement("div");
  group.className = "seg-select" + (options.className ? " " + options.className : "");
  group.setAttribute("role", "group");
  const label = select.getAttribute("aria-label") || select.title || select.closest("label")?.textContent?.trim();
  if (label) group.setAttribute("aria-label", label);
  const buttons: HTMLButtonElement[] = [];
  const sync = () => {
    for (const button of buttons) {
      const on = button.dataset.value === select.value;
      button.setAttribute("aria-pressed", on ? "true" : "false");
      button.disabled = select.disabled;
    }
  };
  const render = () => {
    group.textContent = "";
    buttons.length = 0;
    for (const option of Array.from(select.options)) {
      const button = select.ownerDocument.createElement("button");
      button.type = "button";
      button.dataset.value = option.value;
      button.textContent = option.textContent || option.value;
      if (option.title) button.title = option.title;
      button.addEventListener("click", () => {
        if (select.value === option.value) return;
        select.value = option.value;
        sync();
        select.dispatchEvent(new Event("input", { bubbles: true }));
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      buttons.push(button);
      group.appendChild(button);
    }
    sync();
  };
  render();
  select.addEventListener("change", sync);
  // Option text is translated after the fact on several pages; follow it.
  new MutationObserver(render).observe(select, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["disabled", "value"] });
  select.hidden = true;
  select.setAttribute("aria-hidden", "true");
  select.tabIndex = -1;
  select.insertAdjacentElement("afterend", group);
  (select as any).__segmented = group;
  return group;
}
/** Enhance every `<select data-segmented>` under the root. */
export function enhanceSegmentedSelects(root: ParentNode = document, options: SegmentedOptions = {}): void {
  for (const select of Array.from(root.querySelectorAll<HTMLSelectElement>("select[data-segmented]"))) enhanceSelect(select, options);
}
