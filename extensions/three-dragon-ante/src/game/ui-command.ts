import type { TableCommand } from "./protocol";

export type TableDisplayMode = "full" | "compact";
/** Ephemeral local reading/selection state. Never a rules action or a room value. */
export interface TableUIDraft {
  tableId: string;
  gameId: string;
  selectionKey: string;
  selected: string[];
  boardScroll: number;
  handScroll: number;
  open: string[];
}
export type TableUICommand = TableCommand | { type: "display"; mode: TableDisplayMode; draft?: TableUIDraft } |
  { type: "remember"; draft: TableUIDraft } | { type: "close"; draft?: TableUIDraft };
export const TABLE_UI_RESTORE = "com.fullpeople/three-dragon-ante/ui-restore";
export function readUIDraft(value: unknown): TableUIDraft | null {
  if (!value || typeof value !== "object") return null;
  const draft = value as TableUIDraft;
  if (![draft.tableId, draft.gameId, draft.selectionKey].every((text) => typeof text === "string" && text.length <= 200) ||
      !Array.isArray(draft.selected) || draft.selected.length > 100 || !draft.selected.every((id) => typeof id === "string" && id.length <= 100) ||
      !Array.isArray(draft.open) || draft.open.length > 3 || !draft.open.every((id) => ["discard", "log", "help"].includes(id)) ||
      ![draft.boardScroll, draft.handScroll].every((value) => Number.isFinite(value) && value >= 0 && value <= 100_000)) return null;
  const result = { tableId: draft.tableId, gameId: draft.gameId, selectionKey: draft.selectionKey,
    selected: [...new Set(draft.selected)], boardScroll: draft.boardScroll, handScroll: draft.handScroll, open: [...draft.open] };
  return new TextEncoder().encode(JSON.stringify(result)).length <= 6000 ? result : null;
}
