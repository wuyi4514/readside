import { loadSettings, saveSettings } from '../shared/messages';
import { DEFAULT_SETTINGS, LANGUAGES, sanitizeSettings, type Settings, type TargetLanguage, type SourceLanguage } from '../shared/settings';
import { ModelPacks } from './model-packs';
import { ProductSelect } from './select';
import { populateLanguages } from './languages';
import { element, errorText, message } from './common';
import { AutomaticControls, onChoice, setChoice } from './automatic';

let settings: Settings = { ...DEFAULT_SETTINGS, siteRules: {} };
let engineReady = false;
const source = new ProductSelect(element('source'), { label: '源语言', multiple: true, onChange: async values => {
  try { await update({ sourceLanguages: values as SourceLanguage[] }); await refreshLanguages(); }
  catch (error) { message(errorText(error), true); throw error; }
} });
const font = new ProductSelect(element('font-size'), { label: '译文最小字号', onChange: async values => {
  try { await update({ minimumTranslationFontPx: Number(values[0]) as 12 | 14 | 16 }); }
  catch (error) { message(errorText(error), true); throw error; }
} });
font.setOptions([12, 14, 16].map(size => ({ value: String(size), label: `${size} px` })));
const target = new ProductSelect(element('target'), { label: '目标语言', onChange: async values => {
  try { await update({ targetLanguage: values[0] as TargetLanguage }); await refreshLanguages(); }
  catch (error) { message(errorText(error), true); throw error; }
} });
target.setOptions([{ value: 'zh-CN', label: '简体中文' }, ...LANGUAGES.filter(l => l.code !== 'zh-CN').map(l => ({ value: l.code, label: l.label }))]);
const automatic = new AutomaticControls(() => settings, () => engineReady, update);
const packs = new ModelPacks(element('language-packs'), element('engine-state'), ready => { engineReady = ready; automatic.render(); });

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
onChoice('selection', enabled => { void update({ selectionLookup: enabled }).catch(error => message(errorText(error), true)); });
element('clear-cache').addEventListener('click', () => {
  void chrome.runtime.sendMessage({ type: 'PR_CLEAR_CACHE' }).then(() => message('已清除翻译缓存。')).catch(error => message(errorText(error), true));
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.settings?.newValue) return;
  const previousSource = settings.sourceLanguages.join(',') + '>' + settings.targetLanguage;
  settings = sanitizeSettings(changes.settings.newValue); automatic.render(); renderRules(); setChoice('selection', settings.selectionLookup); font.setValues([String(settings.minimumTranslationFontPx)]); source.setValues(settings.sourceLanguages); target.setValues([settings.targetLanguage]);
  if (previousSource !== settings.sourceLanguages.join(',') + '>' + settings.targetLanguage) void refreshLanguages();
  void refreshPermissions();
});
let languageEpoch = 0;
async function refreshLanguages(): Promise<void> {
  const epoch = ++languageEpoch; const snapshot = settings;
  target.setValues([snapshot.targetLanguage]); await populateLanguages(source, snapshot.sourceLanguages, snapshot.targetLanguage);
  if (epoch !== languageEpoch) return; await packs.setSources(snapshot.sourceLanguages, snapshot.targetLanguage);
}
void (async () => {
  settings = await loadSettings(); automatic.render(); setChoice('selection', settings.selectionLookup); font.setValues([String(settings.minimumTranslationFontPx)]);
  renderRules(); await Promise.all([refreshLanguages(), refreshPermissions()]);
})().catch(error => message(errorText(error), true));
