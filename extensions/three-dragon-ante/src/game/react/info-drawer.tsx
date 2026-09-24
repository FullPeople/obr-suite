/** @jsxImportSource react */
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { cardFaceURL } from "../card-images";
import type { Card } from "../rules/cards";

export interface InfoDrawerViewProps {
  value: Card | null;
  language: "zh" | "en";
  pinned: boolean;
  closeLabel: string;
  cardName(value: Card): string;
  cardHint(value: Card): string;
  onClose(): void;
}

/**
 * Projection-only card information surface. The host owns visibility and
 * inspection eligibility; this island owns the readable card face and keeps
 * the eventual React shell independent from the legacy table layout.
 */
export function InfoDrawerView(props: InfoDrawerViewProps) {
  if (!props.value) return null;
  const value = props.value;
  const name = props.cardName(value);
  return <>
    <button id="close-preview" className="quiet" type="button" aria-label={props.closeLabel} onClick={props.onClose}>×</button>
    <div id="preview-content" data-content={`${value.id}:${props.language}:${props.pinned}`}>
      <img className="printed-card-face" src={cardFaceURL(value.id)} alt={name} draggable={false} width="768" height="1357" />
      <div className="preview-copy">
        <span className="preview-strength">{value.strength}</span>
        <h2>{name}</h2>
        <p className="preview-hint">{props.cardHint(value)}</p>
      </div>
    </div>
  </>;
}

export interface InfoDrawerMount {
  render(props: InfoDrawerViewProps): void;
  destroy(): void;
}

export function mountInfoDrawer(host: HTMLElement): InfoDrawerMount {
  let destroyed = false;
  let lastContent = "";
  const root: Root = createRoot(host);
  host.dataset.uiRenderer = "react";
  return {
    render(props) {
      if (destroyed) return;
      const value = props.value;
      const content = value ? `${value.id}:${props.language}:${props.pinned}` : "";
      if (content !== lastContent) host.scrollTop = 0;
      lastContent = content;
      host.hidden = !value;
      if (value) {
        host.dataset.pinned = String(props.pinned);
        host.dataset.color = value.color ?? value.alignment;
      } else {
        delete host.dataset.pinned;
        delete host.dataset.color;
      }
      flushSync(() => root.render(<InfoDrawerView {...props} />));
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      root.unmount();
      delete host.dataset.uiRenderer;
    },
  };
}
