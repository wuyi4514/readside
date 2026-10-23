import { LocalEngine } from './local';
import { remoteAPIs } from './remote';

/** One detector shared by all languages; each translator owns its own session and cache. */
export class DocumentEngine {
  constructor(private target = 'zh-CN') {}
  private apis = remoteAPIs();
  private engines = new Map<string, LocalEngine>();
  private get(source: string): LocalEngine {
    let engine = this.engines.get(source);
    if (!engine) { engine = new LocalEngine(source, this.target, () => this.apis, false); this.engines.set(source, engine); }
    return engine;
  }
  detect(text: string, signal: AbortSignal) { return this.get('en').detect(text, signal); }
  translate(text: string, source: string, signal: AbortSignal) { return this.get(source).translate(text, signal); }
  clearCache(): void { for (const engine of this.engines.values()) engine.clearCache(); }
  dispose(): void { for (const engine of this.engines.values()) engine.dispose(); this.engines.clear(); }
}
