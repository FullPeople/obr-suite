// Local editor lifecycle only; this channel never carries image data.
export const WINDOW_QUERY = "circleSession";
export const WINDOW_CLOSE = "com.obr-suite/circleimage/window-close";
export const WINDOW_CLOSE_RESULT = "com.obr-suite/circleimage/window-close-result";
export function isWindowNonce(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value);
}

export function readWindowMessage(value: unknown): { windowNonce: string; requestId: string; status?: "error" } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const message = value as Record<string, unknown>;
  if (!isWindowNonce(message.windowNonce) || !isWindowNonce(message.requestId)) return;
  return { windowNonce: message.windowNonce, requestId: message.requestId, status: message.status === "error" ? "error" : undefined };
}
