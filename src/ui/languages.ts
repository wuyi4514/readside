import { apiLanguage, LANGUAGES, type Provider, type SourceLanguage } from '../shared/settings';
import { nativeAPIs } from '../providers/native-types';
import { ProductSelect } from './select';

const epochs = new WeakMap<ProductSelect, number>();
export async function populateLanguages(select: ProductSelect, selected: SourceLanguage[], target: SourceLanguage = 'zh-CN', provider: Provider = 'chrome-local'): Promise<void> {
  const epoch = (epochs.get(select) ?? 0) + 1; epochs.set(select, epoch);
  select.setOptions(LANGUAGES.map(l => ({ value: l.code, label: l.label, detail: l.native })));
  select.setValues(selected);
  if (provider !== 'chrome-local') return;
  const api = nativeAPIs().translator; if (!api) return;
  const options = await Promise.all(LANGUAGES.map(async l => {
    const unsupported = l.code !== target && await api.availability({ sourceLanguage: apiLanguage(l.code), targetLanguage: apiLanguage(target) }).then(s => s === 'unavailable').catch(() => false);
    return { value: l.code, label: l.label, detail: unsupported ? '当前浏览器暂不支持' : l.native, disabled: unsupported };
  }));
  if (epochs.get(select) === epoch) select.setOptions(options);
}
