import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SelectionLookup } from '../src/content/selection';
import { classify, classifyLookup } from '../src/content/language';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import type { DocumentEngine } from '../src/providers/pool';

let lookup: SelectionLookup;
let disable: () => void;
const translate = vi.fn();
let range: Range;
const result = () => document.querySelector('[data-pr-owned="lookup"]')?.shadowRoot;

beforeEach(() => {
  const state = { enabled: true }; disable = () => { state.enabled = false; }; translate.mockReset().mockResolvedValue('这是一段译文。');
  vi.stubGlobal('isSecureContext', true);
  document.body.innerHTML = '<p>Reading a sentence across\nsource lines should work.</p>';
  range = document.createRange(); range.selectNodeContents(document.querySelector('p')!);
  Object.defineProperty(Range.prototype, 'getBoundingClientRect', {configurable: true, value: () => ({left:30,top:40,bottom:60,right:500,width:470,height:20,x:30,y:40,toJSON(){}})});
  vi.stubGlobal('getSelection', () => ({rangeCount:1,isCollapsed:false,getRangeAt:()=>range,toString:()=>range.toString().replace(/\s+/gu,' ').trim()}));
  const engine = {detect:async()=>[{detectedLanguage:'en',confidence:.623},{detectedLanguage:'fr',confidence:.083}],translate} as unknown as DocumentEngine;
  lookup = new SelectionLookup(() => engine, () => ({...DEFAULT_SETTINGS,selectionLookup:state.enabled}));
});
afterEach(() => { disable(); lookup?.close(); document.body.replaceChildren(); Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect'); vi.unstubAllGlobals(); });
async function captureAndOpen(): Promise<void> {
  document.dispatchEvent(new Event('pointerup'));
  await vi.waitFor(() => expect(result()?.querySelector('button')).toBeTruthy());
  (result()!.querySelector('button') as HTMLButtonElement).click();
}

describe('rendered selection and DOM range snapshots', () => {
  it('translates the complete rendered sentence even when the DOM retains a soft line break', async () => {
    await captureAndOpen();
    await vi.waitFor(() => expect(translate).toHaveBeenCalledWith('Reading a sentence across source lines should work.','en',expect.any(AbortSignal)));
    await vi.waitFor(() => expect(result()?.querySelector('.result')?.textContent).toBe('这是一段译文。'));
    expect(result()?.querySelector('.source')?.textContent).toBe('Reading a sentence across source lines should work.');
  });
  it('allows a multi-paragraph rendered selection with block separators', async () => {
    document.body.innerHTML = '<article><p>Reading one sentence.</p><p>Then another sentence.</p></article>';
    range.selectNodeContents(document.querySelector('article')!);
    vi.stubGlobal('getSelection', () => ({rangeCount:1,isCollapsed:false,getRangeAt:()=>range,toString:()=> 'Reading one sentence.\n\nThen another sentence.'}));
    await captureAndOpen();
    await vi.waitFor(() => expect(translate).toHaveBeenCalledWith('Reading one sentence.\n\nThen another sentence.','en',expect.any(AbortSignal)));
  });
  it('still rejects a genuinely changed source before translation starts', async () => {
    document.dispatchEvent(new Event('pointerup')); await vi.waitFor(()=>expect(result()?.querySelector('button')).toBeTruthy());
    document.querySelector('p')!.firstChild!.textContent = 'The selected content was replaced.';
    (result()!.querySelector('button') as HTMLButtonElement).click();
    expect(translate).not.toHaveBeenCalled(); expect(result()).toBeUndefined();
  });
  it('discards a late translation when the source changes during the request', async () => {
    let complete!: (value:string)=>void; translate.mockImplementation(()=>new Promise<string>(resolve=>{complete=resolve;}));
    await captureAndOpen(); await vi.waitFor(()=>expect(translate).toHaveBeenCalledOnce());
    document.querySelector('p')!.firstChild!.textContent = 'The selected content was replaced.';
    complete('过期的译文'); await vi.waitFor(()=>expect(result()).toBeUndefined());
    expect(document.body.textContent).not.toContain('过期的译文');
  });
  it('keeps selections crossing private editor content excluded', async () => {
    document.body.innerHTML = '<article><p>Public text.</p><div contenteditable="true">PRIVATE</div></article>';
    range.selectNodeContents(document.querySelector('article')!);
    document.dispatchEvent(new Event('pointerup')); await new Promise(r=>setTimeout(r,120));
    expect(result()).toBeUndefined(); expect(translate).not.toHaveBeenCalled();
  });
});

describe('deliberate lookup language evidence', () => {
  it('accepts a clear leading language for lookup without relaxing automatic translation', () => {
    const ranking=[{detectedLanguage:'en',confidence:.623},{detectedLanguage:'fr',confidence:.083}];
    expect(classifyLookup(ranking,'en')).toEqual({result:'match',language:'en'});
    expect(classify(ranking,'en').result).toBe('unknown');
  });
  it('keeps ambiguity and a different leading language explicit', () => {
    expect(classifyLookup([{detectedLanguage:'ky',confidence:.5}],'en').result).toBe('unknown');
    expect(classifyLookup([{detectedLanguage:'en',confidence:.52},{detectedLanguage:'fr',confidence:.49}],'en').result).toBe('unknown');
    expect(classifyLookup([{detectedLanguage:'fr',confidence:.7},{detectedLanguage:'en',confidence:.1}],'en')).toEqual({result:'non_match',language:'fr'});
  });
});
