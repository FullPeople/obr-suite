/** @jsxImportSource react */
import { useState, type DragEvent } from "react";

export interface TableEditorCard { id: string; name: string; image: string; family: string; strength: number }
export interface TableEditorSeat {
  id: string;
  name: string;
  gold: number;
  debt: number;
  hand: readonly TableEditorCard[];
  ante: TableEditorCard | null;
  committed: boolean;
  isSelf: boolean;
  isLeader: boolean;
}

export interface TableEditorLabels {
  title: string;
  hint: string;
  gold: string;
  hand: string;
  ante: string;
  empty: string;
  deck: string;
  discard: string;
  stakes: string;
  hole: string;
  round: string;
  gambit: string;
  remove: string;
  removeHint: string;
  replace: string;
  replaceHint: string;
  search: string;
  searchPlaceholder: string;
  noResults: string;
  picked: string;
  clear: string;
  close: string;
  /** Right-click menu entries. */
  giveTo: string;
  addCard: string;
  amount: string;
}

export interface TableEditorViewProps {
  visible: boolean;
  language: "zh" | "en";
  seats: readonly TableEditorSeat[];
  /** Every card the editor may bring in: the deck, the discard pile and the
   *  cards the deck excluded. Host-local inspection data only. */
  pool: readonly TableEditorCard[];
  info: { deck: number; discard: number; stakes: number; hole: number; round: number; gambit: number };
  labels: TableEditorLabels;
  onSetGold(seatId: string, amount: number): void;
  onMoveCard(cardId: string, toSeatId: string | null): void;
  onReplace(cardId: string, withCardId: string): void;
  onClose(): void;
}

export interface TableEditorMount { render(props: TableEditorViewProps): void; destroy(): void }

const MAX_GOLD = 100000;

/** A left click is deliberately inert: the card is dragged, or acted on through
 *  its right-click menu. */
function CardFace({ card, onContext, picked }: { card: TableEditorCard; onContext(event: React.MouseEvent): void; picked: boolean }) {
  return (
    <button type="button" className="editor-card" data-card={card.id} aria-pressed={picked}
      draggable onDragStart={event => { event.dataTransfer.setData("text/plain", card.id); event.dataTransfer.effectAllowed = "move"; }}
      onContextMenu={onContext} title={`${card.name} · ${card.strength}`}>
      <img src={card.image} alt="" draggable={false} />
      <span>{card.name}</span>
    </button>
  );
}

/**
 * The host-side table editor. It is presentation only: every change travels as
 * an authoritative `edit` command and returns as a new projection, so the panel
 * never edits a local copy of the game.
 */
