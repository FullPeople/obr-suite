/** @jsxImportSource react */
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import type { ResolutionStep } from "../rules/types";

export interface ResolutionStackLabels {
  title: string;
  current: string;
  queued: string;
  hint: string;
  actor: string;
  target: string;
  source: string;
  gold: string;
  you: string;
}

export interface ResolutionStackViewProps {
  stack: readonly ResolutionStep[];
  ownSeatId: string | null;
  language: "zh" | "en";
  labels: ResolutionStackLabels;
  seatName(id: string): string;
  cardName(id: string): string;
  stepName(step: ResolutionStep): string;
}

function seatLabel(id: string, props: ResolutionStackViewProps): string {
  return id === props.ownSeatId ? props.labels.you : props.seatName(id);
}

/**
 * React presentation island for the resolution queue.
 *
 * The component owns markup only. Rules, permissions, action receipts and
 * transport stay in ui.ts, which makes this a safe first migration seam from
 * the legacy imperative surface to the eventual React shell.
 */
export function ResolutionStackView(props: ResolutionStackViewProps) {
  const { stack, labels } = props;
  if (!stack.length) return null;
  const focus = stack.find(step => step.status === "active") ?? stack[0];
  const meta = (step: ResolutionStep): string[] => {
    const values: string[] = [];
    if (step.seatId) {
      const actor = seatLabel(step.seatId, props);
      if (actor) values.push(`${labels.actor}: ${actor}`);
    }
    if (step.targetSeatId) {
      const target = seatLabel(step.targetSeatId, props);
      if (target) values.push(`${labels.target}: ${target}`);
    }
    if (step.sourceCardId) values.push(`${labels.source}: ${props.cardName(step.sourceCardId)}`);
    if (step.amount !== undefined) values.push(`${step.amount} ${labels.gold}`);
    return values;
  };
  return <>
    <div className="resolution-heading">
      <h2>{labels.title} · {stack.length}</h2>
      <span className="muted">{focus.status === "active" ? labels.current : labels.queued}</span>
    </div>
    <p className="muted">{labels.hint}</p>
    <ol className="resolution-list" aria-label={labels.title}>
      {stack.map((step, index) => {
        const values = meta(step);
        return <li
          key={`${step.id}:${step.status}:${index}`}
          className="resolution-step"
          data-status={step.status}
          data-kind={step.kind}
          data-source-card={step.sourceCardId ?? undefined}
          data-target-seat={step.targetSeatId ?? undefined}
          aria-current={step.status === "active" ? "step" : undefined}
          role="listitem"
        >
          <span className="step-index">{index + 1}</span>
          <span className="step-state">{step.status === "active" ? labels.current : labels.queued}</span>
          <strong className="step-title">{props.stepName(step)}</strong>
          {values.length ? <span className="step-meta">{values.join(" · ")}</span> : null}
        </li>;
      })}
    </ol>
  </>;
}

export interface ResolutionStackMount {
  render(props: ResolutionStackViewProps): void;
  destroy(): void;
}

/** Mount a small React island into an existing legacy host. */
export function mountResolutionStack(host: HTMLElement): ResolutionStackMount {
  let destroyed = false;
  const root: Root = createRoot(host);
  host.dataset.uiRenderer = "react";
  return {
    render(props) {
      if (destroyed) return;
      flushSync(() => root.render(<ResolutionStackView {...props} />));
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      root.unmount();
      delete host.dataset.uiRenderer;
    },
  };
}
