/** @jsxImportSource react */
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { useEffect, useRef } from "react";
import type { Card } from "../rules/cards";
import type { OmniscientView, PublicHistoryEntry, PublicReplayFrame, PublicView, SeatView } from "../rules/types";

export interface HistoryPanelLabels {
  title: string;
  empty: string;
  cardLedgerHint: string;
  hand: string;
  ownAnte: string;
  ante: string;
  revealed: string;
  flight: string;
  discard: string;
  deck: string;
  hiddenCards: string;
  none: string;
  current: string;
  phaseChoice: string;
  gambit: string;
  round: string;
  revision: string;
  replayAt: string;
  replayReadOnly: string;
  activeSeat: string;
  rules: string;
  configuration: string;
  variantLocked: string;
  help: string;
  helpText: string;
  localPrivate: string;
  state: string;
  stakes: string;
  hole: string;
  deckCount: string;
  publicCards: string;
  strength: string;
  stack: string;
  noFrame: string;
  scrubber: string;
}

export interface HistoryPanelViewProps {
  game: PublicView | SeatView | OmniscientView | null;
  own: SeatView | null;
  /** Explicitly passed only while the authenticated host-local view is on. */
  omniscient: OmniscientView | null;
  language: "zh" | "en";
  tab: "events" | "cards" | "rules";
  variantSummary: string;
  replayGameId: string;
  replayIndex: number;
  labels: HistoryPanelLabels;
  eventText(entry: PublicHistoryEntry): string;
  cardName(id: string): string;
  cardHint(card: Card): string;
  seatName(id: string): string;
  onInspect(cardId: string): void;
  onReplayAt(index: number): void;
}

function LedgerGroup({ title, values, props, group }: { title: string; values: readonly Card[]; props: HistoryPanelViewProps; group: string }) {
  return <section className="ledger-group" data-ledger-group={group}>
    <h3>{title} · {values.length}</h3>
    {values.length ? <div className="ledger-cards">
      {values.map(value => <button
        key={value.id}
        type="button"
        className="ledger-card"
        data-card={value.id}
        data-color={value.color ?? value.alignment}
        title={props.cardHint(value)}
        aria-label={`${props.cardName(value.id)} · ${value.strength} · ${props.cardHint(value)}`}
        onClick={() => props.onInspect(value.id)}
      >{props.cardName(value.id)} · {value.strength}</button>)}
    </div> : <p className="muted">{props.labels.none}</p>}
  </section>;
}

function ReplayCardList({ title, ids, props, group }: { title: string; ids: readonly string[]; props: HistoryPanelViewProps; group: string }) {
  if (!ids.length) return null;
  return <div className="replay-frame-cards" data-replay-cards={group}>
    <span>{title} · {ids.length}</span>
    <div className="history-replay-cards">
      {ids.map((id, index) => <button key={`${id}:${index}`} type="button" className="replay-card" data-card={id} onClick={() => props.onInspect(id)}>{props.cardName(id)}</button>)}
    </div>
  </div>;
}

function ReplayFrame({ frame, props }: { frame: PublicReplayFrame; props: HistoryPanelViewProps }) {
  return <section className="replay-frame" data-replay-frame="true" aria-label={props.labels.state}>
    <h4>{props.labels.state}</h4>
    <p className="replay-frame-stats">{props.labels.stakes} {frame.stakes} · {props.labels.hole} {frame.hole} · {props.labels.deckCount} {frame.deckCount} · {props.labels.discard} {frame.discardCount}</p>
    <p className="replay-frame-actor">{props.labels.activeSeat}: {frame.activeSeatId ? props.seatName(frame.activeSeatId) : props.labels.none} · {frame.phase}</p>
    <ul className="replay-frame-seats" aria-label={props.labels.state}>
      {frame.seats.map(seat => <li key={seat.id}>
        <strong>{seat.name}</strong>
        <span>{seat.gold} · {props.labels.hand} {seat.handCount} · {props.labels.strength} {seat.strength}</span>
      </li>)}
    </ul>
    <div className="replay-frame-card-groups">
      <ReplayCardList title={props.labels.ante} ids={frame.ante} props={props} group="ante" />
      <ReplayCardList title={props.labels.revealed} ids={frame.revealed} props={props} group="revealed" />
      {frame.seats.map(seat => <ReplayCardList key={seat.id} title={`${seat.name} · ${props.labels.flight}`} ids={seat.flight.map(card => card.cardId)} props={props} group={`flight:${seat.id}`} />)}
      <ReplayCardList title={`${props.labels.discard} · ${frame.discardCount}`} ids={frame.discard} props={props} group="discard" />
    </div>
    {frame.choice ? <p className="replay-frame-stack">{props.labels.stack}: {props.labels.current} · {frame.choice.code}</p> : frame.resolutionStack.length ? <p className="replay-frame-stack">{props.labels.stack}: {frame.resolutionStack.map(step => step.code ?? step.kind).join(" → ")}</p> : null}
  </section>;
}

