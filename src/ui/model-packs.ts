import { apiLanguage, languageLabel, type SourceLanguage, type TargetLanguage } from '../shared/settings';
import { nativeAPIs, type Availability, type NativeDetector, type NativeTranslator } from '../providers/native-types';

const SAMPLES: Record<SourceLanguage, string> = {
  en: 'Reading helps us discover new ideas and understand the world around us.',
  fr: 'La lecture nous aide à découvrir de nouvelles idées et à comprendre le monde.',
  es: 'La lectura nos ayuda a descubrir nuevas ideas y comprender el mundo que nos rodea.',
  de: 'Lesen hilft uns, neue Ideen zu entdecken und die Welt um uns herum zu verstehen.',
  ja: '読書は私たちが新しいアイデアを発見し、周りの世界を理解するのに役立ちます。',
  ko: '독서는 새로운 아이디어를 발견하고 우리 주변의 세상을 이해하는 데 도움이 됩니다.',
  'zh-CN': '阅读能帮助我们发现新的想法，理解周围的世界，也让我们有机会了解不同文化中人们的生活和思考方式。',
};
type Key = SourceLanguage | 'detector';
interface Pack {
  key: Key; availability: Availability; status: string; progress?: number;
  phase: 'checking' | 'idle' | 'loading' | 'ready' | 'error'; controller?: AbortController;
  done?: Promise<void>; session?: NativeTranslator | NativeDetector;
}

