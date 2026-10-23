import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import { isExtensionUI } from '../src/shared/sender';

const deferred = vi.hoisted(() => new Map<string, (text: string) => void>());
vi.mock('../src/providers/local', async importOriginal => ({
  ...await importOriginal<typeof import('../src/providers/local')>(),
  LocalEngine: class {
    async detect() { return [{ detectedLanguage: 'en', confidence: .99 }]; }
    translate(text: string) { return new Promise<string>(resolve => deferred.set(text, resolve)); }
    clearCache() {} dispose() {}
  },
}));
vi.mock('../src/content/renderer', () => ({
  safeContainer: () => true, layoutFits: () => true, styleTranslation: () => {},
  renderTranslation: (source: HTMLElement, text: string) => { const node = document.createElement('span'); node.dataset.prOwned = 'translation'; node.textContent = text; source.append(node); return node; },
}));
import { Controller } from '../src/content/controller';

const original = 'This is the first article explaining how useful tools can help people learn from the world.';
const updated = 'This is a completely different article describing the latest update and a new set of useful ideas.';
let controller: Controller;

beforeEach(() => {
  deferred.clear();
  vi.stubGlobal('isSecureContext', true);
  vi.stubGlobal('innerHeight', 1000); vi.stubGlobal('innerWidth', 1200);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async (message: { type: string }) => message.type === 'PR_GET_SETTINGS' ? { settings: { ...DEFAULT_SETTINGS, autoTranslate: true, settingsVersion: 2 }, autoAllowed: true } : undefined) } });
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
