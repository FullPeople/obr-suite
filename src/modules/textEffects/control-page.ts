import OBR from '@owlbear-rodeo/sdk';
import { DEFAULT_CONFIG, PRESETS, parseConfig, duration, hasContent, type TextEffectConfig } from './model';
import { REQUEST, STATUS, identifier } from './protocol';
import { renderEffect } from './renderer';
import './control.css';

const STORAGE = 'com.obr-suite/text-effects/editor/v1';
const root = document.getElementById('app')!;
const choices = (values: [string, string][]) => values.map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
const select = (name: string, label: string, values: [string, string][]) => `<label>${label}<select name="${name}" aria-label="${label}">${choices(values)}</select></label>`;
const range = (name: string, label: string, min: number, max: number, step = 1) => `<label>${label}<span class="te-range"><input type="range" name="${name}" min="${min}" max="${max}" step="${step}"><output data-value="${name}"></output></span></label>`;
const color = (name: string, label: string) => `<label class="te-color-label">${label}<input type="color" name="${name}"></label>`;
root.innerHTML = `<main class="te-editor">
  <header class="te-editor-head"><div><h1>文字演出</h1><p>配置文字和效果，预览后直接在枭熊中播放。</p></div><button type="button" id="close">返回工作区</button></header>
  <div class="te-template-bar"><label>演出预设<select id="presets" aria-label="演出预设"></select></label><button type="button" id="apply">应用预设</button><input id="preset-name" aria-label="预设名称" placeholder="我的预设名称" maxlength="48"><button type="button" id="save-preset">保存预设</button><button type="button" id="delete-preset">删除预设</button></div>
  <div class="te-editor-grid"><form id="settings">
    <fieldset><legend>文字</legend><label>标题<textarea name="title" rows="2" maxlength="160" placeholder="例如：战斗开始"></textarea></label><label>副标题<input name="subtitle" maxlength="240" placeholder="可留空"></label><label>正文<textarea name="body" rows="4" maxlength="1800" placeholder="旁白、场景描述或多行文字，可留空"></textarea></label></fieldset>
    <fieldset><legend>文字样式</legend><div class="te-two">${select('font', '字体', [['serif', '宋体 / 衬线'], ['sans', '黑体 / 无衬线'], ['mono', '等宽']])}${select('align', '文字对齐', [['center', '居中'], ['left', '靠左'], ['right', '靠右']])}${color('color', '文字颜色')}${color('accent', '效果颜色')}${color('outlineColor', '描边颜色')}${select('position', '显示位置', [['center', '画面中央'], ['top', '画面上方'], ['bottom', '画面下方']])}</div>${range('size', '标题大小', 2, 14, 0.5)}${range('spacing', '字间距', 0, 20)}${range('outline', '描边粗细', 0, 4, 0.5)}${range('glow', '发光范围', 0, 60)}</fieldset>
    <fieldset><legend>动画与效果</legend><div class="te-two">${select('motion', '文字入场', [['fade', '淡入'], ['rise', '向上浮现'], ['left', '从左滑入'], ['right', '从右滑入'], ['zoom', '缩放显现'], ['typewriter', '逐字出现']])}${select('decoration', '画面效果', [['none', '无'], ['rays', '光芒'], ['mist', '雾气'], ['sparks', '光点'], ['rings', '光环']])}</div><div class="te-three"><label>入场（秒）<input type="number" name="enter" min="0" max="3" step="0.1"></label><label>停留（秒）<input type="number" name="hold" min="0.5" max="20" step="0.1"></label><label>退场（秒）<input type="number" name="exit" min="0" max="3" step="0.1"></label></div></fieldset>
    <fieldset><legend>背景</legend><div class="te-two">${select('background', '背景样式', [['transparent', '透明'], ['band', '横幅'], ['dim', '暗幕'], ['solid', '纯色']])}${color('backgroundColor', '背景颜色')}</div>${range('opacity', '背景不透明度', 0, 1, 0.05)}</fieldset>
  </form><aside class="te-preview-column"><div class="te-preview-head"><strong>画面预览</strong><span id="duration"></span></div><div id="preview" class="te-preview" aria-label="文字演出预览"></div><div class="te-preview-tools"><button type="button" id="preview-play">播放预览</button><button type="button" id="preview-stop">停止预览</button><label><input id="reduced" type="checkbox">简化动态效果</label></div><p class="te-preview-note">预览和保存预设只影响自己。房间播放由 DM 发起。</p><div class="te-publish"><button type="button" id="owlbear-preview" disabled>在枭熊中预览</button><button type="button" id="room-play" class="te-primary" disabled>播放到房间</button><button type="button" id="room-stop" disabled>停止本次演出</button></div><p id="status" role="status" aria-live="polite">正在连接枭熊，可先调整配置并播放预览。</p><p id="error" role="alert" hidden></p></aside></div>
</main>`;
const form = document.getElementById('settings') as HTMLFormElement, preview = document.getElementById('preview')!;
const status = document.getElementById('status')!, error = document.getElementById('error')!;
const button = (id: string) => document.getElementById(id) as HTMLButtonElement;
const reduced = document.getElementById('reduced') as HTMLInputElement;
const presetSelect = document.getElementById('presets') as HTMLSelectElement, presetName = document.getElementById('preset-name') as HTMLInputElement;
let config = structuredClone(DEFAULT_CONFIG), saved: { name: string; config: TextEffectConfig }[] = [];
let connected = false, sceneReady = false, role = '', busy = false, connection = '';
let presentation: ReturnType<typeof renderEffect> | undefined, stopTarget: { id: string; preview: boolean; expiresAt: number } | undefined;
const pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
function showError(message = '') { error.textContent = message; error.hidden = !message; }
try {
  const stored = JSON.parse(localStorage.getItem(STORAGE) || 'null');
  config = parseConfig(stored?.draft) || config;
  if (Array.isArray(stored?.presets)) for (const preset of stored.presets.slice(0, 20)) {
    const parsed = parseConfig(preset?.config);
    if (parsed && typeof preset.name === 'string' && preset.name.trim() && preset.name.length <= 48) saved.push({ name: preset.name, config: parsed });
  }
} catch { showError('已保存的预设未能读取，本次配置仍可使用。'); }
function persist() { try { localStorage.setItem(STORAGE, JSON.stringify({ draft: config, presets: saved })); return true; } catch { showError('浏览器未能保存配置；本次预览和播放仍可使用。'); return false; } }
function listPresets(selected = 'builtin:0') {
  presetSelect.replaceChildren();
  for (const [list, prefix] of [[PRESETS, 'builtin'], [saved, 'saved']] as const) for (const [i, preset] of list.entries()) {
    const option = document.createElement('option'); option.value = `${prefix}:${i}`; option.textContent = prefix === 'saved' ? `我的预设 · ${preset.name}` : preset.name; presetSelect.append(option);
  }
  presetSelect.value = selected; button('delete-preset').disabled = !selected.startsWith('saved:');
}
function controls() {
  for (const key of Object.keys(DEFAULT_CONFIG) as (keyof TextEffectConfig)[]) {
    const input = form.elements.namedItem(key) as HTMLInputElement | null;
    if (input) input.value = String(['enter', 'hold', 'exit'].includes(key) ? Number(config[key]) / 1000 : config[key]);
  }
  updateOutputs();
}
function updateOutputs() {
  for (const output of form.querySelectorAll<HTMLOutputElement>('output')) {
    const key = output.dataset.value as keyof TextEffectConfig;
    output.textContent = key === 'opacity' ? `${Math.round(config.opacity * 100)}%` : key === 'size' ? `${config.size}%` : String(config[key]);
  }
  document.getElementById('duration')!.textContent = `总时长 ${(duration(config) / 1000).toFixed(1)} 秒`;
}
function draw(playing = false) {
  presentation?.dispose();
  presentation = renderEffect(preview, config, { startsAt: playing ? Date.now() : undefined, reduced: reduced.checked, onComplete: () => draw() });
  const pages = Number(preview.dataset.pages || 1);
  document.getElementById('duration')!.textContent = `总时长 ${(duration(config) / 1000).toFixed(1)} 秒${pages > 1 ? ` · 正文 ${pages} 页` : ''}`;
  button('preview-stop').disabled = !playing;
}
function availability() {
  button('owlbear-preview').disabled = busy || !connected || !sceneReady;
  button('room-play').disabled = busy || !connected || !sceneReady || role !== 'GM';
  button('room-stop').disabled = busy || !connected || !sceneReady || !stopTarget || stopTarget.expiresAt <= Date.now() || !stopTarget.preview && role !== 'GM';
}
form.addEventListener('submit', event => event.preventDefault());
form.addEventListener('input', () => {
  const values: Record<string, unknown> = { version: 1 };
  for (const [key, value] of new FormData(form)) values[key] = typeof DEFAULT_CONFIG[key as keyof TextEffectConfig] === 'number' ? ['enter', 'hold', 'exit'].includes(key) ? Math.round(Number(value) * 1000) : Number(value) : value;
  const parsed = parseConfig(values);
  if (!parsed || !form.checkValidity()) { showError('请检查文字长度和动画时长。'); return; }
  showError(); config = parsed; persist(); updateOutputs(); draw();
});
button('preview-play').onclick = () => { if (!hasContent(config)) { showError('请填写文字或选择视觉效果。'); return; } showError(); draw(true); };
button('preview-stop').onclick = () => draw(); reduced.onchange = () => draw();
presetSelect.onchange = () => { button('delete-preset').disabled = !presetSelect.value.startsWith('saved:'); };
button('apply').onclick = () => {
  const [kind, index] = presetSelect.value.split(':'), preset = (kind === 'saved' ? saved : PRESETS)[Number(index)];
  if (!preset) return; config = structuredClone(preset.config); presetName.value = kind === 'saved' ? preset.name : ''; controls(); draw(); showError(); persist(); status.textContent = `已应用“${preset.name}”。`;
};
button('save-preset').onclick = () => {
  const name = presetName.value.trim(); if (!name) { showError('请先填写预设名称。'); presetName.focus(); return; }
  const index = saved.findIndex(p => p.name === name);
  if (index < 0 && saved.length >= 20) { showError('最多保存 20 个预设，请先删除一个。'); return; }
  const next = { name, config: structuredClone(config) }; if (index >= 0) saved[index] = next; else saved.push(next);
  showError(); if (persist()) status.textContent = `已保存“${name}”。`; listPresets(`saved:${index >= 0 ? index : saved.length - 1}`);
};
button('delete-preset').onclick = () => {
  if (!presetSelect.value.startsWith('saved:')) return;
  const index = Number(presetSelect.value.split(':')[1]), preset = saved[index]; if (!preset) return;
  if (!confirm(`删除预设“${preset.name}”？`)) return; saved.splice(index, 1); listPresets(); persist(); status.textContent = '预设已删除。';
};
function receive(value: any) {
  const waiting = pending.get(value?.requestId); if (!waiting) return;
  clearTimeout(waiting.timer); pending.delete(value.requestId);
  value.ok === true && identifier(value.id) ? waiting.resolve(value) : waiting.reject(Error(typeof value.message === 'string' ? value.message : '文字演出未能播放'));
}
async function submit(action: 'play' | 'stop', previewOnly: boolean) {
  if (busy || !connected || !sceneReady || !previewOnly && role !== 'GM') return;
  if (action === 'play' && (!form.checkValidity() || !hasContent(config))) { showError('请检查配置，并填写文字或选择视觉效果。'); return; }
  if (action === 'stop' && !stopTarget) return;
  busy = true; availability(); showError();
  const requestId = crypto.randomUUID(), data = { requestId, action, preview: previewOnly, ...(action === 'play' ? { config: structuredClone(config) } : { id: stopTarget!.id }) };
  try {
    const result = await new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(requestId); reject(Error('播放结果尚未确认，请检查枭熊画面。')); }, 12000);
      pending.set(requestId, { resolve, reject, timer });
      void OBR.broadcast.sendMessage(REQUEST, data, { destination: 'LOCAL' }).then(reply => { const answer = reply as unknown; if (answer) receive(answer); }).catch(reject);
    });
    if (action === 'play') { stopTarget = { id: result.id, preview: result.preview, expiresAt: result.expiresAt }; status.textContent = previewOnly ? '正在自己的枭熊画面中预览。' : '已向当前房间播放文字演出。'; }
    else { stopTarget = undefined; status.textContent = '已停止本次演出。'; }
  } catch (e) { const waiting = pending.get(requestId); if (waiting) { clearTimeout(waiting.timer); pending.delete(requestId); } showError(e instanceof Error ? e.message : '文字演出未能播放'); }
  finally { busy = false; availability(); }
}
button('owlbear-preview').onclick = () => void submit('play', true);
button('room-play').onclick = () => void submit('play', false);
button('room-stop').onclick = () => void submit('stop', stopTarget?.preview ?? true);
button('close').onclick = () => { void OBR.popover.close('com.obr-suite/text-effects/control').catch(() => {}); };
listPresets(); controls(); draw();
OBR.onReady(async () => {
  try {
    [connection, role, sceneReady] = await Promise.all([OBR.player.getConnectionId(), OBR.player.getRole(), OBR.scene.isReady()]);
    connected = true;
    OBR.broadcast.onMessage(STATUS, event => { if (event.connectionId === connection) receive(event.data); });
    OBR.player.onChange(player => { role = player.role; availability(); });
    OBR.scene.onReadyChange(next => { sceneReady = next; stopTarget = undefined; availability(); status.textContent = next ? role === 'GM' ? '已连接枭熊，可以预览或向房间播放。' : '已连接枭熊，可以在自己的画面中预览。' : '场景已关闭，配置和本地预览仍可使用。'; });
    status.textContent = sceneReady ? role === 'GM' ? '已连接枭熊，可以预览或向房间播放。' : '已连接枭熊，可以在自己的画面中预览。' : '请打开枭熊场景；配置和本地预览仍可使用。';
    availability();
  } catch { showError('枭熊连接未能建立，配置和本地预览仍可使用。'); }
});
const expiryTimer = setInterval(availability, 1000);
window.addEventListener('pagehide', () => { clearInterval(expiryTimer); presentation?.dispose(); for (const value of pending.values()) { clearTimeout(value.timer); value.reject(Error('配置面板已关闭')); } pending.clear(); }, { once: true });
