import { loadSettings, saveSettings } from '../shared/messages';
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings, type SourceLanguage } from '../shared/settings';
import { nativeAPIs, type Availability, type NativeDetector, type NativeTranslator } from '../providers/native-types';
import { element, errorText, message, populateLanguages, readiness } from './common';
import { AutomaticControls, onChoice, setChoice } from './automatic';

let settings: Settings = { ...DEFAULT_SETTINGS, siteRules: {} };
let engine: Availability = 'unavailable';
let preparing: AbortController | undefined;
let probeEpoch = 0;
const source = element<HTMLSelectElement>('source');
const font = element<HTMLSelectElement>('font-size');
const state = element('engine-state');
const prepare = element<HTMLButtonElement>('prepare');
const automatic = new AutomaticControls(() => settings, () => engine === 'available', update);

async function refreshEngine(): Promise<void> {
  const epoch = ++probeEpoch;
  const result = await readiness(settings.sourceLanguage).catch(() => 'unavailable' as const);
  if (epoch !== probeEpoch) return;
  engine = result; state.classList.toggle('error', result === 'unavailable');
  state.textContent = result === 'available' ? '语言包已就绪' : result === 'unavailable' ? '当前浏览器或语言暂不支持' : result === 'downloading' ? '语言包下载中' : '首次使用需下载语言包';
  prepare.textContent = result === 'available' ? '检查语言包' : '下载语言包'; prepare.disabled = result === 'unavailable';
}
async function refreshPermissions(): Promise<void> {
  const all = await chrome.permissions.contains({ origins: ['https://*/*'] });
  element('permission-state').textContent = !settings.autoTranslateAllPages
    ? '仅在你单独允许的网站自动翻译。可在网页上的插件弹窗中添加。'
    : all ? '已允许访问网站。打开网页后会按自动翻译设置处理。' : '尚未获得所有网站的访问权限，请重新选择“是”并允许。';
}
function renderRules(): void {
  const entries = Object.entries(settings.siteRules); const section = element('rules-section'); section.hidden = entries.length === 0;
  const list = element('site-rules'); list.replaceChildren();
  for (const [origin, rule] of entries) {
    const row = document.createElement('div'); row.className = 'rule-item';
    const name = document.createElement('span'); name.className = 'rule-name'; name.textContent = origin;
    const label = document.createElement('small'); label.textContent = rule === 'never' ? '不自动翻译' : rule === 'always' ? '允许自动翻译' : '跟随全局'; name.append(label);
    const remove = document.createElement('button'); remove.className = 'button secondary small'; remove.textContent = '移除'; remove.setAttribute('aria-label', `移除 ${origin}`);
    remove.addEventListener('click', () => { const siteRules = { ...settings.siteRules }; delete siteRules[origin]; void update({ siteRules }).catch(error => message(errorText(error), true)); });
    row.append(name, remove); list.append(row);
  }
}
async function update(patch: Partial<Settings>): Promise<void> {
  settings = await saveSettings(patch); automatic.render(); renderRules(); await refreshPermissions();
}
prepare.addEventListener('click', () => {
  const apis = nativeAPIs(); if (!apis.translator || !apis.detector) return;
  preparing?.abort(); preparing = new AbortController(); const controller = preparing;
  const progress = element<HTMLProgressElement>('progress'); progress.hidden = false; progress.value = 0;
  element('cancel-prepare').hidden = false; prepare.disabled = true; source.disabled = true;
  state.classList.remove('error'); state.textContent = '正在下载语言包，请保持页面打开…';
  let translating: NativeTranslator | undefined; let detecting: NativeDetector | undefined;
  const translation = apis.translator.create({ sourceLanguage: settings.sourceLanguage, targetLanguage: 'zh', signal: controller.signal, monitor: m => m.addEventListener('downloadprogress', e => { progress.value = Math.max(progress.value, e.loaded * 0.9); }) });
  const detection = apis.detector.create({ signal: controller.signal });
  void (async () => {
    const [first, second] = await Promise.allSettled([translation, detection]);
    if (first.status === 'fulfilled') translating = first.value; if (second.status === 'fulfilled') detecting = second.value;
    if (first.status === 'rejected') throw first.reason; if (second.status === 'rejected') throw second.reason;
    controller.signal.throwIfAborted();
    const samples: Record<SourceLanguage, string> = { en: 'Read the world, one page at a time.', fr: 'Découvrez le monde, une page à la fois.', es: 'Descubre el mundo, una página a la vez.', de: 'Entdecke die Welt, eine Seite nach der anderen.', ja: '一ページずつ、世界を読みましょう。', ko: '한 페이지씩 세상을 읽어 보세요.' };
    const result = await translating!.translate(samples[settings.sourceLanguage], { signal: controller.signal });
    if (!result.trim()) throw new Error('empty_translation'); progress.value = 1; message(`语言包可用。试译：${result}`);
  })().catch(error => message(errorText(error), true)).finally(() => {
    translating?.destroy(); detecting?.destroy(); prepare.disabled = false; source.disabled = false;
    progress.hidden = true; element('cancel-prepare').hidden = true; if (preparing === controller) preparing = undefined; void refreshEngine();
  });
});
element('cancel-prepare').addEventListener('click', () => preparing?.abort());
source.addEventListener('change', () => { void update({ sourceLanguage: source.value as SourceLanguage }).then(refreshEngine).catch(error => message(errorText(error), true)); });
onChoice('selection', enabled => { void update({ selectionLookup: enabled }).catch(error => message(errorText(error), true)); });
font.addEventListener('change', () => { void update({ minimumTranslationFontPx: Number(font.value) as 12 | 14 | 16 }).catch(error => message(errorText(error), true)); });
element('clear-cache').addEventListener('click', () => {
  void chrome.runtime.sendMessage({ type: 'PR_CLEAR_CACHE' }).then(() => message('已清除翻译缓存。')).catch(error => message(errorText(error), true));
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings?.newValue) return;
  const previousSource = settings.sourceLanguage;
  settings = sanitizeSettings(changes.settings.newValue); automatic.render(); renderRules(); setChoice('selection', settings.selectionLookup); font.value = String(settings.minimumTranslationFontPx); source.value = settings.sourceLanguage;
  if (previousSource !== settings.sourceLanguage) void refreshEngine();
  void refreshPermissions();
});
window.addEventListener('pagehide', () => preparing?.abort());
void (async () => {
  settings = await loadSettings(); automatic.render(); setChoice('selection', settings.selectionLookup); font.value = String(settings.minimumTranslationFontPx);
  await populateLanguages(source, settings.sourceLanguage); renderRules(); await Promise.all([refreshEngine(), refreshPermissions()]);
})().catch(error => message(errorText(error), true));
