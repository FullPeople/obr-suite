import OBR from '@owlbear-rodeo/sdk';
import { parseEvent, DISPLAY_ID } from './protocol';
import { renderEffect } from './renderer';
const root = document.getElementById('effect')!;
let payload: any; try { payload = JSON.parse(decodeURIComponent(location.hash.slice(1))); } catch { payload = undefined; }
const event = parseEvent(payload);
if (event && payload.modalId === `${DISPLAY_ID}/${event.id}` && event.expiresAt > Date.now()) {
  const close = () => { root.replaceChildren(); OBR.onReady(() => { void OBR.modal.close(payload.modalId).catch(() => {}); }); };
  const presentation = renderEffect(root, event.config, { startsAt: event.startsAt, reduced: payload.reduced === true, onComplete: close });
  const timer = setTimeout(close, Math.max(0, event.expiresAt - Date.now()));
  window.addEventListener('pagehide', () => { clearTimeout(timer); presentation.dispose(); }, { once: true });
}
