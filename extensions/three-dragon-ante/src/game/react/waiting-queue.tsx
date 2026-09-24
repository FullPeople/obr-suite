/** @jsxImportSource react */
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import type { PublicView } from "../rules/types";

export interface WaitingQueueLabels {
  title: string;
  waiting: string;
  acting: string;
  committed: string;
  queued: string;
  antePhase: string;
  playPhase: string;
  choicePhase: string;
  waitingCount: string;
  completeCount: string;
  currentActor: string;
  choiceWaiting: string;
  you: string;
}

export interface WaitingQueueViewProps {
  game: PublicView | null;
  ownSeatId: string | null;
  labels: WaitingQueueLabels;
}

type QueueState = "waiting" | "acting" | "committed" | "queued";

function phaseLabel(game: PublicView, labels: WaitingQueueLabels): string {
  if (game.phase === "ante") return labels.antePhase;
  if (game.phase === "choice") return labels.choicePhase;
  return labels.playPhase;
}

function stateFor(game: PublicView, seatId: string): QueueState {
  if (game.phase === "ante") return game.waitingSeatIds.includes(seatId) ? "waiting" : "committed";
  if (game.activeSeatId === seatId) return "acting";
  return "queued";
}

function stateLabel(state: QueueState, labels: WaitingQueueLabels): string {
  if (state === "waiting") return labels.waiting;
  if (state === "acting") return labels.acting;
  if (state === "committed") return labels.committed;
  return labels.queued;
}

/**
 * Public orchestration only. This is deliberately separate from the private
 * action tray and from the resolution stack: it answers “who is still
 * blocking the table?” without exposing a hand, choice option, or Task.
 */
export function WaitingQueueView(props: WaitingQueueViewProps) {
  const game = props.game;
  if (!game || !["ante", "play", "choice"].includes(game.phase)) return null;
  const waiting = game.waitingSeatIds.length;
  const completed = game.phase === "ante" ? game.seats.filter(seat => seat.committed).length : Math.max(0, game.seats.length - (game.activeSeatId ? 1 : 0));
  const actor = game.activeSeatId ? game.seats.find(seat => seat.id === game.activeSeatId) : undefined;
  const actorName = actor ? actor.id === props.ownSeatId ? `${actor.name} · ${props.labels.you}` : actor.name : "";
  const summary = game.phase === "ante"
    ? `${props.labels.waitingCount} ${waiting} · ${props.labels.completeCount} ${completed}/${game.seats.length}`
    : game.phase === "choice"
      ? `${props.labels.choiceWaiting}${actorName ? ` · ${actorName}` : ""}`
      : `${props.labels.currentActor}: ${actorName || props.labels.queued}`;
  return <section className="waiting-queue" data-waiting-queue="true" data-phase={game.phase} aria-label={props.labels.title}>
    <div className="waiting-queue-heading">
      <h2>{props.labels.title} · {game.seats.length}</h2>
      <span className="waiting-queue-phase">{phaseLabel(game, props.labels)}</span>
    </div>
    <p className="waiting-queue-summary" aria-live="polite">{summary}</p>
    <ol className="waiting-queue-list" aria-label={props.labels.title}>
      {game.seats.map((seat, index) => {
        const state = stateFor(game, seat.id);
        const own = seat.id === props.ownSeatId;
        return <li key={seat.id} className="waiting-queue-item" data-seat={seat.id} data-state={state} aria-current={state === "acting" ? "step" : undefined}>
          <span className="waiting-queue-index">{index + 1}</span>
          <strong>{seat.name}{own ? ` · ${props.labels.you}` : ""}</strong>
          <span>{stateLabel(state, props.labels)}</span>
        </li>;
      })}
    </ol>
  </section>;
}

export interface WaitingQueueMount {
  render(props: WaitingQueueViewProps): void;
  destroy(): void;
}

export function mountWaitingQueue(host: HTMLElement): WaitingQueueMount {
  let destroyed = false;
  const root: Root = createRoot(host);
  host.dataset.uiRenderer = "react";
  return {
    render(props) {
      if (destroyed) return;
      const visible = !!props.game && ["ante", "play", "choice"].includes(props.game.phase);
      host.hidden = !visible;
      if (visible) host.dataset.phase = props.game!.phase;
      else delete host.dataset.phase;
      flushSync(() => root.render(<WaitingQueueView {...props} />));
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      root.unmount();
      host.hidden = true;
      delete host.dataset.phase;
      delete host.dataset.uiRenderer;
    },
  };
}
