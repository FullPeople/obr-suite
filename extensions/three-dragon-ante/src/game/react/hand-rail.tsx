/** @jsxImportSource react */
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import type { Card } from "../rules/cards";
import type { EligibleAction, HandPowerHint } from "../rules/types";
import { cardFaceURL } from "../card-images";
import { powerEffectTheme } from "../power-effects";

export interface HandRailLabels {
  title: string;
  inspectHint: string;
  powerReadyLegend: string;
  powerReadyShort: string;
  powerPlayableShort: string;
  inspect: string;
}

export interface HandRailViewProps {
  hand: readonly Card[];
  action: EligibleAction | undefined;
  selectedIds: readonly string[];
  hints: readonly HandPowerHint[];
  labels: HandRailLabels;
  cardName(value: Card): string;
  cardHint(value: Card): string;
  powerText(hint: HandPowerHint): string;
  onToggle(id: string): void;
  onInspect(cardId: string, pinned: boolean): void;
  onLeaveInspect(cardId: string): void;
  onHover(cardId: string | null): void;
}

function HandCard({ value, optionId, selected, hint, props }: {
  value: Card;
  optionId?: string;
  selected: boolean;
  hint?: HandPowerHint;
  props: HandRailViewProps;
}) {
  const name = props.cardName(value);
  const hintText = hint ? props.powerText(hint) : "";
  const label = `${name} · ${value.strength} · ${props.cardHint(value)}${hintText ? ` · ${hintText}` : ""}`;
  const actionable = optionId !== undefined;
  const powerReady = hint?.state === "power-ready";
  const theme = powerReady ? powerEffectTheme(value.family) : undefined;
  const sigil = theme?.shape === "ember" ? "△" : theme?.shape === "tide" ? "◌" : theme?.shape === "grove" ? "❧" : theme?.shape === "arcane" ? "◇" : theme?.shape === "crown" ? "♕" : "";
  return <div className="card-wrap" data-color={value.color ?? value.alignment}
    data-power-state={hint?.state} data-power-ready={powerReady ? "true" : undefined} data-power-reason={hint?.reason} data-power-trigger={hint ? String(hint.ruleTriggers) : undefined}
    data-power-theme={theme?.key} data-power-shape={theme?.shape}
    onPointerEnter={() => props.onHover(value.id)}
    onPointerLeave={() => { props.onHover(null); props.onLeaveInspect(value.id); }}
    onFocus={() => { props.onHover(value.id); props.onInspect(value.id, false); }}
    onBlur={() => { props.onHover(null); props.onLeaveInspect(value.id); }}
  >
    <button
      className="card printed-card"
      type="button"
      data-card={value.id}
      data-power-state={hint?.state}
      data-power-trigger={hint ? String(hint.ruleTriggers) : undefined}
      {...(actionable ? { "data-option": optionId } : {})}
      aria-pressed={actionable ? selected : undefined}
      aria-label={label}
      title={hintText}
      onClick={() => actionable ? props.onToggle(optionId!) : props.onInspect(value.id, true)}
      onPointerEnter={event => { if (event.pointerType !== "touch") props.onInspect(value.id, false); }}
      onMouseEnter={() => props.onInspect(value.id, false)}
      onPointerLeave={() => props.onLeaveInspect(value.id)}
      onMouseLeave={() => props.onLeaveInspect(value.id)}
    >
      <img className="printed-card-face" src={cardFaceURL(value.id)} alt="" draggable={false} width="768" height="1357" />
    </button>
    <button className="inspect-card" type="button" aria-label={`${props.labels.inspect}: ${name}`} title={props.labels.inspect}
      onClick={() => props.onInspect(value.id, true)}>i</button>
    {powerReady && <span className="power-ready-runes" aria-hidden="true"><i /><i /><i /></span>}
    {sigil && <span className="power-sigil" aria-hidden="true">{sigil}</span>}
    {powerReady && <span className="power-badge" aria-hidden="true" title={hintText}><i />{props.labels.powerReadyShort}</span>}
    {hint?.state === "playable-no-power" && <span className="power-badge power-badge--playable" aria-hidden="true" title={hintText}>{props.labels.powerPlayableShort}</span>}
  </div>;
}

/** Private hand rail. The host owns the projection and action callbacks. */
export function HandRailView(props: HandRailViewProps) {
  const selected = new Set(props.selectedIds);
  const ready = props.hints.some(hint => hint.state === "power-ready");
  return <>
    <div className="hand-heading">
      <h2>{props.labels.title} · {props.hand.length}</h2>
      <span className="muted">{ready ? `${props.labels.inspectHint} · ${props.labels.powerReadyLegend}` : props.labels.inspectHint}</span>
    </div>
    <div className="cards">
      {props.hand.map(value => {
        const optionId = props.action && props.action.kind !== "choose" && props.action.cardIds.includes(value.id) ? value.id : undefined;
        return <HandCard key={value.id} value={value} optionId={optionId} selected={!!optionId && selected.has(optionId)}
          hint={props.hints.find(hint => hint.cardId === value.id)} props={props} />;
      })}
    </div>
  </>;
}

export interface HandRailMount { render(props: HandRailViewProps): void; destroy(): void }

export function mountHandRail(host: HTMLElement): HandRailMount {
  let destroyed = false;
  const root: Root = createRoot(host);
  host.dataset.uiRenderer = "react";
  return {
    render(props) {
      if (!destroyed) flushSync(() => root.render(<HandRailView {...props} />));
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      root.unmount();
      delete host.dataset.uiRenderer;
    },
  };
}
