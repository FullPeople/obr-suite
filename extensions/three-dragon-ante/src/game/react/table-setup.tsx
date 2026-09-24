/** @jsxImportSource react */
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { cardFaceURL } from "../card-images";

export interface TableSetupChoice {
  id: string;
  version?: string;
  versionEn?: string;
  name: string;
  nameEn: string;
  summary?: string;
  summaryEn?: string;
}

export interface TableSetupSpecial {
  id: string;
  name: string;
  nameEn: string;
  strength: number;
}

export interface TableSetupLabels {
  title: string;
  startingGold: string;
  startingHand: string;
  ruleSet: string;
  deckChoice: string;
  variantSummary: string;
  chooseSpecials: string;
  selectedCount: string;
  needTenSpecials: string;
  note: string;
}

export interface TableSetupViewProps {
  visible: boolean;
  language: "zh" | "en";
  startingGold: number;
  startingHand: number;
  ruleSetId: string;
  deckId: string;
  specialIds: readonly string[];
  ruleSets: readonly TableSetupChoice[];
  decks: readonly TableSetupChoice[];
  specials: readonly TableSetupSpecial[];
  variantSummary: string;
  labels: TableSetupLabels;
  onStartingGold(value: number): void;
  onStartingHand(value: number): void;
  onRuleSetChange(value: string): void;
  onDeckChange(value: string): void;
  onSpecialToggle(id: string, checked: boolean): boolean;
}

function boundedNumber(input: HTMLInputElement, fallback: number): number {
  const value = input.valueAsNumber;
  if (!Number.isFinite(value)) return fallback;
  return Math.max(Number(input.min), Math.min(Number(input.max), Math.round(value)));
}

/** Host-lobby setup island. It owns controls and labels, but never sends a command. */
export function TableSetupView(props: TableSetupViewProps) {
  if (!props.visible) return null;
  const selected = new Set(props.specialIds);
  const { labels, language } = props;
  const ruleSet = props.ruleSets.find(option => option.id === props.ruleSetId);
  const deck = props.decks.find(option => option.id === props.deckId);
  return <fieldset className="table-setup">
    <legend>{labels.title}</legend>
    <label>{labels.startingGold}
      <input id="starting-gold" type="number" min="10" max="1000" step="1" value={props.startingGold}
        onChange={event => props.onStartingGold(boundedNumber(event.currentTarget as HTMLInputElement, props.startingGold))} />
    </label>
    <label>{labels.startingHand}
      <input id="starting-hand" type="number" min="3" max="10" step="1" value={props.startingHand}
        onChange={event => props.onStartingHand(boundedNumber(event.currentTarget as HTMLInputElement, props.startingHand))} />
    </label>
    <label>{labels.ruleSet}
      <select id="rule-set" value={props.ruleSetId} onChange={event => props.onRuleSetChange((event.currentTarget as HTMLSelectElement).value)}>
        {props.ruleSets.map(option => <option key={option.id} value={option.id}>{language === "zh" ? option.name : option.nameEn}</option>)}
      </select>
    </label>
    <label>{labels.deckChoice}
      <select id="deck-choice" value={props.deckId} onChange={event => props.onDeckChange((event.currentTarget as HTMLSelectElement).value)}>
        {props.decks.map(option => <option key={option.id} value={option.id}>{language === "zh" ? option.name : option.nameEn}</option>)}
      </select>
    </label>
    <div className="setup-choice-details" aria-live="polite">
      {ruleSet && <article data-setup-choice="rule-set">
        <strong>{language === "zh" ? ruleSet.name : ruleSet.nameEn}</strong>
        {ruleSet.version && <small>{language === "zh" ? ruleSet.version : ruleSet.versionEn ?? ruleSet.version}</small>}
        {ruleSet.summary && <span>{language === "zh" ? ruleSet.summary : ruleSet.summaryEn ?? ruleSet.summary}</span>}
      </article>}
      {deck && <article data-setup-choice="deck">
        <strong>{language === "zh" ? deck.name : deck.nameEn}</strong>
        {deck.version && <small>{language === "zh" ? deck.version : deck.versionEn ?? deck.version}</small>}
        {deck.summary && <span>{language === "zh" ? deck.summary : deck.summaryEn ?? deck.summary}</span>}
      </article>}
    </div>
    <p className="setup-summary">{labels.variantSummary}: {props.variantSummary}</p>
    {props.deckId === "selected-specials-v1" && <fieldset className="special-picker">
      <legend>{labels.chooseSpecials} · {labels.selectedCount} {selected.size}/10</legend>
      {props.specials.map(special => <label key={special.id} className="special-option" data-selected={selected.has(special.id) ? "true" : "false"}>
        <input type="checkbox" checked={selected.has(special.id)} data-card={special.id}
          aria-label={`${language === "zh" ? special.name : special.nameEn} · ${special.strength}`}
          onChange={event => {
            const input = event.currentTarget as HTMLInputElement;
            if (!props.onSpecialToggle(special.id, input.checked)) input.checked = selected.has(special.id);
          }} />
        <img className="setup-card-face" src={cardFaceURL(special.id)} alt="" loading="lazy" decoding="async" width="768" height="1357" />
        <span><strong>{language === "zh" ? special.name : special.nameEn}</strong><small>{special.strength} · {selected.has(special.id) ? labels.selectedCount : ""}</small></span>
      </label>)}
    </fieldset>}
    {props.deckId === "selected-specials-v1" && selected.size !== 10 && <small className="setup-warning">{labels.needTenSpecials}</small>}
    <small>{labels.note}</small>
  </fieldset>;
}

export interface TableSetupMount {
  render(props: TableSetupViewProps): void;
  destroy(): void;
}

export function mountTableSetup(host: HTMLElement): TableSetupMount {
  let destroyed = false;
  const root: Root = createRoot(host);
  host.dataset.uiRenderer = "react";
  return {
    render(props) {
      if (!destroyed) flushSync(() => root.render(<TableSetupView {...props} />));
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      root.unmount();
      delete host.dataset.uiRenderer;
    },
  };
}
