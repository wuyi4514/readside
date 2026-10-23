import { apiLanguage } from '../shared/settings';
import { TextCache } from '../shared/cache';
import { nativeAPIs, type NativeDetector, type NativeTranslator } from './native-types';

export class EngineError extends Error {
  constructor(public readonly code: 'unsupported_browser' | 'unsupported_pair' | 'needs_download' | 'activation_required' | 'timeout' | 'translation_failed') { super(code); }
}
export interface LanguageCandidate { detectedLanguage: string; confidence: number }

export class LocalEngine {
  private translator?: Promise<NativeTranslator>;
  private detector?: Promise<NativeDetector>;
  private lifecycle = new AbortController();
  private translations = new TextCache<string>();
  private detections = new TextCache<LanguageCandidate[]>(1000, 1024 * 1024);
  constructor(readonly source: string, readonly target = 'zh-CN', private apis = nativeAPIs, private guardWindowActivation = true) {}

  private async translationSession(): Promise<NativeTranslator> {
    if (!this.translator) {
      this.translator = (async () => {
        const api = this.apis().translator;
        if (!api || !isSecureContext) throw new EngineError('unsupported_browser');
        const availability = await api.availability({ sourceLanguage: apiLanguage(this.source), targetLanguage: apiLanguage(this.target) });
        if (availability === 'unavailable') throw new EngineError('unsupported_pair');
        if (availability !== 'available' && this.guardWindowActivation) await withoutActivation(this.lifecycle.signal);
        try { return await api.create({ sourceLanguage: apiLanguage(this.source), targetLanguage: apiLanguage(this.target), signal: this.lifecycle.signal }); }
        catch (error) { throw creationError(error); }
      })();
      void this.translator.catch(() => { this.translator = undefined; });
    }
    return this.translator;
  }

  private async detectionSession(): Promise<NativeDetector> {
    if (!this.detector) {
      this.detector = (async () => {
        const api = this.apis().detector;
        if (!api) throw new EngineError('unsupported_browser');
        const availability = await api.availability();
        if (availability === 'unavailable') throw new EngineError('unsupported_browser');
        if (availability !== 'available' && this.guardWindowActivation) await withoutActivation(this.lifecycle.signal);
        try { return await api.create({ signal: this.lifecycle.signal }); } catch (error) { throw creationError(error); }
      })();
      void this.detector.catch(() => { this.detector = undefined; });
    }
    return this.detector;
  }

  async detect(text: string, signal: AbortSignal): Promise<LanguageCandidate[]> {
    signal.throwIfAborted();
    const cached = this.detections.get(text);
    if (cached) return cached;
    const detector = await this.detectionSession();
    signal.throwIfAborted();
    const result = await detector.detect(text.slice(0, 4000), { signal: AbortSignal.any([signal, this.lifecycle.signal, AbortSignal.timeout(15_000)]) });
    const valid = result.filter(r => typeof r.detectedLanguage === 'string' && Number.isFinite(r.confidence) && r.confidence >= 0 && r.confidence <= 1).sort((a, b) => b.confidence - a.confidence);
    signal.throwIfAborted(); this.detections.set(text, valid); return valid;
  }

  async translate(text: string, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted();
    const cached = this.translations.get(text);
    if (cached !== undefined) return cached;
    const translator = await this.translationSession();
    signal.throwIfAborted();
    const translated = (await translator.translate(text, { signal: AbortSignal.any([signal, this.lifecycle.signal, AbortSignal.timeout(15_000)]) })).trim();
    signal.throwIfAborted();
    if (!translated || translated.length > Math.max(4000, text.length * 8)) throw new EngineError('translation_failed');
    this.translations.set(text, translated); return translated;
  }

  clearCache(): void { this.translations.clear(); this.detections.clear(); }
  dispose(): void {
    this.lifecycle.abort();
    void this.translator?.then(t => t.destroy()).catch(() => undefined);
    void this.detector?.then(d => d.destroy()).catch(() => undefined);
    this.translator = undefined; this.detector = undefined; this.clearCache();
  }
}

/** Chrome may report downloadable for a cached pair at a new origin. Only try
 * cached creation without activation, so a real missing model cannot download
 * using a webpage click. Actual downloads require the settings-page gesture. */
async function withoutActivation(signal: AbortSignal): Promise<void> {
  while (navigator.userActivation?.isActive) {
    signal.throwIfAborted();
    await new Promise<void>(resolve => setTimeout(resolve, 150));
  }
  signal.throwIfAborted();
}
function creationError(error: unknown): unknown {
  const name = error && typeof error === 'object' && 'name' in error ? String(error.name) : '';
  if (['NotAllowedError', 'InvalidStateError'].includes(name)) return new EngineError('needs_download');
  return name === 'NotSupportedError' ? new EngineError('unsupported_pair') : error;
}
