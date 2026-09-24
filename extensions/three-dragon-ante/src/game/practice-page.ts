import type { TutorialHandle } from './tutorial';
import './style.css';
import './stage-ui.css';
import './practice-page.css';

const home = document.getElementById('practice-home')!;
const parent = document.getElementById('practice-table')!;
const status = document.getElementById('practice-status')!;
const buttons = [...home.querySelectorAll<HTMLButtonElement>('button[data-lesson]')];
let handle: TutorialHandle | undefined;
let loading = false;
let disposed = false;

// This entry never imports the room page, starts a dealer, or contacts Owlbear.
async function openPractice(button: HTMLButtonElement) {
  if (loading || handle || disposed) return;
  loading = true;
  buttons.forEach(value => { value.disabled = true; });
  status.textContent = '正在准备牌桌…';
  try {
    const { mountTutorial } = await import('./tutorial');
    if (disposed) return;
    home.hidden = true;
    handle = mountTutorial(parent, 'zh', () => {
      handle = undefined;
      home.hidden = false;
      button.focus();
    }, { initialLessonId: button.dataset.lesson, closeLabel: ['返回体验说明', 'Back to preview'] });
    status.textContent = '';
  } catch {
    handle?.destroy();
    handle = undefined;
    home.hidden = false;
    status.textContent = '牌桌未能加载，请检查网络后重试。';
  } finally {
    loading = false;
    buttons.forEach(value => { value.disabled = false; });
  }
}

buttons.forEach(button => button.addEventListener('click', () => { void openPractice(button); }));
window.addEventListener('pagehide', event => {
  if (event.persisted) { handle?.suspend(); return; }
  disposed = true;
  handle?.destroy();
  handle = undefined;
});
window.addEventListener('pageshow', event => { if (event.persisted) handle?.resume(); });
