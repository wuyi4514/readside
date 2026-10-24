import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings, shouldAutoTranslate } from '../src/shared/settings';
import { TextCache } from '../src/shared/cache';
import { backgroundFor, contrast, parseColor, secondaryColor } from '../src/content/color';
import { classify, languageGate, translatableSegments, selectedSegments } from '../src/content/language';
import { candidates, entryKey, sourceText } from '../src/content/extractor';

describe('settings and rules', () => {
  it('migrates the old language and preserves explicit website scope', () => {
    const previous = sanitizeSettings({ schemaVersion: 1, sourceLanguage: 'fr', autoTranslate: true, autoTranslateAllPages: false, siteRules: { 'https://example.com': 'always' } });
    expect(previous.schemaVersion).toBe(2); expect(previous.sourceLanguages).toEqual(['fr']); expect(previous.autoTranslate).toBe(true); expect(previous.autoTranslateAllPages).toBe(false);
    const multiple = sanitizeSettings({ ...previous, sourceLanguages: ['fr','en','fr','bogus','ko'] });
    expect(multiple.sourceLanguages).toEqual(['en','fr','ko']);
    expect(sanitizeSettings({ sourceLanguages: ['zh-CN'], targetLanguage: 'en' })).toMatchObject({ sourceLanguages: ['zh-CN'], targetLanguage: 'en' });
    expect(sanitizeSettings({ sourceLanguages: [] }).sourceLanguages).toEqual(['en']);
  });
  it('global off wins over an always rule; document pause wins over global on', () => {
    const s = sanitizeSettings({ ...DEFAULT_SETTINGS, siteRules: { 'https://example.com': 'always' } });
    expect(shouldAutoTranslate(s, 'https://example.com')).toBe(false);
    s.autoTranslate = true;
    expect(shouldAutoTranslate(s, 'https://example.com')).toBe(true);
    expect(shouldAutoTranslate(s, 'https://example.com', true)).toBe(false);
  });
  it('site exceptions do not silently cover subdomains', () => {
    const s = sanitizeSettings({ ...DEFAULT_SETTINGS, autoTranslate: true, autoTranslateAllPages: true, siteRules: { 'https://example.com': 'never' } });
    expect(shouldAutoTranslate(s, 'https://example.com')).toBe(false);
    expect(shouldAutoTranslate(s, 'https://blog.example.com')).toBe(true);
  });
  it('unknown storage schema fails closed, invalid languages cannot change the target', () => {
    const s = sanitizeSettings({ schemaVersion: 20, autoTranslate: true, sourceLanguage: '??', targetLanguage: 'unknown', translationScale: 12, siteRules: { 'javascript:bad': 'always', 'https://example.com/path': 'never' } });
    expect(s.autoTranslate).toBe(false); expect(s.sourceLanguages).toEqual(['en']); expect(s.targetLanguage).toBe('zh-CN'); expect(s.translationScale).toBe(1); expect(s.siteRules).toEqual({});
  });
});

describe('automatic translation scope', () => {
  it('only runs at an explicitly allowed origin when all-sites mode is off', () => {
    const settings = sanitizeSettings({ ...DEFAULT_SETTINGS, autoTranslate: true, autoTranslateAllPages: false, siteRules: { 'https://example.com': 'always' } });
    expect(shouldAutoTranslate(settings, 'https://example.com')).toBe(true);
    expect(shouldAutoTranslate(settings, 'https://other.example')).toBe(false);
    settings.autoTranslateAllPages = true;
    expect(shouldAutoTranslate(settings, 'https://other.example')).toBe(true);
    settings.autoTranslate = false;
    expect(shouldAutoTranslate(settings, 'https://example.com')).toBe(false);
  });
  it('preserves the old scope on upgrade while fresh installations start with explicit access', () => {
    expect(sanitizeSettings(DEFAULT_SETTINGS).autoTranslateAllPages).toBe(false);
    expect(sanitizeSettings({ schemaVersion: 1, autoTranslate: true }).autoTranslateAllPages).toBe(true);
  });
});

