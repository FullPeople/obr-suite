type Language = "zh" | "en";
type Field = HTMLInputElement | HTMLTextAreaElement;
interface RenderRequest {
  scope: string;
  html: string;
  language: Language;
  editable: boolean;
  afterRender?: () => void;
}
interface Draft {
  value: string;
  dirty: boolean;
  start: number | null;
  end: number | null;
  direction: "forward" | "backward" | "none" | null;
}

/** Refresh only changed settings markup. Explicit, stable field keys protect
 * drafts across room updates without transferring an edit to a different row.
 * Values/selection are restored; permissions and all other markup come from
 * the new render. Drafts live only in this open tab, never in room metadata. */
export class SettingsContent {
  private previous: RenderRequest | undefined;
  private composing = false;
  private pending: RenderRequest | undefined;
  private saveErrors = new Map<string, () => void>();

  constructor(private root: HTMLElement) {
    root.addEventListener("compositionstart", () => { this.composing = true; });
    root.addEventListener("compositionend", () => {
      // The final input event follows compositionend. Keep protecting the field
      // until the next task, including microtasks between those native events.
      setTimeout(() => {
        this.composing = false;
        const pending = this.pending;
        this.pending = undefined;
        if (pending) this.render(pending);
      });
    });
  }

  field(key: string): Field | undefined {
    return this.fields().find((field) => field.dataset.settingsDraft === key);
  }

  private fields(): Field[] {
    return Array.from(this.root.querySelectorAll<Field>("input[data-settings-draft], textarea[data-settings-draft]"));
  }

  render(request: RenderRequest): boolean {
    const previous = this.previous;
    const sameTab = previous?.scope === request.scope;
    const samePermissions = previous?.editable === request.editable;
    if (sameTab && samePermissions && previous?.language === request.language && previous.html === request.html) {
      this.pending = undefined;
      return false;
    }
    // Don't interrupt a Chinese/Japanese composition. Revoking permissions or
    // navigating to another page still takes effect immediately.
    if (this.composing && sameTab && samePermissions) {
      this.pending = request;
      return false;
    }
    this.pending = undefined;
    this.composing = false;
    if (!sameTab) this.saveErrors.clear();
    const drafts = new Map<string, Draft>();
    const active = this.root.ownerDocument.activeElement as Field | null;
    const focusKey = sameTab && active && this.root.contains(active) ? active.dataset.settingsDraft : undefined;
    if (sameTab) {
      for (const field of this.fields()) {
        drafts.set(field.dataset.settingsDraft!, {
          value: field.value,
          dirty: field.value !== field.defaultValue,
          start: field.selectionStart, end: field.selectionEnd, direction: field.selectionDirection,
        });
      }
    }
    const scrollTop = this.root.scrollTop;
    const scrollLeft = this.root.scrollLeft;
    const disclosures = new Map(Array.from(this.root.querySelectorAll<HTMLDetailsElement>("details[class]"))
      .map((details) => [details.className, details.open]));
    this.root.innerHTML = request.html;
    this.previous = request;
    request.afterRender?.();
    for (const field of this.fields()) {
      const key = field.dataset.settingsDraft!;
      const draft = drafts.get(key);
      if (!draft) continue;
      if (draft.dirty && draft.value !== field.value) {
        const current = field.value;
        field.value = draft.value;
        const empty = request.language === "zh" ? "（空）" : "(empty)";
        const message = field.hasAttribute("data-settings-local")
          ? (request.language === "zh" ? "未提交的输入已保留。" : "Your unsaved input is preserved.")
          : request.language === "zh"
            ? `未提交的输入已保留。当前已保存值：${current || empty}`
            : `Your unsaved input is preserved. Current saved value: ${current || empty}`;
        this.note(field, message);
      }
      const retry = this.saveErrors.get(key);
      if (retry && field.value !== field.defaultValue) this.showSaveError(key, retry);
      else this.saveErrors.delete(key);
      if (key === focusKey && !field.disabled) {
        field.focus({ preventScroll: true });
        if (draft.start !== null && draft.end !== null) {
          field.setSelectionRange(draft.start, draft.end, draft.direction ?? "none");
        }
      }
    }
    if (sameTab) {
      for (const details of this.root.querySelectorAll<HTMLDetailsElement>("details[class]")) {
        const open = disclosures.get(details.className);
        if (open !== undefined) details.open = open;
      }
      this.root.scrollTop = scrollTop;
      this.root.scrollLeft = scrollLeft;
    }
    return true;
  }

  showSaveError(key: string, retry: () => void): void {
    const field = this.field(key);
    if (!field) return;
    this.saveErrors.set(key, retry);
    const zh = this.previous?.language !== "en";
    const saved = field.defaultValue || (zh ? "（空）" : "(empty)");
    const note = this.note(field, zh
      ? `保存失败，输入已保留。当前已保存值：${saved}`
      : `Save failed. Your input is preserved. Current saved value: ${saved}`);
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = zh ? "重试" : "Retry";
    button.style.marginInlineStart = "6px";
    button.disabled = field.disabled || field.readOnly;
    button.addEventListener("click", retry);
    note.append(button);
  }

  clearNote(key: string): void {
    this.saveErrors.delete(key);
    const field = this.field(key);
    if (field) this.removeNote(field);
  }

  private removeNote(field: Field): void {
    for (const note of this.root.querySelectorAll<HTMLElement>("[data-settings-note]")) {
      if (note.dataset.settingsNote === field.dataset.settingsDraft) note.remove();
    }
  }

  private note(field: Field, message: string): HTMLElement {
    this.removeNote(field);
    const note = document.createElement("span");
    note.dataset.settingsNote = field.dataset.settingsDraft;
    note.setAttribute("role", "status");
    note.style.cssText = "display:block;font-size:11px;color:var(--text-dim);overflow-wrap:anywhere";
    note.textContent = message;
    // Put the note below the input's whole row, so narrow flex layouts keep
    // their input, unit label and action buttons at the original widths.
    (field.closest("[data-settings-line]") ?? field).insertAdjacentElement("afterend", note);
    return note;
  }
}
