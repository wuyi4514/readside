import { DEFAULT_SETTINGS, settingsChangeRequiresReset, shouldAutoTranslate, type Settings } from '../shared/settings';
import { EMPTY_STATUS, type PageStatus } from '../shared/messages';
import { EngineError, LocalEngine } from '../providers/local';
import { candidates, contextFor, entryKey, excludedFromTranslation, nearViewport, OWNED, sourceLanguageHint, sourceText } from './extractor';
import { sentences, translatableSegments } from './language';
import { layoutFingerprint, layoutFits, renderTranslation, safeContainer, styleTranslation } from './renderer';
import { SelectionLookup } from './selection';

interface Block {
  element: HTMLElement; text: string; entry: string; revision: number; hint?: string;
  state: 'discovered' | 'queued' | 'translating' | 'rendered' | 'skipped' | 'failed';
  translation?: HTMLElement; attempts: number;
  skipReason?: 'language' | 'layout'; layoutFingerprint?: string; layoutTargets?: Element[];
}

export class Controller {
  private settings: Settings = { ...DEFAULT_SETTINGS, siteRules: {} };
  private allowed = false;
  private paused = false;
  private manual = false;
  private running = false;
  private generation = 0;
  private abort = new AbortController();
  private blocks = new Map<HTMLElement, Block>();
  private roots = new Set<Element>();
  private scanTimer = 0;
  private statusTimer = 0;
  private layoutTimer = 0;
  private layoutTargets = new Map<Element, Set<Block>>();
  private layoutObserver = new ResizeObserver(() => this.scheduleLayoutCheck());
  private routeTimer = 0;
  private scanning = false;
  private pumping = new Set<number>();
  private route = location.pathname + location.search;
  private engine = new LocalEngine('en');
  private engineError?: string;
  private contextAlive = true;
  private lookup = new SelectionLookup(() => this.engine, () => this.settings);
  private observer = new MutationObserver(records => {
    for (const record of records) {
      const target = record.target instanceof Element ? record.target : record.target.parentElement;
      if (!target || target.closest(OWNED)) continue;
      const changed = [...record.addedNodes, ...record.removedNodes];
      if (record.type === 'childList' && changed.length && changed.every(n => n instanceof Element && n.matches(OWNED))) continue;
      this.schedule(target);
    }
  });
  private intersection = new IntersectionObserver(entries => {
    for (const item of entries) if (item.isIntersecting) this.schedule(item.target);
  }, { rootMargin: '0px 0px 100% 0px' });
  private theme = matchMedia('(prefers-color-scheme: dark)');

  constructor() {
    document.addEventListener('visibilitychange', () => { if (!document.hidden && this.running) this.schedule(document.body); });
    window.addEventListener('resize', () => {
      this.restyle();
      for (const block of this.blocks.values()) if (block.state === 'skipped') block.state = 'discovered';
      if (this.running) this.schedule(document.body);
    });
    this.theme.addEventListener('change', () => this.restyle());
    window.addEventListener('scroll', () => this.scheduleLayoutCheck(), { capture: true, passive: true });
    window.addEventListener('pagehide', () => this.stop());
    window.addEventListener('pageshow', event => { if (event.persisted) void this.initialize(); });
  }

  async initialize(): Promise<void> {
    const result = await chrome.runtime.sendMessage({ type: 'PR_GET_SETTINGS' });
    if (result?.settings) this.apply(result.settings, result.autoAllowed === true);
  }

  apply(settings: Settings, allowed: boolean): void {
    if (settings.settingsVersion < this.settings.settingsVersion) return;
    const languageChanged = settingsChangeRequiresReset(this.settings, settings);
    const turnedOff = this.settings.autoTranslate && !settings.autoTranslate;
    const revoked = this.allowed && !allowed;
    const wasManual = this.manual;
    this.settings = settings; this.allowed = allowed;
    if (languageChanged || turnedOff || revoked) {
      this.stop(); this.manual = languageChanged && !turnedOff && !revoked && wasManual;
    }
    this.lookup.update();
    if (this.wantsRun()) this.start();
    else if (this.running) this.stop();
    this.restyle(); this.report();
  }

  private wantsRun(): boolean {
    return !this.paused && isSecureContext && (this.manual || (this.allowed && shouldAutoTranslate(this.settings, location.origin)));
  }

  translate(): PageStatus {
    this.paused = false; this.manual = true;
    return this.retry();
  }
  restore(): PageStatus { this.paused = true; this.manual = false; this.stop(); return this.status(); }
  retry(): PageStatus {
    this.engineError = undefined;
    for (const block of this.blocks.values()) if (block.state === 'failed') { block.state = 'discovered'; block.attempts = 0; }
    if (this.wantsRun()) this.start();
    return this.status();
  }
  clearCache(): void { this.engine.clearCache(); }