/** Progress is exclusively native downloadprogress.loaded (0..1). No simulated timer. */
export class ModelPacks {
  private sources: SourceLanguage[] = [];
  private packs = new Map<Key, Pack>();
  private epoch = 0;
  private target: TargetLanguage = 'zh-CN';
  private cards = new Map<Key, HTMLElement>();
  constructor(private host: HTMLElement, private summary: HTMLElement, private changed: (ready: boolean) => void) {
    window.addEventListener('pagehide', () => { for (const pack of this.packs.values()) this.cancel(pack); });
  }
  async setSources(sources: SourceLanguage[], target: TargetLanguage): Promise<void> {
    if (this.target !== target) {
      for (const [key, pack] of this.packs) if (key !== 'detector') { this.cancel(pack); this.packs.delete(key); this.cards.get(key)?.remove(); this.cards.delete(key); }
      this.target = target;
    }
    this.sources = [...sources];
    for (const [key, pack] of this.packs) if (key !== 'detector' && !sources.includes(key)) { this.cancel(pack); this.packs.delete(key); }
    const keys: Key[] = [...sources, 'detector']; const apis = nativeAPIs(); const epoch = ++this.epoch;
    for (const key of keys) if (!this.packs.has(key)) this.packs.set(key, { key, availability: 'downloadable', phase: 'checking', status: '正在检查…' });
    this.render();
    await Promise.all(keys.map(async key => {
      const pack = this.packs.get(key)!; if (pack.controller || pack.phase === 'ready') return;
      if (key === target) { pack.phase = 'ready'; pack.availability = 'available'; pack.status = '无需翻译'; this.render(); return; }
      const probe = key === 'detector' ? apis.detector?.availability() : apis.translator?.availability({ sourceLanguage: apiLanguage(key), targetLanguage: apiLanguage(target) });
      const availability = await probe?.catch(() => 'unavailable' as const) ?? 'unavailable';
      if (epoch !== this.epoch || pack.controller || !this.packs.has(key)) return;
      pack.availability = availability; pack.phase = availability === 'available' ? 'ready' : 'idle';
      // Chrome may report downloadable even when resources are cached. Only a
      // native downloadprogress event is presented as download progress.
      pack.status = availability === 'available' ? '已就绪' : availability === 'unavailable' ? '当前浏览器暂不支持' : '待准备'; this.render();
    }));
    this.render();
  }
  private ready(): boolean {
    return this.packs.get('detector')?.phase === 'ready' && this.sources.some(source => source !== this.target && this.packs.get(source)?.phase === 'ready');
  }
  private render(): void {
    const keys: Key[] = [...this.sources]; const detector = this.packs.get('detector');
    if (detector && detector.phase !== 'ready') keys.push('detector');
    for (const [key, card] of this.cards) if (!keys.includes(key)) { card.remove(); this.cards.delete(key); }
    keys.forEach((key, index) => {
      const pack = this.packs.get(key)!;
      let card = this.cards.get(key);
      if (!card) {
        card = document.createElement('div'); card.className = `pack-card${key === 'detector' ? ' detector-card' : ''}`; card.dataset.language = key;
        const top = document.createElement('div'); top.className = 'pack-top';
        const info = document.createElement('div'); info.className = 'pack-info';
        const name = document.createElement('div'); name.className = 'pack-name'; name.textContent = key === 'detector' ? '语言识别' : `${languageLabel(key)} → ${languageLabel(this.target)}`;
        name.title = key === 'detector' ? '所有翻译方向共用' : name.textContent;
        const status = document.createElement('div'); status.className = 'pack-status'; status.setAttribute('role', 'status');
        info.append(name, status);
        const button = document.createElement('button'); button.type = 'button'; button.className = 'button secondary small pack-action';
        button.addEventListener('click', () => {
          if (pack.controller) { this.cancel(pack); this.render(); return; }
          const shared = this.packs.get('detector');
          // Both create calls run directly in this user gesture, before any await.
          if (key !== 'detector' && shared?.phase !== 'ready' && !shared?.controller) this.start(shared!);
          this.start(pack);
        });
        button.append(circleProgress()); top.append(info, button); card.append(top); this.cards.set(key, card);
      }
      const status = card.querySelector<HTMLElement>('.pack-status')!;
      status.dataset.state = pack.phase; status.textContent = pack.status;
      const button = card.querySelector<HTMLButtonElement>('button')!;
      const direction = key === 'detector' ? '语言识别' : `${languageLabel(key)} → ${languageLabel(this.target)}`;
      const action = pack.controller ? '取消准备' : pack.phase === 'ready' ? '重新检查' : pack.phase === 'error' ? '重试准备' : '准备';
      const label = `${action}${direction}`;
      button.setAttribute('aria-label', label); button.title = label; button.dataset.state = pack.phase;
      button.disabled = pack.phase === 'checking' || pack.availability === 'unavailable' || key === this.target;
      const progress = button.querySelector<SVGSVGElement>('svg')!;
      progress.style.display = pack.controller ? '' : 'none'; progress.classList.toggle('indeterminate', pack.progress === undefined);
      progress.setAttribute('aria-label', `${direction}${pack.progress === undefined ? '准备' : '下载'}进度`);
      if (pack.progress !== undefined) { progress.setAttribute('aria-valuenow', String(Math.round(pack.progress * 100))); progress.setAttribute('aria-valuetext', `${Math.round(pack.progress * 100)}%`); }
      else { progress.removeAttribute('aria-valuenow'); progress.setAttribute('aria-valuetext', '正在准备'); }
      (progress.querySelector('.circle-fill') as SVGCircleElement).style.strokeDashoffset = String(100 - (pack.progress ?? .22) * 100);
      let symbol = button.querySelector<HTMLElement>('.pack-symbol');
      if (!symbol) { symbol = document.createElement('span'); symbol.className = 'pack-symbol'; symbol.setAttribute('aria-hidden', 'true'); button.append(symbol); }
      symbol.textContent = pack.controller ? '×' : key === this.target ? '—' : pack.phase === 'ready' ? '✓' : pack.phase === 'error' ? '重试' : '准备';
      if (this.host.children[index] !== card) this.host.insertBefore(card, this.host.children[index] ?? null);
    });
    const ready = this.ready(); const all = this.sources.every(source => this.packs.get(source)?.phase === 'ready') && detector?.phase === 'ready';
    const checking = [...this.packs.values()].some(pack => pack.phase === 'checking');
    const loading = [...this.packs.values()].some(pack => pack.controller);
    const supported = this.sources.some(source => source !== this.target && this.packs.get(source)?.availability !== 'unavailable');
    this.summary.textContent = this.sources.every(source => source === this.target) ? '源语言和目标语言相同，无需翻译。'
      : checking ? '正在检查当前翻译方向…'
      : all ? '所选翻译方向已就绪'
      : loading ? '正在准备，已有模型会复用，缺少时按需下载。'
      : ready ? '已就绪的方向可以使用，其余方向需先准备。'
      : !supported ? '当前浏览器暂不支持所选翻译方向。'
      : '点击“准备”启用当前方向；已有模型会复用，缺少时按需下载。';
    this.changed(ready);
  }
  private cancel(pack: Pack): void {
    pack.controller?.abort(); pack.controller = undefined; pack.session?.destroy(); pack.session = undefined;
    if (pack.phase === 'loading') { pack.phase = 'idle'; pack.status = '已取消，可继续准备'; pack.progress = undefined; }
  }
  private start(pack: Pack): void {
    if (!pack || pack.phase === 'checking' || pack.controller || pack.availability === 'unavailable') return;
    const controller = new AbortController(); pack.controller = controller; pack.phase = 'loading'; pack.progress = undefined; pack.status = '正在准备…';
    const apis = nativeAPIs();
    const current = () => pack.controller === controller && !controller.signal.aborted && this.packs.get(pack.key) === pack;
    const monitor = (m: import('../providers/native-types').ProgressMonitor) => m.addEventListener('downloadprogress', event => {
      if (!current() || !Number.isFinite(event.loaded)) return;
      pack.progress = Math.min(1, Math.max(pack.progress ?? 0, event.loaded));
      pack.status = pack.progress === 1 ? '正在完成准备…' : `正在下载 · ${Math.round(pack.progress * 100)}%`; this.render();
    });
    // Do not await availability here: create must retain Chrome's transient activation.
    let creating: Promise<NativeTranslator | NativeDetector>;
    try {
      creating = pack.key === 'detector' ? apis.detector!.create({ signal: controller.signal, monitor }) : apis.translator!.create({ sourceLanguage: apiLanguage(pack.key), targetLanguage: apiLanguage(this.target), signal: controller.signal, monitor });
    } catch (error) { creating = Promise.reject(error); }
    let session: NativeTranslator | NativeDetector | undefined;
    pack.done = (async () => {
      session = await creating;
      if (!current()) { session.destroy(); return; }
      pack.session = session;
      pack.status = '正在完成准备…'; this.render();
      if (pack.key === 'detector') {
        const result = await (session as NativeDetector).detect(SAMPLES.en, { signal: controller.signal });
        if (!result.length) throw new Error('empty_detection');
      } else {
        const result = await (session as NativeTranslator).translate(SAMPLES[pack.key], { signal: controller.signal });
        if (!result.trim()) throw new Error('empty_translation');
      }
      if (!current()) return;
      pack.phase = 'ready'; pack.status = '已就绪'; pack.availability = 'available';
      void chrome.runtime.sendMessage({ type: 'PR_MODELS_READY' }).catch(() => undefined);
    })().catch(error => {
      if (!current()) return;
      pack.phase = 'error'; pack.status = error instanceof Error && error.name === 'NotSupportedError' ? '当前浏览器暂不支持' : '准备未完成，请重试';
    }).finally(() => {
      session?.destroy(); if (pack.session === session) pack.session = undefined;
      if (pack.controller === controller) { pack.controller = undefined; this.render(); }
    });
    this.render();
  }
}

function circleProgress(): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 36 36'); svg.classList.add('pack-circle');
  svg.setAttribute('role', 'progressbar'); svg.setAttribute('aria-valuemin', '0'); svg.setAttribute('aria-valuemax', '100');
  for (const name of ['circle-track', 'circle-fill']) {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle'); circle.setAttribute('cx', '18'); circle.setAttribute('cy', '18'); circle.setAttribute('r', '15'); circle.setAttribute('pathLength', '100'); circle.classList.add(name); svg.append(circle);
  }
  return svg;
}
