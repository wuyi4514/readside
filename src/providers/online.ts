import { TextCache } from '../shared/cache';
import type { Provider } from '../shared/settings';
import type { LanguageCandidate } from './local';

/** Content scripts never receive credentials or choose a network endpoint. */
export class OnlineEngine {
  private lifecycle = new AbortController();
  private translations = new TextCache<string>();
  private detections = new TextCache<LanguageCandidate[]>(1000, 1024 * 1024);
  constructor(private provider: Provider, private target: string) {}
  private async request(op: 'detect' | 'translate', text: string, source: string, signal: AbortSignal): Promise<unknown> {
    const combined = AbortSignal.any([signal, this.lifecycle.signal]); combined.throwIfAborted();
    const request = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const abort = (): void => {
        void chrome.runtime.sendMessage({ type: 'PR_ONLINE_CANCEL', request }).catch(() => undefined);
        reject(new DOMException('Cancelled', 'AbortError'));
      };
      combined.addEventListener('abort', abort, { once: true });
      void chrome.runtime.sendMessage({ type: 'PR_ONLINE', request, op, text, source, target: this.target, provider: this.provider }).then(response => {
        if (combined.aborted) return;
        if (!response?.ok) reject(new Error(response?.error ?? 'online_failed'));
        else resolve(response.value);
      }, reject).finally(() => combined.removeEventListener('abort', abort));
    });
  }
  async detect(text: string, signal: AbortSignal): Promise<LanguageCandidate[]> {
    signal.throwIfAborted(); const cached = this.detections.get(text); if (cached) return cached;
    const result = await this.request('detect', text.slice(0, 4000), '', signal) as LanguageCandidate[];
    signal.throwIfAborted(); this.detections.set(text, result); return result;
  }
  async translate(text: string, source: string, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted(); const key = source + ':' + text;
    const cached = this.translations.get(key); if (cached !== undefined) return cached;
    const result = await this.request('translate', text, source, signal) as string;
    signal.throwIfAborted(); this.translations.set(key, result); return result;
  }
  clearCache(): void { this.translations.clear(); this.detections.clear(); }
  dispose(): void { this.lifecycle.abort(); this.clearCache(); }
}
