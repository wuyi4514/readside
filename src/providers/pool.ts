import { LocalEngine } from './local';
import { remoteAPIs } from './remote';
import { OnlineEngine } from './online';
import type { Provider } from '../shared/settings';

/** One detector shared by all languages; each translator owns its own session and cache. */
export class DocumentEngine {
  private online?: OnlineEngine;
  constructor(private target = 'zh-CN', provider: Provider = 'chrome-local') { if (provider !== 'chrome-local') this.online = new OnlineEngine(provider, target); }
  private apis = remoteAPIs();
  private engines = new Map<string, LocalEngine>();
  private get(source: string): LocalEngine {
    let engine = this.engines.get(source);
    if (!engine) { engine = new LocalEngine(source, this.target, () => this.apis, false); this.engines.set(source, engine); }
    return engine;
  }
  detect(text: string, signal: AbortSignal) { return this.online ? this.online.detect(text, signal) : this.get('en').detect(text, signal); }
  translate(text: string, source: string, signal: AbortSignal) { return this.online ? this.online.translate(text, source, signal) : this.get(source).translate(text, signal); }
  clearCache(): void { this.online?.clearCache(); for (const engine of this.engines.values()) engine.clearCache(); }
  dispose(): void { this.online?.dispose(); for (const engine of this.engines.values()) engine.dispose(); this.engines.clear(); }
}
