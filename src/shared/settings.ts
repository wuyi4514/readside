export const LANGUAGES = [
  { code: 'en', label: '英语', native: 'English' },
  { code: 'fr', label: '法语', native: 'Français' },
  { code: 'es', label: '西班牙语', native: 'Español' },
  { code: 'de', label: '德语', native: 'Deutsch' },
  { code: 'ja', label: '日语', native: '日本語' },
  { code: 'ko', label: '韩语', native: '한국어' },
] as const;

export type SourceLanguage = (typeof LANGUAGES)[number]['code'];
export type SiteRule = 'follow-global' | 'always' | 'never';
export interface Settings {
  schemaVersion: 1;
  settingsVersion: number;
  autoTranslate: boolean;
  sourceLanguage: SourceLanguage;
  targetLanguage: 'zh-CN';
  provider: 'chrome-local';
  selectionLookup: boolean;
  translationScale: number;
  minimumTranslationFontPx: 12 | 14 | 16;
  siteRules: Record<string, SiteRule>;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  schemaVersion: 1, settingsVersion: 1, autoTranslate: false,
  sourceLanguage: 'en', targetLanguage: 'zh-CN', provider: 'chrome-local',
  selectionLookup: true, translationScale: 0.85, minimumTranslationFontPx: 12,
  siteRules: {},
});

export function validOrigin(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.origin : null;
  } catch { return null; }
}

export function sanitizeSettings(value: unknown): Settings {
  const v = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const siteRules: Record<string, SiteRule> = {};
  if (v.siteRules && typeof v.siteRules === 'object') {
    for (const [origin, rule] of Object.entries(v.siteRules)) {
      if (validOrigin(origin) === origin && ['follow-global', 'always', 'never'].includes(String(rule))) {
        siteRules[origin] = rule as SiteRule;
      }
    }
  }
  const schemaOk = v.schemaVersion === undefined || v.schemaVersion === 1;
  return {
    ...DEFAULT_SETTINGS,
    settingsVersion: Number.isSafeInteger(v.settingsVersion) && Number(v.settingsVersion) > 0 ? Number(v.settingsVersion) : 1,
    autoTranslate: schemaOk && v.autoTranslate === true,
    sourceLanguage: LANGUAGES.some(l => l.code === v.sourceLanguage) ? v.sourceLanguage as SourceLanguage : 'en',
    selectionLookup: v.selectionLookup !== false,
    translationScale: typeof v.translationScale === 'number' ? Math.min(1, Math.max(0.75, v.translationScale)) : 0.85,
    minimumTranslationFontPx: [12, 14, 16].includes(Number(v.minimumTranslationFontPx)) ? Number(v.minimumTranslationFontPx) as 12 | 14 | 16 : 12,
    siteRules,
  };
}

export function shouldAutoTranslate(settings: Settings, origin: string, paused = false): boolean {
  return settings.autoTranslate && !paused && settings.siteRules[origin] !== 'never';
}

export function settingsChangeRequiresReset(previous: Settings, next: Settings): boolean {
  return previous.sourceLanguage !== next.sourceLanguage || previous.targetLanguage !== next.targetLanguage;
}
