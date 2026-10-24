import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import { isExtensionUI } from '../src/shared/sender';

const deferred = vi.hoisted(() => new Map<string, (text: string) => void>());
const models = vi.hoisted(() => ({ frenchReady: false }));
vi.mock('../src/providers/local', async importOriginal => {
  const original = await importOriginal<typeof import('../src/providers/local')>();
  return { ...original,
  LocalEngine: class {
    constructor(private source: string) {}
    async detect(text: string) { return [{ detectedLanguage: text.startsWith('Nous') ? 'fr' : 'en', confidence: .99 }]; }
    translate(text: string) {
      if (this.source === 'fr') return models.frenchReady ? Promise.resolve('法语内容的中文译文') : Promise.reject(new original.EngineError('needs_download'));
      return new Promise<string>(resolve => deferred.set(text, resolve));
    }
    clearCache() {} dispose() {}
  },
}; });
vi.mock('../src/content/renderer', () => ({
  layoutFingerprint: () => 'stable', safeContainer: () => true, layoutFits: () => true, styleTranslation: () => {},
  renderTranslation: (source: HTMLElement, text: string) => { const node = document.createElement('span'); node.dataset.prOwned = 'translation'; node.textContent = text; source.append(node); return node; },
}));
import { Controller } from '../src/content/controller';

const original = 'This is the first article explaining how useful tools can help people learn from the world.';
const updated = 'This is a completely different article describing the latest update and a new set of useful ideas.';
let controller: Controller;

beforeEach(() => {
  deferred.clear(); models.frenchReady = false;
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('innerHeight', 1000); vi.stubGlobal('innerWidth', 1200);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async (message: { type: string }) => message.type === 'PR_GET_SETTINGS' ? { settings: { ...DEFAULT_SETTINGS, autoTranslate: true, autoTranslateAllPages: true, settingsVersion: 2 }, autoAllowed: true } : undefined) } });
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: 600, height: 60, top: 100, bottom: 160, left: 0, right: 600, x: 0, y: 100, toJSON() {} });
  document.body.innerHTML = `<p id="source">${original}</p>`;
  controller = new Controller();
});
afterEach(() => {
  controller.restore();
  for (const resolve of deferred.values()) resolve('已取消的结果');
  document.body.replaceChildren(); vi.unstubAllGlobals();
});

describe('uncancellable provider results', () => {
  it('cannot reinsert a late result after restore', async () => {
    await controller.initialize(); await vi.waitFor(() => expect(deferred.has(original)).toBe(true));
    controller.restore(); deferred.get(original)!('这段结果迟到了');
    await new Promise(resolve => setTimeout(resolve, 40));
    expect(document.querySelector('[data-pr-owned]')).toBeNull();
    expect(controller.status().state).toBe('paused');
  });
  it('cannot attach the old translation to a recycled text node', async () => {
    await controller.initialize(); await vi.waitFor(() => expect(deferred.has(original)).toBe(true));
    document.querySelector('#source')!.textContent = updated;
    await new Promise(resolve => setTimeout(resolve, 230));
    deferred.get(original)!('错误的旧文章译文');
    await vi.waitFor(() => expect(deferred.has(updated)).toBe(true));
    deferred.get(updated)!('正确的新文章译文');
    await vi.waitFor(() => expect(document.querySelector('[data-pr-owned]')?.textContent).toBe('正确的新文章译文'));
    expect(document.body.textContent).not.toContain('错误的旧文章译文');
    expect(document.querySelectorAll('[data-pr-owned]')).toHaveLength(1);
  });
  it('can restart while the previous provider is still unresolved', async () => {
    await controller.initialize(); await vi.waitFor(() => expect(deferred.has(original)).toBe(true));
    const oldResolve = deferred.get(original)!;
    controller.restore(); controller.translate();
    await vi.waitFor(() => expect(deferred.get(original)).not.toBe(oldResolve));
    deferred.get(original)!('重新启动后的译文');
    await vi.waitFor(() => expect(document.querySelector('[data-pr-owned]')?.textContent).toBe('重新启动后的译文'));
    oldResolve('已过期的迟到结果'); await new Promise(resolve => setTimeout(resolve, 20));
    expect(document.body.textContent).not.toContain('已过期的迟到结果');
  });
});

