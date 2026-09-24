/** @jsxImportSource react */
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { useEffect, useRef } from "react";

export interface TableBannerViewProps {
  /** Localized name of the current phase. It stays visible for the whole game,
   *  so the table always answers "what part of the round is this?". */
  phase: string;
  /** Changes with the phase as well, so the chip can flash once per change. */
  phaseKey: string;
  reducedMotion: boolean;
  waiting?: string;
  effect: string;
}

export interface TurnIndicatorViewProps {
  turnVisible: boolean;
  turnLabel: string;
  turnKey: string;
  reducedMotion: boolean;
  /** The live waiting line, shown beside the clockwise hint. */
  waiting?: string;
  /** Phase chip and finite event line, shown with the hint. */
  phase?: string;
  phaseKey?: string;
  effect?: string;
}

/** Projection-only banner island for waiting and public feedback. */
export function TableBannerView(props: TableBannerViewProps) {
  const hasBanner = !!props.phase || !!props.waiting || !!props.effect;
  const chip = useRef<HTMLParagraphElement>(null);
  // One finite flash per phase change. It never covers the table and never
  // blocks input, unlike a full-screen announcement would.
  useEffect(() => {
    if (!props.phaseKey || props.reducedMotion || !chip.current) return;
    const animation = chip.current.animate(
      [{ transform: "scale(1)", boxShadow: "0 0 0 0 #d9b26900" }, { transform: "scale(1.1)", boxShadow: "0 0 18px 3px #e0b96788" }, { transform: "scale(1)", boxShadow: "0 0 0 0 #d9b26900" }],
      { duration: 1100, easing: "cubic-bezier(.2,.75,.25,1)" },
    );
    return () => animation.cancel();
  }, [props.phaseKey, props.reducedMotion]);
  return <div id="table-banner" className="table-banner" data-waiting={props.waiting ? "true" : "false"} role="status" aria-live="polite" hidden={!hasBanner}>
    {props.phase ? <p id="banner-phase" className="banner-phase" ref={chip}>{props.phase}</p> : null}
    <p id="waiting-banner" className={props.waiting ? "banner-waiting" : undefined} hidden={!props.waiting}>{props.waiting}</p>
    <p id="effect-banner" hidden={!props.effect}>{props.effect}</p>
  </div>;
}

/** Projection-only turn island. It animates only when the authoritative key changes. */
export function TurnIndicatorView(props: TurnIndicatorViewProps) {
  const waitingText = props.waiting ?? "";
  const phase = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!props.phaseKey || props.reducedMotion || !phase.current) return;
    const animation = phase.current.animate(
      [{ transform: "scale(.86)", opacity: .55 }, { transform: "scale(1.08)", opacity: 1 }, { transform: "scale(1)", opacity: 1 }],
      { duration: 420, easing: "cubic-bezier(.2,.75,.25,1)" },
    );
    return () => animation.cancel();
  }, [props.phaseKey, props.reducedMotion]);
  const arrow = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!props.turnVisible || !props.turnKey || props.reducedMotion || !arrow.current) return;
    const animation = arrow.current.animate(
      [{ transform: "rotate(-20deg) scale(.82)", opacity: .55 }, { transform: "rotate(345deg) scale(1.08)", opacity: 1 }, { transform: "rotate(360deg) scale(1)", opacity: 1 }],
      { duration: 460, easing: "cubic-bezier(.2,.75,.25,1)" },
    );
    return () => animation.cancel();
  }, [props.turnKey, props.turnVisible, props.reducedMotion]);
  return <div id="turn-indicator" className="turn-indicator" role="status" aria-live="polite" hidden={!props.turnVisible && !waitingText} aria-label={[props.turnLabel, waitingText].filter(Boolean).join(" · ")}>
      <span id="turn-arrow" aria-hidden="true" ref={arrow}>↻</span>
      <span id="turn-direction">{props.turnLabel}</span>
      {props.phase ? <span id="turn-phase" ref={phase} className="turn-phase" data-phase-key={props.phaseKey ?? ""}>{props.phase}</span> : null}
      {waitingText ? <span id="turn-waiting">{waitingText}</span> : null}
      {props.effect ? <span id="turn-effect" className="turn-effect">{props.effect}</span> : null}
  </div>;
}

/** Combined view retained for isolated component previews. The page mounts the two roots separately so legacy layout remains exact. */
export function TableStatusView(props: TableBannerViewProps & TurnIndicatorViewProps) {
  return <><TableBannerView phase={props.phase} phaseKey={props.phaseKey} reducedMotion={props.reducedMotion} waiting={props.waiting} effect={props.effect} /><TurnIndicatorView turnVisible={props.turnVisible} turnLabel={props.turnLabel} turnKey={props.turnKey} phase={props.phase} phaseKey={props.phaseKey} waiting={props.waiting} effect={props.effect} reducedMotion={props.reducedMotion} /></>;
}

export interface TableBannerMount {
  render(props: TableBannerViewProps): void;
  destroy(): void;
}

export interface TurnIndicatorMount {
  render(props: TurnIndicatorViewProps): void;
  destroy(): void;
}

export function mountTableBanner(host: HTMLElement): TableBannerMount {
  let destroyed = false;
  const root: Root = createRoot(host);
  host.dataset.uiRenderer = "react";
  return {
    render(props) {
      if (!destroyed) flushSync(() => root.render(<TableBannerView {...props} />));
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      root.unmount();
      delete host.dataset.uiRenderer;
    },
  };
}

export function mountTurnIndicator(host: HTMLElement): TurnIndicatorMount {
  let destroyed = false;
  const root: Root = createRoot(host);
  host.dataset.uiRenderer = "react";
  return {
    render(props) {
      if (!destroyed) flushSync(() => root.render(<TurnIndicatorView {...props} />));
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      root.unmount();
      delete host.dataset.uiRenderer;
    },
  };
}