function HistoryEvents({ props }: { props: HistoryPanelViewProps }) {
  const game = props.game!;
  const entries = game.history ?? [];
  const replayEntry = props.replayGameId === game.id && props.replayIndex >= 0 ? entries[props.replayIndex] : undefined;
  const replayTargetRef = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!replayEntry || !replayTargetRef.current) return;
    replayTargetRef.current.scrollIntoView({ block: "nearest" });
  }, [replayEntry?.sequence]);
  if (!entries.length) return <p className="muted">{props.labels.empty}</p>;
  const scrubberIndex = Math.max(0, Math.min(entries.length - 1, props.replayIndex >= 0 ? props.replayIndex : entries.length - 1));
  return <ol className="history-list" aria-label={props.labels.title}>
    <li className="history-scrubber" data-history-scrubber="true">
      <label htmlFor="history-scrubber-input">{props.labels.scrubber}</label>
      <input id="history-scrubber-input" type="range" min="0" max={Math.max(0, entries.length - 1)} step="1" value={scrubberIndex}
        aria-valuetext={`#${entries[scrubberIndex]?.sequence ?? 0}`}
        onInput={event => props.onReplayAt(Number((event.currentTarget as HTMLInputElement).value))} />
      <output htmlFor="history-scrubber-input">{scrubberIndex + 1}/{entries.length}</output>
    </li>
    {replayEntry && <li className="history-replay-context" data-replay-context="true" aria-live="polite">
      <h3>{props.labels.replayAt} · #{replayEntry.sequence}</h3>
      <strong>{props.eventText(replayEntry)}</strong>
      <p>{props.labels.activeSeat}: {replayEntry.activeSeatId ? props.seatName(replayEntry.activeSeatId) : props.labels.none} · {replayEntry.phase}</p>
      {replayEntry.frame ? <ReplayFrame frame={replayEntry.frame} props={props} /> : <p className="muted" data-replay-frame-missing="true">{props.labels.noFrame}</p>}
      {replayEntry.event.cardIds?.length ? <div className="history-replay-cards">
        {replayEntry.event.cardIds.map(cardId => <button key={cardId} type="button" className="replay-card" data-card={cardId} onClick={() => props.onInspect(cardId)}>{props.cardName(cardId)}</button>)}
      </div> : null}
      <span className="muted">{props.labels.replayReadOnly}</span>
    </li>}
    {entries.map((entry, index) => {
      const current = props.replayGameId === game.id && props.replayIndex === index;
      return <li
        key={entry.sequence}
        className={`history-entry${current ? " replay-current" : ""}`}
        data-sequence={entry.sequence}
        data-phase={entry.phase}
        aria-current={current ? "step" : undefined}
        ref={current ? replayTargetRef : undefined}
      >
        <button type="button" className="history-entry-button" data-replay-sequence={entry.sequence}
          onClick={() => props.onReplayAt(index)}>
          <span className="history-entry-meta">#{entry.sequence} · {props.labels.gambit} {entry.gambit} · {props.labels.round} {entry.round || "—"} · {props.labels.revision} {entry.revision}</span>
          <span className="history-entry-body">
            <strong>{props.eventText(entry)}</strong>
            <span className="history-phase">{entry.phase === "choice" ? props.labels.phaseChoice : entry.phase}</span>
          </span>
        </button>
      </li>;
    })}
  </ol>;
}

