import { diag } from "./diagnostics";

/** The LOCAL channel is addressed to this client, and both frames of the plugin
 *  filter messages by the connection id they read once at startup. Owlbear can
 *  re-issue that id (a reconnect, a wake from sleep, a room switch), and a cached
 *  value then silently drops *every* view and *every* command: the table freezes
 *  on its last snapshot and each action ends in "no result arrived", until the
 *  player presses reconnect. This guard re-reads the id on the first mismatch and
 *  accepts the following message, so the channel heals itself. */
export function createIdentity(initial: string, label: string, read?: () => Promise<string>) {
  let current = initial, reading: Promise<string> | null = null, mismatches = 0;
  const listeners: Array<(value: string) => void> = [];
  const refresh = (): Promise<string> => {
    if (!reading) {
      reading = Promise.resolve()
        .then(() => read ? read() : import("@owlbear-rodeo/sdk").then(module => module.default.player.getConnectionId()))
        .then(value => {
          if (typeof value === "string" && value.length && value !== current) {
            diag("conn", `${label} identity changed`, { from: current, to: value });
            current = value;
            for (const listener of listeners) listener(value);
          }
          return current;
        })
        .catch(error => { diag("conn", `${label} identity re-read failed`, { error: String(error) }); return current; })
        .finally(() => { reading = null; });
    }
    return reading;
  };
  return {
    get id(): string { return current; },
    set(value: string) { if (value && value !== current) { current = value; for (const listener of listeners) listener(value); } },
    onChange(listener: (value: string) => void) { listeners.push(listener); },
    /** True when the sender is this client. A mismatch is logged once per second
     *  and starts a re-read; the message itself is dropped so a stale identity
     *  can never be mistaken for a stranger. */
    /** Like `accepts`, but waits for a re-read: used where a dropped message
     *  would cost the player an action. */
    async matches(sender: string): Promise<boolean> {
      if (sender === current) { mismatches = 0; return true; }
      diag("conn", `${label} message from another connection`, { sender, cached: current });
      const value = await refresh();
      if (sender === value) { mismatches = 0; return true; }
      // LOCAL only ever reaches this client's own frames, so a sender that keeps
      // disagreeing with a freshly read id means the read itself is stale. Adopt
      // the sender rather than staying deaf for the rest of the session.
      if (++mismatches >= 3) {
        diag("conn", `${label} adopting the sender as this client`, { sender, previous: value });
        current = sender; mismatches = 0;
        for (const listener of listeners) listener(current);
        return true;
      }
      diag("conn", `${label} message rejected`, { sender, current: value, attempt: mismatches });
      return false;
    },
    accepts: (() => {
      const once = new Map<string, number>();
      return (sender: string): boolean => {
        if (sender === current) return true;
        const now = Date.now();
        if (now - (once.get("mismatch") ?? 0) > 1000) {
          once.set("mismatch", now);
          diag("conn", `${label} dropped a message from another connection`, { sender, cached: current, hint: "re-reading the connection id" });
        }
        void refresh();
        return false;
      };
    })(),
    refresh,
  };
}
export type Identity = ReturnType<typeof createIdentity>;