  private start(): void {
    if (!this.wantsRun()) { this.report(); return; }
    if (!this.running) {
      this.running = true; this.abort = new AbortController(); ++this.generation;
      this.observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'lang', 'aria-hidden', 'contenteditable', 'translate', 'role'] });
      this.routeTimer = window.setInterval(() => this.checkRoute(), 1000);
    }
    this.schedule(document.body);
  }

  private stop(): void {
    ++this.generation; this.running = false; this.abort.abort();
    this.observer.disconnect(); this.intersection.disconnect();
    this.layoutObserver.disconnect(); this.layoutTargets.clear(); clearTimeout(this.layoutTimer); this.layoutTimer = 0;
    clearTimeout(this.scanTimer); this.scanTimer = 0; clearInterval(this.routeTimer);
    this.roots.clear();
    for (const block of this.blocks.values()) block.translation?.remove();
    this.blocks.clear(); this.lookup.close();
    this.engine.dispose(); this.engine = new LocalEngine(this.settings.sourceLanguage);
    this.engineError = undefined; this.report();
  }

  private checkRoute(): void {
    const route = location.pathname + location.search;
    if (route === this.route) return;
    this.route = route; this.stop(); if (this.wantsRun()) this.start();
  }

  private schedule(root: Element): void {
    if (!this.running || !root.isConnected) return;
    this.roots.add(root);
    if (this.scanTimer || this.scanning) return;
    this.scanTimer = window.setTimeout(() => { this.scanTimer = 0; void this.scan(); }, 160);
  }

  private async scan(): Promise<void> {
    if (!this.running || document.hidden) return;
    this.checkRoute();
    if (!this.running || this.scanning) return;
    this.scanning = true;
    const generation = this.generation;
    const roots = this.roots.size > 12 || this.roots.has(document.body) ? [document.body] : [...this.roots];
    this.roots.clear();
    try {
      for (const [element, block] of this.blocks) if (!element.isConnected || excludedFromTranslation(element)) {
        block.translation?.remove(); this.unwatchLayout(block); this.intersection.unobserve(element); this.blocks.delete(element);
      }
      let count = 0;
      for (const root of roots) for (const element of candidates(root)) {
        if (!this.running || generation !== this.generation) return;
        const text = sourceText(element), entry = entryKey(element), hint = sourceLanguageHint(element);
        if (text.length < 3 || text.length > 20_000) continue;
        let block = this.blocks.get(element);
        if (!block) {
          if (this.blocks.size >= 3000 && !nearViewport(element)) continue;
          block = { element, text, entry, hint, revision: 1, state: 'discovered', attempts: 0 };
          this.blocks.set(element, block); this.intersection.observe(element);
        } else if (block.text !== text || block.entry !== entry || block.hint !== hint || (block.translation && !block.translation.isConnected)) {
          this.unwatchLayout(block);
          block.translation?.remove(); block.translation = undefined;
          block.text = text; block.entry = entry; block.hint = hint; block.revision++; block.attempts = 0; block.state = 'discovered'; block.skipReason = undefined;
        } else if (block.skipReason === 'layout' && block.layoutFingerprint !== layoutFingerprint(element)) {
          this.unwatchLayout(block); block.state = 'discovered'; block.skipReason = undefined;
        }
        if (block.state === 'discovered' && nearViewport(element)) block.state = 'queued';
        if (++count % 35 === 0) await new Promise(resolve => setTimeout(resolve, 0));
      }
    } finally {
      this.scanning = false; this.restyle(); this.report(); void this.pump();
      if (this.roots.size && this.running) this.schedule(document.body);
    }
  }

  private current(block: Block, generation: number, revision: number): boolean {
    return this.running && this.generation === generation && block.revision === revision && !this.abort.signal.aborted
      && block.element.isConnected && block.text === sourceText(block.element) && block.entry === entryKey(block.element)
      && !excludedFromTranslation(block.element) && block.hint === sourceLanguageHint(block.element)
      && this.wantsRun();
  }

  private async pump(): Promise<void> {
    const pumpGeneration = this.generation;
    if (this.pumping.has(pumpGeneration) || !this.running || document.hidden || this.engineError) return;
    this.pumping.add(pumpGeneration);
    try {
      while (this.running && this.generation === pumpGeneration && !document.hidden && !this.engineError) {
        const block = [...this.blocks.values()].find(b => b.state === 'queued' && nearViewport(b.element));
        if (!block) break;
        const generation = this.generation, revision = block.revision, signal = this.abort.signal;
        const engine = this.engine;
        block.state = 'translating'; this.report();
        try {
          const hint = sourceLanguageHint(block.element);
          if (hint && hint !== this.settings.sourceLanguage) { block.state = 'skipped'; block.skipReason = 'language'; continue; }
          if (!safeContainer(block.element)) { this.waitForLayout(block); continue; }
          const segments = await translatableSegments(block.text, this.settings.sourceLanguage, engine, signal, contextFor(block.element));
          if (!this.current(block, generation, revision)) continue;
          if (!segments.length) { block.state = 'skipped'; block.skipReason = 'language'; continue; }
          const translated: string[] = [];
          for (const sentence of segments) {
            const chunks = sentence.length <= 1800 ? [sentence] : sentences(sentence, this.settings.sourceLanguage).flatMap(s => s.match(/[\s\S]{1,800}/gu) ?? []);
            for (const chunk of chunks) translated.push(await engine.translate(chunk, signal));
          }
          if (!this.current(block, generation, revision)) continue;
          block.translation = renderTranslation(block.element, translated.join('\n'), this.settings) ?? undefined;
          if (block.translation) { this.unwatchLayout(block); block.state = 'rendered'; block.skipReason = undefined; }
          else this.waitForLayout(block);
        } catch (error) {
          if (!this.current(block, generation, revision) || (error instanceof Error && error.name === 'AbortError')) continue;
          if (error instanceof EngineError && ['needs_download', 'unsupported_browser', 'unsupported_pair', 'activation_required'].includes(error.code)) {
            this.engineError = error.code; block.state = 'failed';
          } else if (block.attempts++ < 1) { block.state = 'queued'; await new Promise(resolve => setTimeout(resolve, 400)); }
          else block.state = 'failed';
        } finally { this.report(); }
      }
    } finally {
      this.pumping.delete(pumpGeneration);
      if (this.running && this.generation === pumpGeneration && !document.hidden && !this.engineError && [...this.blocks.values()].some(b => b.state === 'queued' && nearViewport(b.element))) void this.pump();
    }
  }

  private restyle(): void {
    for (const block of this.blocks.values()) if (block.translation) {
      const width = Math.max(innerWidth, document.documentElement.scrollWidth);
      styleTranslation(block.translation, block.element, this.settings);
      if (!layoutFits(block.element, block.translation, width)) { block.translation.remove(); block.translation = undefined; this.waitForLayout(block); }
    }
  }

  private unwatchLayout(block: Block): void {
    for (const element of block.layoutTargets ?? []) {
      const blocks = this.layoutTargets.get(element);
      blocks?.delete(block);
      if (!blocks?.size) { this.layoutTargets.delete(element); this.layoutObserver.unobserve(element); }
    }
    block.layoutTargets = undefined; block.layoutFingerprint = undefined;
  }

  private waitForLayout(block: Block): void {
    this.unwatchLayout(block); block.state = 'skipped'; block.skipReason = 'layout';
    block.layoutFingerprint = layoutFingerprint(block.element); block.layoutTargets = [];
    for (let node: HTMLElement | null = block.element, i = 0; node && i < 5; node = node.parentElement, i++) {
      let blocks = this.layoutTargets.get(node);
      if (!blocks) { blocks = new Set(); this.layoutTargets.set(node, blocks); this.layoutObserver.observe(node); }
      blocks.add(block); block.layoutTargets.push(node);
    }
  }

  private scheduleLayoutCheck(): void {
    if (!this.running || this.layoutTimer || !this.layoutTargets.size) return;
    this.layoutTimer = window.setTimeout(() => {
      this.layoutTimer = 0;
      if (!this.running || document.hidden) return;
      for (const block of this.blocks.values()) if (block.skipReason === 'layout' && nearViewport(block.element)
        && block.layoutFingerprint !== layoutFingerprint(block.element)) {
        this.unwatchLayout(block); block.state = 'discovered'; block.skipReason = undefined; this.schedule(block.element);
      }
    }, 160);
  }

  status(): PageStatus {
    const result = { ...EMPTY_STATUS };
    for (const block of this.blocks.values()) {
      if (block.state === 'rendered' && block.translation?.isConnected) result.translated++;
      else if (block.state === 'skipped') result.skipped++;
      else if (block.state === 'failed') result.failed++;
      else if (['queued', 'translating'].includes(block.state)) result.pending++;
    }
    result.state = this.paused ? 'paused' : !isSecureContext ? 'unsupported' : this.engineError === 'needs_download' ? 'needs-download' : this.engineError ? 'unsupported' : !this.running ? 'off' : result.pending || this.scanning || this.scanTimer ? 'working' : result.failed ? 'partial' : 'ready';
    if (this.engineError) result.error = this.engineError;
    return result;
  }

  private report(): void {
    if (this.statusTimer || !this.contextAlive) return;
    this.statusTimer = window.setTimeout(() => {
      this.statusTimer = 0;
      try { void chrome.runtime.sendMessage({ type: 'PR_STATUS', status: this.status() }).catch(() => undefined); }
      catch { this.contextAlive = false; this.settings = { ...this.settings, selectionLookup: false }; this.stop(); this.lookup.update(); }
    }, 100);
  }
}
