/** @jsxImportSource react */
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";

export interface TableToolbarTable {
  stage: "lobby" | "playing" | "ended";
  seats: readonly { playerId: string }[];
}

export interface TableToolbarLabels {
  create: string;
  join: string;
  leave: string;
  start: string;
  retry: string;
  retryAction: string;
  handover?:string;
}

export interface TableToolbarViewProps {
  table: TableToolbarTable | null | undefined;
  hasView: boolean;
  selfPlayerId: string | undefined;
  isHost: boolean;
  canHandover?:boolean;
  connected: boolean;
  message: string | undefined;
  localMessage: string;
  sending: boolean;
  retryable: boolean;
  createDisabled: boolean;
  joinDisabled: boolean;
  leaveDisabled: boolean;
  startDisabled: boolean;
  retryDisabled: boolean;
  labels: TableToolbarLabels;
  onCreate(): void;
  onJoin(): void;
  onLeave(): void;
  onHandover?():void;
  onStart(): void;
  onRetry(): void;
}

/** Projection-only command surface. It renders intent buttons; the page owns all guards and sends. */
export function TableToolbarView(props: TableToolbarViewProps) {
  const seated = !!props.table?.seats.some(seat => seat.playerId === props.selfPlayerId);
  const canRetry = !props.connected || !!props.message || !!props.localMessage || props.retryable;
  if (!props.table) return <>
    {props.hasView && <button type="button" onClick={props.onCreate} disabled={props.createDisabled} className="primary">{props.labels.create}</button>}
    {canRetry && <button type="button" onClick={props.onRetry} disabled={props.retryDisabled}>{props.retryable ? props.labels.retryAction : props.labels.retry}</button>}
  </>;
  return <>
    {!seated && props.table.stage !== "playing" && <button type="button" onClick={props.onJoin} disabled={props.joinDisabled} className="primary">{props.labels.join}</button>}
    {seated && props.table.stage !== "playing" && <button type="button" onClick={props.onLeave} disabled={props.leaveDisabled}>{props.labels.leave}</button>}
    {props.isHost&&props.canHandover&&props.onHandover&&<button type="button" onClick={props.onHandover} disabled={props.leaveDisabled}>{props.labels.handover}</button>}
    {props.isHost && props.table.stage === "lobby" && <button type="button" onClick={props.onStart} disabled={props.startDisabled} className="primary">{props.labels.start}</button>}
    {canRetry && <button type="button" onClick={props.onRetry} disabled={props.retryDisabled}>{props.retryable ? props.labels.retryAction : props.labels.retry}</button>}
  </>;
}

export interface TableToolbarMount {
  render(props: TableToolbarViewProps): void;
  destroy(): void;
}

export function mountTableToolbar(host: HTMLElement): TableToolbarMount {
  let destroyed = false;
  const root: Root = createRoot(host);
  host.dataset.uiRenderer = "react";
  return {
    render(props) {
      if (!destroyed) flushSync(() => root.render(<TableToolbarView {...props} />));
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      root.unmount();
      delete host.dataset.uiRenderer;
    },
  };
}