describe('bounded local cache' , () => {
  it('evicts the least recently used text rather than the most recently read', () => {
    const cache = new TextCache<string>(2,1000); cache.set('first','one'); cache.set('second','two'); cache.get('first'); cache.set('third','three');
    expect(cache.get('second')).toBeUndefined(); expect(cache.get('first')).toBe('one');
  });
  it('rejects oversized entries, replaces safely, and clears', () => {
    const cache = new TextCache<string>(5,60); cache.set('x','old'); cache.set('x','new'); cache.set('too-big','x'.repeat(100));
    expect(cache.get('x')).toBe('new'); expect(cache.get('too-big')).toBeUndefined(); cache.clear(); expect(cache.get('x')).toBeUndefined();
  });
});

describe('readable secondary colors', () => {
  it.each([[[20,30,25],[255,255,255]],[[235,240,230],[29,37,33]],[[140,140,140],[220,220,220]]])('meets ordinary-text contrast for %j on %j', (fg,bg) => {
    const color = parseColor(secondaryColor(fg as [number,number,number],bg as [number,number,number]));
    expect(contrast(color!,bg as [number,number,number])).toBeGreaterThanOrEqual(4.5);
  });
});

describe('language filtering', () => {
  const signal = new AbortController().signal;
  const en = 'This reading tool helps people understand useful ideas and learn something new every day.';
  const fr = 'Nous voulons découvrir de nouvelles idées avec les personnes qui nous entourent.';
  const detector = { detect: async (text:string) => [{ detectedLanguage: text === fr ? 'fr' : 'en', confidence: .99 }, { detectedLanguage: 'und', confidence: .01 }] };
  it('requires a confident, well-separated ranking', () => {
    expect(classify([{detectedLanguage:'en',confidence:.7},{detectedLanguage:'fr',confidence:.29}],'en').result).toBe('unknown');
    expect(classify([{detectedLanguage:'fr',confidence:.99}],'en').result).toBe('non_match');
  });
  it('keeps isolated ambiguous short words unknown even in an English context', async () => {
    expect((await languageGate('Paris','en',detector,signal,en)).result).toBe('unknown');
  });
  it('does not translate the French sentence in a mixed-language block', async () => {
    expect(await translatableSegments(`${en} ${fr}`,'en',detector,signal)).toEqual([en]);
  });
  it('routes selected languages separately and keeps unselected languages out', async () => {
    expect(await selectedSegments(`${en} ${fr}`, ['en','fr'], detector, signal)).toEqual([{ text: en, source: 'en' },{ text: fr, source: 'fr' }]);
    expect(await selectedSegments(`${en} ${fr}`, ['fr'], detector, signal)).toEqual([{ text: fr, source: 'fr' }]);
  });
  it('short titles inherit only consistent local evidence', async () => {
    expect((await languageGate('A clearer view','en',detector,signal,en)).result).toBe('match');
    expect((await languageGate('A clearer view','en',detector,signal,fr)).result).toBe('unknown');
  });
});

describe('source ownership and privacy', () => {
  it('extracts natural text while excluding own translation, hidden text and sensitive inputs', () => {
    const element = document.createElement('p');
    element.innerHTML = 'Read <strong>good ideas</strong> with <a href="#a">your team</a>.<span data-pr-owned="translation">中文译文</span><span hidden>HIDDEN</span><textarea>PRIVATE</textarea><span style="display:none">HIDDEN CSS</span>';
    document.body.append(element);
    expect(sourceText(element)).toBe('Read good ideas with your team.');
    expect(element.querySelector('strong')?.textContent).toBe('good ideas'); element.remove();
  });
});

describe('generic content ownership', () => {
  it('finds natural article blocks without site classes or test attributes', () => {
    document.body.innerHTML = '<article><header><div id="author">Someone who shares interesting ideas about the world</div><a rel="bookmark" href="/notes/42">Today</a></header><div id="text">A useful thought about reading and learning from the people around us.</div><button>Like 12</button></article>';
    const text = document.querySelector('#text')!;
    const found = [...candidates(document.body)];
    expect(found).toContain(text); expect(found).toContain(document.querySelector('#author')); expect(found).toContain(document.querySelector('button'));
    const before = entryKey(text);
    document.querySelector('a')!.setAttribute('href','/notes/43');
    expect(entryKey(text)).not.toBe(before);
    document.body.replaceChildren();
  });
});


