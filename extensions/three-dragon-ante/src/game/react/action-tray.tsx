/** @jsxImportSource react */
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import type { Card } from "../rules/cards";
import type { EligibleAction, PublicView, SeatView } from "../rules/types";
import { cardFaceURL } from "../card-images";

export interface ActionTrayLabels {
  paused: string;
  pausedHelp: string;
  ended: string;
  winners: string;
  ownAnte: string;
  anteInstruction: string;
  flightInstruction: string;
  abilityBy: string;
  selection: string;
  chooseRange: string;
  confirm: string;
  inspect: string;
}

export interface ActionTrayViewProps {
  game: PublicView | SeatView | null;
  own: SeatView | null;
  action: EligibleAction | undefined;
  selectedIds: readonly string[];
  locked: boolean;
  language: "zh" | "en";
  labels: ActionTrayLabels;
  rulePrompt(code: string): string;
  cardName(value: Card): string;
  cardHint(value: Card): string;
  seatName(id: string): string;
  card(value: string): Card;
  cardOwner(cardId: string): string | null;
  onToggle(id: string): void;
  onConfirm(): void;
  onInspect(cardId: string, pinned: boolean): void;
  onLeaveInspect(cardId: string): void;
}

function ChoiceCard({ value, optionId, selected, disabled, props }: {
  value: Card;
  optionId: string;
  selected: boolean;
  disabled: boolean;
  props: ActionTrayViewProps;
}) {
  const name = props.cardName(value);
  return <div className={`card-wrap${selected ? " selected" : ""}`}>
    <button
      className="card printed-card"
      type="button"
      data-card={value.id}
      data-option={optionId}
      aria-pressed={selected}
      aria-label={`${name} · ${value.strength} · ${props.cardHint(value)}`}
      disabled={disabled}
      onClick={() => props.onToggle(optionId)}
      onPointerEnter={event => { if (event.pointerType !== "touch") props.onInspect(value.id, false); }}
      onPointerLeave={() => props.onLeaveInspect(value.id)}
      onFocus={() => props.onInspect(value.id, false)}
      onBlur={() => props.onLeaveInspect(value.id)}
    >
      <img className="printed-card-face" src={cardFaceURL(value.id)} alt="" draggable={false} width="768" height="1357" />
    </button>
    <button className="inspect-card" type="button" aria-label={`${props.labels.inspect}: ${name}`} title={props.labels.inspect} onClick={() => props.onInspect(value.id, true)}>i</button>
    {props.cardOwner(value.id) && <small>{props.cardOwner(value.id)}</small>}
  </div>;
}

function ChoiceTray({ choice, props }: { choice: Extract<EligibleAction, { kind: "choose" }>['choice']; props: ActionTrayViewProps }) {
  const selected = new Set(props.selectedIds);
  const max = choice.max;
  const options = choice.options.map(option => {
    const value = option.cardId ? props.card(option.cardId) : null;
    const disabled = props.locked || !selected.has(option.id) && (selected.size >= max);
    return value ? <ChoiceCard key={option.id} value={value} optionId={option.id} selected={selected.has(option.id)} disabled={disabled} props={props} /> :
      <button key={option.id} type="button" data-option={option.id} aria-pressed={selected.has(option.id)} disabled={disabled} onClick={() => props.onToggle(option.id)}>
        {option.seatId ? props.seatName(option.seatId) : props.rulePrompt(option.code ?? option.id)}
      </button>;
  });
  const range = choice.min === choice.max ? String(choice.min) : `${choice.min}–${choice.max}`;
  return <>
    <h2>{props.rulePrompt(choice.code)}</h2>
    {choice.beneficiarySeatId && <p className="muted">{props.labels.abilityBy}: {props.seatName(choice.beneficiarySeatId)}{choice.sourceCardId ? ` · ${props.cardName(props.card(choice.sourceCardId))}` : ""}</p>}
    <div className="cards choices">{options}</div>
    <div className="action-row">
      <span id="selection-count" className="muted">{props.labels.selection}: {selected.size} · {props.labels.chooseRange}: {range}</span>
      <button id="confirm-action" type="button" className="primary" disabled={props.locked || selected.size < choice.min || selected.size > choice.max} onClick={props.onConfirm}>{props.labels.confirm}</button>
    </div>
  </>;
}

/** Projection-only action surface. It never constructs or sends a rule action. */
export function ActionTrayView(props: ActionTrayViewProps) {
  const game = props.game;
  if (!game) return null;
  if (game.phase === "adjudication") return <><h2>{props.labels.paused}</h2><p>{props.rulePrompt(game.issue ?? "ADJUDICATION_REQUIRED")}</p><p className="muted">{props.labels.pausedHelp}</p></>;
  if (game.phase === "ended") return <><h2>{props.labels.ended}</h2><p>{props.labels.winners}: {game.winners.map(props.seatName).join(props.language === "zh" ? "、" : ", ")}</p></>;
  if (props.action?.kind === "choose") return <ChoiceTray choice={props.action.choice} props={props} />;
  if (props.action) return <h2>{props.action.kind === "ante" ? props.labels.anteInstruction : props.labels.flightInstruction}</h2>;
  if (props.own?.committedAnte) return <p>{props.labels.ownAnte}: {props.cardName(props.own.committedAnte)} · {props.own.committedAnte.strength}</p>;
  return null;
}

export interface ActionTrayMount { render(props: ActionTrayViewProps): void; destroy(): void }

export function mountActionTray(host: HTMLElement): ActionTrayMount {
  let destroyed = false;
  const root: Root = createRoot(host);
  host.dataset.uiRenderer = "react";
  return {
    render(props) {
      if (!destroyed) flushSync(() => root.render(<ActionTrayView {...props} />));
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      root.unmount();
      delete host.dataset.uiRenderer;
    },
  };
}
