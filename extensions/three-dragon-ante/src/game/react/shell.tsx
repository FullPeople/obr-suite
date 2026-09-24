/** @jsxImportSource react */
import { createRoot, type Root } from "react-dom/client";
import { createPortal, flushSync } from "react-dom";
import { TableBannerView, TurnIndicatorView, type TableBannerMount, type TableBannerViewProps, type TurnIndicatorMount, type TurnIndicatorViewProps } from "./table-status";
import { TableSetupView, type TableSetupMount, type TableSetupViewProps } from "./table-setup";
import { TableToolbarView, type TableToolbarMount, type TableToolbarViewProps } from "./table-toolbar";
import { InfoDrawerView, type InfoDrawerMount, type InfoDrawerViewProps } from "./info-drawer";
import { ActionTrayView, type ActionTrayMount, type ActionTrayViewProps } from "./action-tray";
import { HandRailView, type HandRailMount, type HandRailViewProps } from "./hand-rail";
import { TableEditorView, type TableEditorMount, type TableEditorViewProps } from "./table-editor";

export interface TableReactShellHosts {
  tableBanner: HTMLElement;
  turnIndicator: HTMLElement;
  tableSetup: HTMLElement;
  tableToolbar: HTMLElement;
  infoDrawer: HTMLElement;
  actionTray: HTMLElement;
  handRail: HTMLElement;
  tableEditor: HTMLElement;
}

interface ShellState {
  tableBanner?: TableBannerViewProps;
  turnIndicator?: TurnIndicatorViewProps;
  tableSetup?: TableSetupViewProps;
  tableToolbar?: TableToolbarViewProps;
  infoDrawer?: InfoDrawerViewProps;
  actionTray?: ActionTrayViewProps;
  handRail?: HandRailViewProps;
  tableEditor?: TableEditorViewProps;
}

interface ShellViewProps {
  state: ShellState;
  hosts: TableReactShellHosts;
}

/**
 * One React tree owns the presentation islands while portals preserve the
 * existing stable DOM hosts. The canvas, legacy sections and command wiring
 * remain outside this tree by design; the shell is presentation-only.
 */
function TableReactShellView({ state, hosts }: ShellViewProps) {
  return <>
    {state.tableBanner ? createPortal(<TableBannerView {...state.tableBanner} />, hosts.tableBanner, "table-banner") : null}
    {state.turnIndicator ? createPortal(<TurnIndicatorView {...state.turnIndicator} />, hosts.turnIndicator, "turn-indicator") : null}
    {state.tableSetup ? createPortal(<TableSetupView {...state.tableSetup} />, hosts.tableSetup, "table-setup") : null}
    {state.tableToolbar ? createPortal(<TableToolbarView {...state.tableToolbar} />, hosts.tableToolbar, "table-toolbar") : null}
    {state.infoDrawer ? createPortal(<InfoDrawerView {...state.infoDrawer} />, hosts.infoDrawer, "info-drawer") : null}
    {state.actionTray ? createPortal(<ActionTrayView {...state.actionTray} />, hosts.actionTray, "action-tray") : null}
    {state.handRail ? createPortal(<HandRailView {...state.handRail} />, hosts.handRail, "hand-rail") : null}
    {state.tableEditor ? createPortal(<TableEditorView {...state.tableEditor} />, hosts.tableEditor, "table-editor") : null}
  </>;
}

export interface TableReactShellMount {
  tableBanner: TableBannerMount;
  turnIndicator: TurnIndicatorMount;
  tableSetup: TableSetupMount;
  tableToolbar: TableToolbarMount;
  infoDrawer: InfoDrawerMount;
  actionTray: ActionTrayMount;
  handRail: HandRailMount;
  tableEditor: TableEditorMount;
  begin(): void;
  end(): void;
  destroy(): void;
}

type SurfaceProps =
  | TableBannerViewProps
  | TurnIndicatorViewProps
  | TableSetupViewProps
  | TableToolbarViewProps
  | InfoDrawerViewProps
  | ActionTrayViewProps
  | HandRailViewProps
  | TableEditorViewProps;

/** Mount one batched React shell into the imperative table surface. */
export function mountTableReactShell(parent: HTMLElement, hosts: TableReactShellHosts): TableReactShellMount {
  let destroyed = false;
  let batchDepth = 0;
  let dirty = false;
  const state: ShellState = {};
  const container = document.createElement("div");
  container.hidden = true;
  container.dataset.reactShell = "true";
  parent.append(container);
  const root: Root = createRoot(container);
  const hostValues = Object.values(hosts);
  for (const host of hostValues) host.dataset.uiRenderer = "react";

  function syncHost(key: keyof ShellState, value: SurfaceProps) {
    if (key === "tableEditor") {
      const props = value as unknown as TableEditorViewProps;
      hosts.tableEditor.hidden = !props.visible;
      if (props.visible) hosts.tableEditor.dataset.seats = String(props.seats.length);
      return;
    }
    if (key === "infoDrawer") {
      const props = value as InfoDrawerViewProps;
      const host = hosts.infoDrawer;
      const card = props.value;
      const content = card ? `${card.id}:${props.language}:${props.pinned}` : "";
      if (content !== host.dataset.content) host.scrollTop = 0;
      host.dataset.content = content;
      host.hidden = !card;
      if (card) {
        host.dataset.pinned = String(props.pinned);
        host.dataset.color = card.color ?? card.alignment;
      } else {
        delete host.dataset.pinned;
        delete host.dataset.color;
      }
    }
  }

  function commit() {
    if (destroyed || batchDepth > 0) {
      dirty = true;
      return;
    }
    dirty = false;
    // The imperative UI surface exposes a synchronous update contract. Keep
    // that contract while still letting React own the full tree and portals.
    flushSync(() => root.render(<TableReactShellView state={state} hosts={hosts} />));
  }

  function surface<Props extends SurfaceProps>(key: keyof ShellState): { render(props: Props): void; destroy(): void } {
    return {
      render(props) {
        if (destroyed) return;
        (state as unknown as Record<string, SurfaceProps | undefined>)[key] = props;
        syncHost(key, props);
        commit();
      },
      // Individual surface destruction is intentionally a no-op. The shell
      // owns one React lifecycle and is destroyed once by the table UI.
      destroy() {},
    };
  }

  return {
    tableBanner: surface<TableBannerViewProps>("tableBanner"),
    turnIndicator: surface<TurnIndicatorViewProps>("turnIndicator"),
    tableSetup: surface<TableSetupViewProps>("tableSetup"),
    tableToolbar: surface<TableToolbarViewProps>("tableToolbar"),
    infoDrawer: surface<InfoDrawerViewProps>("infoDrawer"),
    actionTray: surface<ActionTrayViewProps>("actionTray"),
    handRail: surface<HandRailViewProps>("handRail"),
    tableEditor: surface<TableEditorViewProps>("tableEditor"),
    begin() {
      if (destroyed) return;
      batchDepth += 1;
    },
    end() {
      if (destroyed || batchDepth === 0) return;
      batchDepth -= 1;
      if (batchDepth === 0 && dirty) {
        commit();
      }
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      batchDepth = 0;
      dirty = false;
      root.unmount();
      container.remove();
      for (const host of hostValues) delete host.dataset.uiRenderer;
      delete hosts.infoDrawer.dataset.content;
      delete hosts.infoDrawer.dataset.pinned;
      delete hosts.infoDrawer.dataset.color;
    },
  };
}