describe('text columns', () => {
  it('extracts one complete text block instead of translating each visual line twice', () => {
    document.body.innerHTML = '<div id="text-column" style="display:flex;flex-direction:column"><span style="display:block">Reading helps people discover new ideas.</span><span style="display:block">It also gives us a chance to understand one another.</span></div>';
    const found = [...candidates(document.body)];
    expect(found).toHaveLength(1); expect(found[0]?.id).toBe('text-column');
    document.body.replaceChildren();
  });
});

describe('composited reading backgrounds', () => {
  it('composites translucent hover overlays rather than treating them as opaque black or white', () => {
    document.body.innerHTML = '<article style="background:rgb(255,255,255)"><div style="background:rgba(0,0,0,.03)"><p>Reading should remain clear when hovering over a card.</p></div></article>';
    const bg = backgroundFor(document.querySelector('p')!);
    expect(bg).toEqual([247,247,247]);
    expect(contrast(parseColor(secondaryColor([15,20,25],bg))!, bg)).toBeGreaterThanOrEqual(4.5);
    document.querySelector('article')!.style.background = 'rgb(0,0,0)';
    document.querySelector('div')!.style.background = 'rgba(255,255,255,.03)';
    expect(backgroundFor(document.querySelector('p')!)).toEqual([8,8,8]);
    document.body.replaceChildren();
  });
});

describe('full visible text discovery', () => {
  it('includes navigation, buttons, short labels and table cells without rewriting their children', async () => {
    const { restoreSourceRuns } = await import('../src/content/extractor');
    document.body.innerHTML = '<nav><a>News</a><button><span>Research</span><svg></svg></button></nav><div>Before<h2>Heading</h2>After</div><table><tbody><tr><td>Available</td></tr></tbody></table><input value="PRIVATE"><div hidden>SECRET</div>';
    const button = document.querySelector('button')!, label = button.firstElementChild;
    const all = [...candidates(document.body)].map(sourceText);
    expect(all).toEqual(expect.arrayContaining(['News','Research','Before','Heading','After','Available']));
    expect(all.join(' ')).not.toMatch(/PRIVATE|SECRET/);
    expect(button.firstElementChild).toBe(label);
    restoreSourceRuns(); expect(document.querySelector('[data-pr-source]')).toBeNull();
    expect(document.body.textContent).toContain('BeforeHeadingAfter'); document.body.replaceChildren();
  });
  it('uses language evidence for short labels while rejecting a different detected language', async () => {
    const detector = { detect: async (text: string) => [{detectedLanguage: text === 'Bonjour' ? 'fr' : 'en',confidence:.99}] };
    const signal = new AbortController().signal;
    expect(await selectedSegments('News',['en'],detector,signal)).toEqual([{text:'News',source:'en'}]);
    expect(await selectedSegments('Bonjour',['en'],detector,signal)).toEqual([]);
  });
});

describe('uncertain headings and script boundaries', () => {
  it('uses an independent paragraph when a medium heading has uncertain language', async () => {
    const heading = 'Harness design for long-running application development';
    const context = 'Good evaluations help teams build reliable applications and understand the world.';
    const detector = {detect:async(text:string)=>[{detectedLanguage:'en',confidence:text===heading?.5:.99}]};
    expect(await selectedSegments(heading,['en'],detector,new AbortController().signal,context)).toEqual([{text:heading,source:'en'}]);
  });
  it('cannot infer a Latin source for Chinese text from an English context', async () => {
    const detector={detect:async()=>[{detectedLanguage:'und',confidence:.5}]};
    expect(await selectedSegments('这段中文应该保持原样',['en'],detector,new AbortController().signal,'Good evaluations help teams build reliable applications and understand the world.')).toEqual([]);
  });
});
