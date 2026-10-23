import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalEngine } from '../src/providers/local';
afterEach(() => vi.unstubAllGlobals());
describe('native cached-pair creation', () => {
  it('uses a cached pair even when availability hides its state at a new origin', async () => {
    vi.stubGlobal('isSecureContext', true);
    const translate = vi.fn(async () => '内容的译文'); const destroy = vi.fn();
    const create = vi.fn(async () => ({ translate, destroy }));
    vi.stubGlobal('Translator', { availability: vi.fn(async () => 'downloadable'), create });
    const engine = new LocalEngine('zh-CN', 'fr');
    expect(await engine.translate('阅读帮助我们理解世界。', new AbortController().signal)).toBe('内容的译文');
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ sourceLanguage: 'zh', targetLanguage: 'fr' }));
    engine.dispose(); await Promise.resolve(); expect(destroy).toHaveBeenCalled();
  });
  it('waits for transient activation to expire before cached creation', async () => {
    vi.stubGlobal('isSecureContext', true); const activation = { isActive: true };
    vi.stubGlobal('navigator', { userActivation: activation });
    const create = vi.fn(async () => ({ translate: async () => '译文', destroy() {} }));
    vi.stubGlobal('Translator', { availability: vi.fn(async () => 'downloadable'), create });
    const engine = new LocalEngine('fr'); const result = engine.translate('Du texte en français.', new AbortController().signal);
    await new Promise(resolve => setTimeout(resolve, 20)); expect(create).not.toHaveBeenCalled();
    activation.isActive = false; expect(await result).toBe('译文'); expect(create).toHaveBeenCalledTimes(1); engine.dispose();
  });
  it('does not wait for page activation when creation runs in the extension window', async () => {
    vi.stubGlobal('isSecureContext', true); vi.stubGlobal('navigator', { userActivation: { isActive: true } });
    const create = vi.fn(async () => ({ translate: async () => 'Translated text', destroy() {} }));
    const engine = new LocalEngine('zh-CN', 'en', () => ({ translator: { availability: async () => 'downloadable', create } }), false);
    expect(await engine.translate('阅读让我们理解世界。', new AbortController().signal)).toBe('Translated text');
    expect(create).toHaveBeenCalledOnce(); engine.dispose();
  });
  it('treats a truly missing model as a missing package without starting an activated download', async () => {
    vi.stubGlobal('isSecureContext', true);
    const create = vi.fn(async () => { throw new DOMException('User activation required', 'NotAllowedError'); });
    vi.stubGlobal('Translator', { availability: vi.fn(async () => 'downloadable'), create });
    const engine = new LocalEngine('fr', 'ja');
    await expect(engine.translate('La lecture nous aide à découvrir le monde.', new AbortController().signal)).rejects.toMatchObject({ code: 'needs_download' });
    expect(create).toHaveBeenCalledTimes(1); engine.dispose();
  });
});
