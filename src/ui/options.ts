import { loadSettings, saveSettings } from '../shared/messages';
import type { Settings, SourceLanguage } from '../shared/settings';
import { nativeAPIs, type Availability, type NativeDetector, type NativeTranslator } from '../providers/native-types';
import { element, errorText, message, populateLanguages, readiness } from './common';

let settings: Settings;
let engine: Availability = 'unavailable';
let preparing: AbortController | undefined;
let probeEpoch = 0;
const source = element<HTMLSelectElement>('source');
const auto = element<HTMLInputElement>('auto');
const selection = element<HTMLInputElement>('selection');
const font = element<HTMLSelectElement>('font-size');
const state = element('engine-state');
const prepare = element<HTMLButtonElement>('prepare');

async function refreshEngine(): Promise<void> {
  const epoch = ++probeEpoch;
  const result = await readiness(settings.sourceLanguage).catch(() => 'unavailable' as const);
  if (epoch !== probeEpoch) return;
  engine = result;
  state.classList.toggle('error', result === 'unavailable');
  state.textContent = result === 'available' ? '本地翻译已就绪。之后打开授权网页，即可自动对照。' : result === 'unavailable' ? '此 Chrome 或当前语言方向暂不支持本地翻译。请检查版本与浏览器策略。' : result === 'downloading' ? '语言包正在准备。可点击下方按钮查看进度。' : '首次使用需要准备语言包，完成后无需逐页设置。';
  prepare.textContent = result === 'available' ? '重新检查翻译' : '准备本地翻译 ↓';
  prepare.disabled = result === 'unavailable';
}

async function refreshPermissions(): Promise<void> {
  const all = await chrome.permissions.contains({ origins: ['https://*/*'] });
  element('permission-state').textContent = all ? '已允许 HTTPS 网站。你可以随时在弹窗中关闭某个网站。' : '尚未允许所有网站。也可以在网页上的插件弹窗中仅授权当前网站。';
}

function renderRules(): void {
  const list = element('site-rules'); list.replaceChildren();
  const entries = Object.entries(settings.siteRules);
  if (!entries.length) { list.textContent = '暂无单独设置，网站跟随全局开关。'; return; }
  for (const [origin, rule] of entries) {
    const row = document.createElement('div'); row.className = 'rule-item';
    const name = document.createElement('span'); name.textContent = origin;
    const label = document.createElement('span'); label.textContent = rule === 'never' ? '不自动翻译' : rule === 'always' ? '始终翻译' : '跟随全局';
    row.append(name, label); list.append(row);
  }
}

async function update(patch: Partial<Settings>): Promise<void> {
  settings = await saveSettings(patch); auto.checked = settings.autoTranslate;
}

prepare.addEventListener('click', () => {
  const apis = nativeAPIs();
  if (!apis.translator || !apis.detector) return;
  preparing?.abort(); preparing = new AbortController();
  const controller = preparing;
  const progress = element<HTMLProgressElement>('progress');
  progress.hidden = false; progress.value = 0;
  element('cancel-prepare').hidden = false; prepare.disabled = true; source.disabled = true;
  state.classList.remove('error'); state.textContent = '正在准备本地翻译，请保持此页面打开…';
  let translating: NativeTranslator | undefined;
  let detecting: NativeDetector | undefined;
  // Both create() calls start in the actual click, before the first await.
  const translation = apis.translator.create({ sourceLanguage: settings.sourceLanguage, targetLanguage: 'zh', signal: controller.signal, monitor: m => m.addEventListener('downloadprogress', e => { progress.value = Math.max(progress.value, e.loaded * 0.9); }) });
  const detection = apis.detector.create({ signal: controller.signal });
  void (async () => {
    const results = await Promise.allSettled([translation, detection]);
    const first = results[0]; const second = results[1];
    if (first.status === 'fulfilled') translating = first.value;
    if (second.status === 'fulfilled') detecting = second.value;
    if (first.status === 'rejected') throw first.reason;
    if (second.status === 'rejected') throw second.reason;
    controller.signal.throwIfAborted();
    const samples: Record<SourceLanguage, string> = { en: 'Read the world, one page at a time.', fr: 'Découvrez le monde, une page à la fois.', es: 'Descubre el mundo, una página a la vez.', de: 'Entdecke die Welt, eine Seite nach der anderen.', ja: '一ページずつ、世界を読みましょう。', ko: '한 페이지씩 세상을 읽어 보세요.' };
    const result = await translating!.translate(samples[settings.sourceLanguage], { signal: controller.signal });
    if (!result.trim()) throw new Error('empty_translation');
    progress.value = 1; message(`准备完成。试译：${result}`);
  })().catch(error => { message(errorText(error), true); }).finally(() => {
    translating?.destroy(); detecting?.destroy();
    prepare.disabled = false; source.disabled = false; progress.hidden = true; element('cancel-prepare').hidden = true;
    if (preparing === controller) preparing = undefined;
    void refreshEngine();
  });
});
element('cancel-prepare').addEventListener('click', () => preparing?.abort());

element('enable-all').addEventListener('click', () => {
  if (engine !== 'available') { message('请先完成上方的本地翻译准备。', true); return; }
  // Request directly from the click so the browser receives a real user gesture.
  void chrome.permissions.request({ origins: ['https://*/*'] }).then(async granted => {
    if (!granted) { message('未获得网站权限。你仍可从弹窗主动翻译当前页。'); return; }
    await update({ autoTranslate: true }); await refreshPermissions(); message('已开启。现在打开英文网站试试。');
  }).catch(error => message(errorText(error), true));
});

auto.addEventListener('change', () => {
  if (auto.checked && engine !== 'available') { auto.checked = false; message('请先完成本地翻译准备。', true); return; }
  void update({ autoTranslate: auto.checked }).then(refreshPermissions).catch(error => message(errorText(error), true));
});
source.addEventListener('change', () => {
  void update({ sourceLanguage: source.value as SourceLanguage }).then(refreshEngine).catch(error => message(errorText(error), true));
});
selection.addEventListener('change', () => { void update({ selectionLookup: selection.checked }).catch(error => message(errorText(error), true)); });
font.addEventListener('change', () => { void update({ minimumTranslationFontPx: Number(font.value) as 12 | 14 | 16 }).catch(error => message(errorText(error), true)); });
element('clear-rules').addEventListener('click', () => { void update({ siteRules: {} }).then(renderRules).catch(error => message(errorText(error), true)); });
element('clear-cache').addEventListener('click', () => {
  void chrome.runtime.sendMessage({ type: 'PR_CLEAR_CACHE' }).then(() => message('已清除当前打开页面的翻译缓存。页面译文保持显示。')).catch(error => message(errorText(error), true));
});
window.addEventListener('pagehide', () => preparing?.abort());

void (async () => {
  settings = await loadSettings();
  auto.checked = settings.autoTranslate; selection.checked = settings.selectionLookup; font.value = String(settings.minimumTranslationFontPx);
  await populateLanguages(source, settings.sourceLanguage); renderRules();
  await Promise.all([refreshEngine(), refreshPermissions()]);
})().catch(error => message(errorText(error), true));
