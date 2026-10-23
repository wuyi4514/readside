import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModelPacks } from '../src/ui/model-packs';
import type { Availability, NativeTranslator, ProgressMonitor } from '../src/providers/native-types';

const availability = vi.fn<(options: { sourceLanguage: string; targetLanguage: string }) => Promise<Availability>>();
const create = vi.fn();
let host: HTMLElement;
let summary: HTMLElement;
let changed: ReturnType<typeof vi.fn<(ready: boolean) => void>>;
let packs: ModelPacks;
const session = (): NativeTranslator => ({ translate: vi.fn(async () => '译文'), destroy: vi.fn() });
const card = (source = 'en'): HTMLElement => host.querySelector(`[data-language="${source}"]`)!;
const action = (source = 'en'): HTMLButtonElement => card(source).querySelector('button')!;

beforeEach(() => {
  availability.mockReset().mockResolvedValue('downloadable'); create.mockReset();
  vi.stubGlobal('Translator', { availability, create });
  vi.stubGlobal('LanguageDetector', { availability: vi.fn(async () => 'available') });
  vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn(async () => ({})) } });
  document.body.innerHTML = '<div id="packs"></div><p id="summary"></p>';
  host = document.getElementById('packs')!; summary = document.getElementById('summary')!; changed = vi.fn();
  packs = new ModelPacks(host, summary, changed);
});

describe('translation direction preparation', () => {
  it('does not treat privacy-limited availability as a confirmed download', async () => {
    let complete!: (translator: NativeTranslator) => void;
    create.mockImplementation(() => new Promise<NativeTranslator>(resolve => { complete = resolve; }));
    await packs.setSources(['en'], 'es');
    expect(card().querySelector('.pack-name')?.textContent).toBe('英语 → 西班牙语');
    expect(card().querySelector('.pack-status')?.textContent).toBe('待准备');
    expect(create).not.toHaveBeenCalled();
    action().click();
    expect(action().getAttribute('aria-label')).toBe('取消准备英语 → 西班牙语');
    expect(card().querySelector('.pack-status')?.textContent).toBe('正在准备…');
    expect(card().querySelector('svg')?.hasAttribute('aria-valuenow')).toBe(false);
    complete(session());
    await vi.waitFor(() => expect(card().querySelector('.pack-status')?.textContent).toBe('已就绪'));
    expect(card().textContent).not.toContain('正在下载');
  });

  it('uses only native progress and rejects late progress after a target change', async () => {
    let emit!: (event: { loaded: number }) => void;
    let complete!: (translator: NativeTranslator) => void;
    let signal!: AbortSignal;
    create.mockImplementation(options => {
      signal = options.signal;
      options.monitor({ addEventListener: (_: string, listener: typeof emit) => { emit = listener; } } satisfies ProgressMonitor);
      return new Promise<NativeTranslator>(resolve => { complete = resolve; });
    });
    await packs.setSources(['en'], 'es'); action().click(); emit({ loaded: .28 });
    expect(card().querySelector('.pack-status')?.textContent).toBe('正在下载 · 28%');
    expect(card().querySelector('svg')?.getAttribute('aria-valuenow')).toBe('28');
    expect((card().querySelector('.circle-fill') as SVGElement).style.strokeDashoffset).toBe('72');
    availability.mockResolvedValue('available');
    await packs.setSources(['en'], 'zh-CN');
    expect(signal.aborted).toBe(true);
    emit({ loaded: .9 });
    const stale = session(); complete(stale);
    await vi.waitFor(() => expect(stale.destroy).toHaveBeenCalled());
    expect(stale.translate).not.toHaveBeenCalled();
    expect(card().querySelector('.pack-name')?.textContent).toBe('英语 → 简体中文');
    expect(card().querySelector('.pack-status')?.textContent).toBe('已就绪');
    expect(card().querySelector('svg')?.hasAttribute('aria-valuenow')).toBe(false);
  });

  it('rechecks a returning direction and reuses availability without creating another translator', async () => {
    availability.mockImplementation(async options => options.targetLanguage === 'zh' ? 'available' : 'downloadable');
    await packs.setSources(['en'], 'zh-CN');
    expect(changed).toHaveBeenLastCalledWith(true);
    await packs.setSources(['en'], 'es');
    expect(changed).toHaveBeenLastCalledWith(false);
    await packs.setSources(['en'], 'zh-CN');
    expect(changed).toHaveBeenLastCalledWith(true);
    expect(availability.mock.calls.map(([options]) => options.targetLanguage)).toEqual(['zh', 'es', 'zh']);
    expect(create).not.toHaveBeenCalled();
  });

  it('keeps preparation disabled while the browser checks availability', async () => {
    let finish!: (value: Availability) => void;
    availability.mockImplementation(() => new Promise<Availability>(resolve => { finish = resolve; }));
    const checking = packs.setSources(['en'], 'es');
    expect(action().disabled).toBe(true); action().click(); expect(create).not.toHaveBeenCalled();
    finish('downloadable'); await checking;
    expect(action().disabled).toBe(false);
    expect(card().querySelector('.pack-status')?.textContent).toBe('待准备');
  });

  it('supports retry after preparation fails without inventing progress', async () => {
    create.mockRejectedValueOnce(new Error('temporary failure')).mockResolvedValueOnce(session());
    await packs.setSources(['en'], 'es'); action().click();
    await vi.waitFor(() => expect(action().textContent).toBe('重试'));
    expect(card().querySelector('svg')?.hasAttribute('aria-valuenow')).toBe(false);
    action().click(); await vi.waitFor(() => expect(card().querySelector('.pack-status')?.textContent).toBe('已就绪'));
    expect(create).toHaveBeenCalledTimes(2);
  });
});