export function TableEditorView(props: TableEditorViewProps) {
  const [picked, setPicked] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [query, setQuery] = useState("");
  /** Right-click menu: which card, where, and whether its send submenu is open. */
  const [menu, setMenu] = useState<{ cardId: string; x: number; y: number; send: boolean } | null>(null);
  /** The seat whose "+" card is picking a card to add. */
  const [adding, setAdding] = useState<string | null>(null);
  const labels = props.labels;
  if (!props.visible) return null;
  const pickedCard = props.pool.find(card => card.id === picked) ?? props.seats.flatMap(seat => seat.hand).find(card => card.id === picked) ?? null;
  const needle = query.trim().toLowerCase();
  const picking = adding ? adding : picked && replacing ? picked : null;
  const candidates = picking ? props.pool.filter(card => card.id !== picking && (!needle || card.name.toLowerCase().includes(needle) || card.id.includes(needle))).slice(0, 60) : [];
  const drop = (event: DragEvent, toSeatId: string | null) => {
    const cardId = event.dataTransfer.getData("text/plain") || picked;
    if (!cardId) return;
    event.preventDefault();
    if (replacing && picked && cardId === picked) { setReplacing(false); return; }
    if (toSeatId === null || !replacing) props.onMoveCard(cardId, toSeatId);
    setPicked(null);
    setReplacing(false);
  };
  return (
    <section id="table-editor" className="table-editor" role="dialog" aria-label={labels.title}>
      <header className="editor-head">
        <h2>{labels.title}</h2>
        <p className="muted">{labels.hint}</p>
        <div className="editor-piles">{([["deck", labels.deck, props.info.deck], ["discard", labels.discard, props.info.discard], ["stakes", labels.stakes, props.info.stakes], ["hole", labels.hole, props.info.hole], ["round", labels.round, props.info.round], ["gambit", labels.gambit, props.info.gambit]] as [string, string, number][]).map(([key, label, value]) => <span key={key} className="editor-pile"><small>{label}</small><strong>{value}</strong></span>)}</div>
        <button id="table-editor-close" type="button" className="quiet" onClick={props.onClose}>{labels.close}</button>
      </header>
            <div className="editor-body">
        {props.seats.map(seat => (
          <article key={seat.id} className="editor-seat" data-seat={seat.id}
            onDragOver={event => { if (picked || event.dataTransfer.types.includes("text/plain")) event.preventDefault(); }}
            onDrop={event => drop(event, seat.id)}>
            <h3>{seat.name}{seat.isSelf ? " ★" : ""}{seat.isLeader ? ` · ${labels.gambit}` : ""}</h3>
            <p className="editor-gold">
              <span>{labels.gold}</span>
              <input key={seat.gold} type="number" min={0} max={MAX_GOLD} defaultValue={seat.gold} aria-label={`${seat.name} ${labels.amount}`}
                onKeyDown={event => { if (event.key === "Enter") (event.target as HTMLInputElement).blur(); }}
                onBlur={event => { const value = Math.max(0, Math.min(MAX_GOLD, Math.round(event.target.valueAsNumber))); if (Number.isFinite(value) && value !== seat.gold) props.onSetGold(seat.id, value); }} />
              {seat.debt ? <small>· {seat.debt}</small> : null}
            </p>
            <p className="editor-ante">{labels.ante}: {seat.ante ? <CardFace card={seat.ante} picked={false} onContext={event => { event.preventDefault(); setPicked(seat.ante!.id); setReplacing(true); }} /> : <em>{seat.committed ? "•" : labels.empty}</em>}</p>
            <div className="editor-hand" aria-label={`${seat.name} ${labels.hand}`}>
              {seat.hand.length ? seat.hand.map(card => (
                <CardFace key={card.id} card={card} picked={picked === card.id}
                  onContext={event => { event.preventDefault(); setPicked(null); setReplacing(false); setMenu({ cardId: card.id, x: event.clientX, y: event.clientY, send: false }); }} />
              )) : <em>{labels.empty}</em>}
              <button type="button" className="editor-card editor-add" data-add={seat.id}
                onClick={() => { setAdding(seat.id); setQuery(""); setPicked(null); setReplacing(false); }} title={labels.addCard}>＋</button>
            </div>
          </article>
        ))}
        <article className="editor-remove" id="table-editor-remove" onDragOver={event => event.preventDefault()} onDrop={event => drop(event, null)}
          onClick={() => { if (picked) { props.onMoveCard(picked, null); setPicked(null); } }}>
          <h3>{labels.remove}</h3>
          <p className="muted">{labels.removeHint}</p>
        </article>
      </div>
      {menu ? (
        <section className="editor-menu" role="menu" aria-label={labels.replace} style={{ left: menu.x, top: menu.y }}>
          <button type="button" role="menuitem" onClick={() => { setPicked(menu.cardId); setReplacing(true); setMenu(null); }}>{labels.replace}</button>
          <button type="button" role="menuitem" onClick={() => { props.onMoveCard(menu.cardId, null); setMenu(null); setPicked(null); }}>{labels.remove}</button>
          <button type="button" role="menuitem" onClick={() => setMenu({ ...menu, send: !menu.send })} aria-expanded={menu.send}>{labels.giveTo} ▸</button>
          {menu.send ? <div className="editor-submenu">{props.seats.filter(seat => !seat.hand.some(card => card.id === menu.cardId)).map(seat => (
            <button key={seat.id} type="button" role="menuitem" data-give={seat.id} onClick={() => { props.onMoveCard(menu.cardId, seat.id); setMenu(null); setPicked(null); }}>{seat.name}</button>
          ))}</div> : null}
          <button type="button" role="menuitem" className="quiet" onClick={() => setMenu(null)}>{labels.close}</button>
        </section>
      ) : null}
      {replacing || adding ? (
        <section className="editor-search" role="region" aria-label={labels.search}>
          <h3>{labels.search}</h3>
          <input id="table-editor-search" type="search" value={query} placeholder={labels.searchPlaceholder} onChange={event => setQuery(event.target.value)} autoFocus />
          <div className="editor-candidates">
            {candidates.length ? candidates.map(card => (
              <button key={card.id} type="button" className="editor-card" data-candidate={card.id} onClick={() => { if (adding) props.onMoveCard(card.id, adding); else if (picked) props.onReplace(picked, card.id); setPicked(null); setReplacing(false); setAdding(null); setQuery(""); }} title={`${card.name} · ${card.strength}`}>
                <img src={card.image} alt="" draggable={false} decoding="async" loading="lazy" /><span>{card.name}</span>
              </button>
            )) : <p className="muted">{labels.noResults}</p>}
          </div>
        </section>
      ) : null}
    </section>
  );
}