describe('settings sender authorization', () => {
  it('allows the actual tabbed settings page without trusting arbitrary content scripts', () => {
    expect(isExtensionUI({ id: 'reader', url: 'chrome-extension://reader/options.html', tab: { id: 5 } as chrome.tabs.Tab }, 'reader')).toBe(true);
    expect(isExtensionUI({ id: 'reader', url: 'https://example.com/options.html' }, 'reader')).toBe(false);
    expect(isExtensionUI({ id: 'other', url: 'chrome-extension://reader/options.html' }, 'reader')).toBe(false);
    expect(isExtensionUI({ id: 'reader', url: 'chrome-extension://reader/unknown.html' }, 'reader')).toBe(false);
  });
});

describe('independent language packages', () => {
  it('keeps translating ready languages and retries a missing language without resuming a restored page', async () => {
    document.body.innerHTML = `<p>Nous voulons découvrir de nouvelles idées avec les personnes qui nous entourent.</p><p>${original}</p>`;
    controller.apply({ ...DEFAULT_SETTINGS, sourceLanguages: ['en','fr'], autoTranslate: true, autoTranslateAllPages: true, settingsVersion: 3 }, true);
    await vi.waitFor(() => expect(deferred.has(original)).toBe(true)); deferred.get(original)!('英语内容的中文译文');
    await vi.waitFor(() => expect(controller.status().state).toBe('partial'));
    expect(controller.status().translated).toBe(1); expect(controller.status().missingLanguages).toEqual(['fr']);
    models.frenchReady = true; controller.retry();
    await vi.waitFor(() => expect(controller.status().translated).toBe(2));
    expect(controller.status().missingLanguages).toBeUndefined();
    controller.restore(); controller.retry();
    expect(controller.status().state).toBe('paused'); expect(document.querySelector('[data-pr-owned]')).toBeNull();
  });
});

describe('incremental reading', () => {
  it('translates appended content and observes later character changes inside its inline markup', async () => {
    await controller.initialize(); await vi.waitFor(() => expect(deferred.has(original)).toBe(true));
    deferred.get(original)!('已有段落的译文');
    await vi.waitFor(() => expect(controller.status().translated).toBe(1));
    const title = document.createElement('h2');
    title.innerHTML = `<span><strong>${updated}</strong></span>`;
    document.body.append(title);
    await vi.waitFor(() => expect(deferred.has(updated)).toBe(true)); deferred.get(updated)!('动态加载的标题');
    await vi.waitFor(() => expect(title.querySelector('[data-pr-owned]')?.textContent).toBe('动态加载的标题'));
    const replacement = 'Another newly loaded discussion describes how different people read and understand useful information.';
    title.querySelector('strong')!.firstChild!.textContent = replacement;
    await vi.waitFor(() => expect(deferred.has(replacement)).toBe(true)); deferred.get(replacement)!('更新后的标题');
    await vi.waitFor(() => expect(title.querySelector('[data-pr-owned]')?.textContent).toBe('更新后的标题'));
    expect(title.textContent).not.toContain('动态加载的标题');
    controller.restore();
    const paused = document.createElement('p'); paused.textContent = 'This content arrived after reading was paused and should stay in its original language.';
    document.body.append(paused); await new Promise(resolve => setTimeout(resolve, 220));
    expect(deferred.has(paused.textContent)).toBe(false);
  });
});

describe('hydrated placeholders', () => {
  it('discovers text populated inside previously empty inline markup', async () => {
    document.body.innerHTML = '<h2><span><strong></strong></span></h2>';
    await controller.initialize(); await new Promise(resolve => setTimeout(resolve, 220));
    document.querySelector('strong')!.textContent = updated;
    await vi.waitFor(() => expect(deferred.has(updated)).toBe(true)); deferred.get(updated)!('稍后加载的内容');
    await vi.waitFor(() => expect(document.querySelector('h2 [data-pr-owned]')?.textContent).toBe('稍后加载的内容'));
  });
});
