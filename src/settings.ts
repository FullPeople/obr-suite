import OBR from "@owlbear-rodeo/sdk";
import {
  startSceneSync,
  getState,
  onStateChange,
  setState,
  ModuleId,
  DataVersion,
  Language,
} from "./state";
import { t, applyLangAttr } from "./i18n";

const POPOVER_ID = "com.obr-suite/settings";
const titleEl = document.getElementById("title") as HTMLHeadingElement;
const roleEl = document.getElementById("role") as HTMLSpanElement;
const bodyEl = document.getElementById("body") as HTMLDivElement;
const closeEl = document.getElementById("closeBtn") as HTMLButtonElement;

let isGM = false;

function moduleRow(
  id: ModuleId,
  labelKey: keyof typeof import("./i18n").t extends never ? string : any,
  desc?: string
): string {
  const s = getState();
  const on = !!s.enabled[id];
  const labelStr = t(s.language, labelKey as any);
  return `<div class="row">
    <div class="lbl">${labelStr}${desc ? `<div class="desc">${desc}</div>` : ""}</div>
    <button class="tog ${on ? "on" : ""}" data-mod="${id}" type="button" ${
    isGM ? "" : "disabled"
  } aria-pressed="${on}"></button>
  </div>`;
}

function radioRow<T extends string>(
  group: string,
  value: T,
  current: T,
  labelKey: any
): string {
  const s = getState();
  const labelStr = t(s.language, labelKey);
  const checked = current === value ? "checked" : "";
  const cls = isGM ? "radio-row" : "radio-row disabled";
  return `<label class="${cls}"><input type="radio" name="${group}" value="${value}" ${checked} ${
    isGM ? "" : "disabled"
  }><span>${labelStr}</span></label>`;
}

function render() {
  const s = getState();
  applyLangAttr(s.language);

  titleEl.textContent = t(s.language, "settingsTitle");
  closeEl.textContent = t(s.language, "close");
  roleEl.textContent = isGM ? "" : t(s.language, "settingsRoleNotice");

  const parts: string[] = [];

  // ---- Modules ----
  parts.push(`<div class="section">
    <div class="section-title">${t(s.language, "settingsModules")}</div>
    ${moduleRow("timeStop", "modTimeStop")}
    ${moduleRow("focus", "modFocus")}
    ${moduleRow("bestiary", "modBestiary")}
    ${moduleRow("characterCards", "modCharacterCards")}
    ${moduleRow("initiative", "modInitiative")}
    ${moduleRow("search", "modSearch")}
    ${
      s.language === "en"
        ? `<div class="warn">${t(s.language, "charCardEnWarning")}</div>`
        : ""
    }
  </div>`);

  // ---- Data version ----
  parts.push(`<div class="section">
    <div class="section-title">${t(s.language, "settingsDataVersion")}</div>
    <div class="section-sub">2014 = PHB + MM &nbsp;·&nbsp; 2024 = XPHB + XMM &nbsp;·&nbsp; 全部 = 2014 + 2024 + 拓展</div>
    <div class="radio-group">
      ${radioRow<DataVersion>("dataVersion", "2014", s.dataVersion, "ver2014")}
      ${radioRow<DataVersion>("dataVersion", "2024", s.dataVersion, "ver2024")}
      ${radioRow<DataVersion>("dataVersion", "all", s.dataVersion, "verAll")}
    </div>
  </div>`);

  // ---- Per-module options ----
  parts.push(`<div class="section">
    <div class="section-title">${t(s.language, "modSearch")}</div>
    <div class="row">
      <div class="lbl">${t(s.language, "searchAllowMonsters")}</div>
      <button class="tog ${
        s.allowPlayerMonsters ? "on" : ""
      }" data-key="allowPlayerMonsters" type="button" ${
    isGM ? "" : "disabled"
  } aria-pressed="${s.allowPlayerMonsters}"></button>
    </div>
  </div>`);

  // ---- Language ----
  parts.push(`<div class="section">
    <div class="section-title">${t(s.language, "settingsLanguage")}</div>
    <div class="radio-group">
      ${radioRow<Language>("language", "zh", s.language, "langZh")}
      ${radioRow<Language>("language", "en", s.language, "langEn")}
    </div>
  </div>`);

  bodyEl.innerHTML = parts.join("");

  // Wire toggles
  bodyEl
    .querySelectorAll<HTMLButtonElement>(".tog[data-mod]")
    .forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!isGM) return;
        const id = btn.dataset.mod as ModuleId;
        const cur = getState().enabled[id];
        await setState({ enabled: { [id]: !cur } as any });
      });
    });
  bodyEl
    .querySelector<HTMLButtonElement>('.tog[data-key="allowPlayerMonsters"]')
    ?.addEventListener("click", async () => {
      if (!isGM) return;
      await setState({ allowPlayerMonsters: !getState().allowPlayerMonsters });
    });
  bodyEl
    .querySelectorAll<HTMLInputElement>('input[type="radio"]')
    .forEach((inp) => {
      inp.addEventListener("change", async () => {
        if (!isGM) return;
        const name = inp.name;
        const value = inp.value;
        if (name === "dataVersion") {
          await setState({ dataVersion: value as DataVersion });
        } else if (name === "language") {
          await setState({ language: value as Language });
        }
      });
    });
}

closeEl.addEventListener("click", async () => {
  try { await OBR.popover.close(POPOVER_ID); } catch {}
});

OBR.onReady(async () => {
  try {
    isGM = (await OBR.player.getRole()) === "GM";
  } catch {}
  startSceneSync();
  onStateChange(() => render());
  render();
});
