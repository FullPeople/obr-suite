/** @jsxImportSource react */
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import type { PublicHistoryEntry } from "../rules/types";

export interface ReplayLensLabels {
  title: string;
  readOnly: string;
  unchanged: string;
  activeSeat: string;
  waiting: string;
  acting: string;
  queued: string;
  stakes: string;
  hole: string;
  deck: string;
  gambit: string;
  round: string;
  publicCards: string;
  noFrame: string;
}

export interface ReplayLensViewProps {
  entry: PublicHistoryEntry | null;
  labels: ReplayLensLabels;
  seatName(id: string): string;
  eventText(entry: PublicHistoryEntry): string;
  cardName(id: string): string;
}

function publicCards(ids: readonly string[], cardName: (id: string) => string): string {
  return ids.map(id => cardName(id)).join(" · ");
}

/**
 * A non-interactive visual lens for the local replay cursor. The stage and
 * live projection remain untouched; this surface only makes the selected
 * public frame visible without asking the user to parse the drawer.
 */
export function ReplayLensView(props: ReplayLensViewProps) {
  const entry = props.entry;
  if (!entry) return null;
  const frame = entry.frame;
  const active = frame?.activeSeatId ? props.seatName(frame.activeSeatId) : "";
  const waiting = frame?.waitingSeatIds.map(id => props.seatName(id)).filter(Boolean).join("、") ?? "";
  return <aside className="replay-lens" data-replay-lens="true" data-replay-sequence={entry.sequence} aria-label={props.labels.title}>
    <div className="replay-lens-heading">
      <strong>{props.labels.title} · #{entry.sequence}</strong>
      <span>{props.labels.readOnly}</span>
    </div>
    <p className="replay-lens-event">{props.eventText(entry)}</p>
    <p className="replay-lens-boundary">{props.labels.unchanged}</p>
    {frame ? <>
      <div className="replay-lens-stats">
        <span>{props.labels.gambit} {frame.gambit}</span><span>{props.labels.round} {frame.round}</span>
        <span>{props.labels.stakes} {frame.stakes}</span><span>{props.labels.hole} {frame.hole}</span><span>{props.labels.deck} {frame.deckCount}</span>
      </div>
      <div className="replay-lens-turn">
        <span>{props.labels.activeSeat}: {active || props.labels.queued}</span>
        {waiting ? <span>{props.labels.waiting}: {waiting}</span> : null}
      </div>
      <ul className="replay-lens-seats" aria-label={props.labels.activeSeat}>
        {frame.seats.map(seat => {
          const state = seat.id === frame.activeSeatId ? "acting" : frame.waitingSeatIds.includes(seat.id) ? "waiting" : "queued";
          return <li key={seat.id} data-state={state}>
            <strong>{seat.name}</strong><span>{state === "acting" ? props.labels.acting : state === "waiting" ? props.labels.waiting : props.labels.queued}</span>
          </li>;
        })}
      </ul>
      {(frame.ante.length || frame.revealed.length) ? <p className="replay-lens-cards">{props.labels.publicCards}: {publicCards([...frame.ante, ...frame.revealed], props.cardName)}</p> : null}
    </> : <p className="replay-lens-no-frame">{props.labels.noFrame}</p>}
  </aside>;
}

export interface ReplayLensMount {
  render(props: ReplayLensViewProps): void;
  destroy(): void;
}

export function mountReplayLens(host: HTMLElement): ReplayLensMount {
  let destroyed = false;
  const root: Root = createRoot(host);
  host.dataset.uiRenderer = "react";
  return {
    render(props) {
      if (destroyed) return;
      if (props.entry) {
        host.dataset.replayLens = "true";
        host.dataset.replaySequence = String(props.entry.sequence);
      } else {
        delete host.dataset.replayLens;
        delete host.dataset.replaySequence;
      }
      flushSync(() => root.render(<ReplayLensView {...props} />));
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      root.unmount();
      delete host.dataset.replayLens;
      delete host.dataset.replaySequence;
      delete host.dataset.uiRenderer;
    },
  };
}