function CardLedger({ props }: { props: HistoryPanelViewProps }) {
  const game = props.game!;
  const own = props.own;
  const publicAnteIds = new Set(game.ante.map(value => value.id));
  return <>
    <p className="muted">{props.labels.cardLedgerHint}</p>
    {own ? <>
      <LedgerGroup group="hand" title={props.labels.hand} values={own.hand} props={props} />
      <LedgerGroup group="own-ante" title={props.labels.ownAnte} values={own.committedAnte ? [own.committedAnte] : []} props={props} />
    </> : null}
    <LedgerGroup group="ante" title={props.labels.ante} values={game.ante} props={props} />
    <LedgerGroup group="revealed" title={props.labels.revealed} values={game.revealed} props={props} />
    {game.seats.map(seat => <LedgerGroup key={seat.id} group={`flight:${seat.id}`} title={`${seat.name} · ${props.labels.flight}`} values={seat.flight.map(item => item.card)} props={props} />)}
    {props.omniscient ? props.omniscient.seats.filter(seat => seat.id !== own?.selfSeatId).map(seat => {
      const hand = props.omniscient!.privateHands[seat.id] ?? [];
      const ante = props.omniscient!.privateCommittedAntes[seat.id];
      return <div key={seat.id} className="ledger-private-seat" data-ledger-private-seat={seat.id}>
        <LedgerGroup group={`host-hand:${seat.id}`} title={`${seat.name} · ${props.labels.hand} · ${props.labels.localPrivate}`} values={hand} props={props} />
        <LedgerGroup group={`host-ante:${seat.id}`} title={`${seat.name} · ${props.labels.ownAnte} · ${props.labels.localPrivate}`} values={ante && !publicAnteIds.has(ante.id) ? [ante] : []} props={props} />
      </div>;
    }) : null}
    <LedgerGroup group="discard" title={props.labels.discard} values={game.discard} props={props} />
    <p className="ledger-privacy">{props.labels.deck}: {game.deckCount} · {props.labels.hiddenCards}</p>
  </>;
}

function RulesPanel({ props }: { props: HistoryPanelViewProps }) {
  return <section id="history-rules" role="tabpanel" aria-labelledby="history-tab-rules" hidden={props.tab !== "rules"}>
    <div className="rules-overview">
      <h3>{props.labels.configuration}</h3>
      <p className="rules-variant" data-variant-summary="true">{props.variantSummary}</p>
      <p className="muted">{props.labels.variantLocked}</p>
      <h3>{props.labels.help}</h3>
      <p className="history-rules-copy">{props.labels.helpText}</p>
    </div>
  </section>;
}

/** React history content island; it is intentionally projection-only. */
export function HistoryPanelView(props: HistoryPanelViewProps) {
  if (!props.game) return null;
  return <>
    <section id="history-events" role="tabpanel" aria-labelledby="history-tab-events" hidden={props.tab !== "events"}>
      <HistoryEvents props={props} />
    </section>
    <section id="history-cards" role="tabpanel" aria-labelledby="history-tab-cards" hidden={props.tab !== "cards"}>
      <CardLedger props={props} />
    </section>
    <RulesPanel props={props} />
  </>;
}

export interface HistoryPanelMount {
  render(props: HistoryPanelViewProps): void;
  destroy(): void;
}

export function mountHistoryPanel(host: HTMLElement): HistoryPanelMount {
  let destroyed = false;
  const root: Root = createRoot(host);
  host.dataset.uiRenderer = "react";
  return {
    render(props) {
      if (destroyed) return;
      // Keep the root explicit so legacy controls can continue to address the
      // tab panels by stable IDs during this incremental migration.
      flushSync(() => root.render(<HistoryPanelView {...props} />));
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      root.unmount();
      delete host.dataset.uiRenderer;
    },
  };
}
