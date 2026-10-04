import OBR from '@owlbear-rodeo/sdk';
import { WORKBENCH_DEV } from './workbench/channel';
import { renderPlayerPermissionGuide } from './announcement-important';
import { afterVisiblePaint } from './announcement-lifecycle';

// Like release acknowledgments, this is a per-browser, channel-scoped preference.
// It is deliberately independent of release versions and daily exposure stamps.
export const PLAYER_PERMISSION_SEEN_KEY = WORKBENCH_DEV
  ? 'obr-suite/workbench/player-permissions-seen'
  : 'obr-suite/player-permissions-seen';
export const PLAYER_PERMISSION_MODAL_ID = WORKBENCH_DEV
  ? 'com.obr-suite/workbench-player-permissions'
  : 'com.obr-suite/player-permissions';

export function hasReadPlayerPermissions(): boolean {
  try { return localStorage.getItem(PLAYER_PERMISSION_SEEN_KEY) === '1'; }
  catch { return false; }
}

export function markPlayerPermissionsRead(): void {
  localStorage.setItem(PLAYER_PERMISSION_SEEN_KEY, '1');
}

/** A close, failed open, visible paint or scroll alone never marks this read. */
export function mountPlayerPermissionNotice(initialLanguage: 'zh' | 'en', acknowledge: () => Promise<unknown> = async () => { markPlayerPermissionsRead(); }): void {
  const body = document.getElementById('body')!;
  const button = document.getElementById('btn-close') as HTMLButtonElement;
  const credit = document.getElementById('credit')!;
  let language = initialLanguage, alive = true, gm = false, painted = false;
  let roleRevision = 0, saving = false, cancelPaint = () => {};
  const title = document.querySelector<HTMLElement>('.head .title')!;
  const subtitle = document.querySelector<HTMLElement>('.head .sub')!;
  document.body.classList.add('player-permission-notice');
  body.setAttribute('tabindex', '0');
  body.setAttribute('aria-label', '玩家分配卡和权限说明');
  credit.setAttribute('role', 'status');
  button.disabled = true;

  const atBottom = () => body.clientHeight > 0
    && body.scrollHeight - body.clientHeight - body.scrollTop <= 2;
  const imagesSettled = () => [...body.querySelectorAll('img')].every(image => image.complete);
  function canAcknowledge() {
    return alive && gm && painted && document.visibilityState !== 'hidden'
      && imagesSettled() && atBottom();
  }
  function updateGate() {
    button.disabled = saving || !canAcknowledge();
    if (!saving) credit.textContent = language === 'zh'
      ? '请阅读到底部，再点击「我真的知道了」。'
      : 'Read to the bottom, then explicitly acknowledge.';
  }
  const observer = new ResizeObserver(updateGate);
  observer.observe(body);
  function render(next: 'zh' | 'en') {
    language = next; painted = false; cancelPaint();
    title.textContent = next === 'zh' ? '关于玩家分配卡和权限' : 'Player cards and permissions';
    subtitle.textContent = next === 'zh' ? 'DM 重要说明' : 'Important guide for GMs';
    button.textContent = next === 'zh' ? '我真的知道了' : 'I really understand';
    document.getElementById('ann-lang-zh')?.classList.toggle('on', next === 'zh');
    document.getElementById('ann-lang-en')?.classList.toggle('on', next === 'en');
    observer.disconnect(); observer.observe(body);
    body.innerHTML = renderPlayerPermissionGuide(next);
    observer.observe(body.firstElementChild!);
    body.scrollTop = 0; updateGate();
    cancelPaint = afterVisiblePaint(() => { painted = true; updateGate(); });
  }
  body.addEventListener('scroll', updateGate, { passive: true });
  // Images can extend the guide after the first paint. Require their layout to
  // settle, then recheck the actual bottom on every resize and at click time.
  body.addEventListener('load', updateGate, true);
  body.addEventListener('error', updateGate, true);
  document.addEventListener('visibilitychange', updateGate);
  document.getElementById('ann-lang-zh')?.addEventListener('click', () => render('zh'));
  document.getElementById('ann-lang-en')?.addEventListener('click', () => render('en'));

  const offRole = OBR.player.onChange(player => {
    ++roleRevision; gm = player.role === 'GM'; updateGate();
  });
  function readRole() {
    const revision = ++roleRevision;
    void OBR.player.getRole().then(role => {
      if (!alive || revision !== roleRevision) return;
      gm = role === 'GM'; updateGate();
    }).catch(() => { /* Keep acknowledgment disabled when role cannot be verified. */ });
  }
  readRole();
  button.addEventListener('click', async () => {
    if (saving || !canAcknowledge()) return;
    saving = true; updateGate();
    const revision = roleRevision;
    try {
      const role = await OBR.player.getRole();
      if (role !== 'GM' || revision !== roleRevision || !canAcknowledge()) return;
      // Write only here, after rechecking the current role/layout. Storage
      // failures keep the notice open and its toolbar entry visible.
      await acknowledge();
      await OBR.modal.close(PLAYER_PERMISSION_MODAL_ID);
    } catch {
      credit.textContent = language === 'zh' ? '未能保存确认，请重试。' : 'Could not save acknowledgment. Please retry.';
    } finally { saving = false; button.disabled = !canAcknowledge(); }
  });
  window.addEventListener('pageshow', event => {
    if (!event.persisted || !alive) return;
    readRole();
    cancelPaint = afterVisiblePaint(() => { painted = true; updateGate(); });
  });
  window.addEventListener('pagehide', event => {
    ++roleRevision; cancelPaint(); painted = false; gm = false; updateGate();
    if (event.persisted) return;
    alive = false; observer.disconnect(); offRole();
    document.removeEventListener('visibilitychange', updateGate);
  });
  render(language);
}
