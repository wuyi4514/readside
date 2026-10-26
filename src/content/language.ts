import type { LanguageCandidate } from '../providers/local';

export interface LanguageEvidence { result: 'match' | 'non_match' | 'unknown'; language?: string }
export interface LanguageDetector { detect(text: string, signal: AbortSignal): Promise<LanguageCandidate[]> }

export const letterCount = (text: string): number => (text.match(/\p{L}/gu) ?? []).length;
export function sentences(text: string, language: string): string[] {
  return [...new Intl.Segmenter(language, { granularity: 'sentence' }).segment(text)].map(s => s.segment.trim()).filter(Boolean);
}

export function classify(candidates: LanguageCandidate[], source: string): LanguageEvidence {
  const [first, second] = candidates;
  if (!first || first.detectedLanguage === 'und' || first.confidence < 0.85 || first.confidence - (second?.confidence ?? 0) < 0.2) return { result: 'unknown' };
  const language = first.detectedLanguage.split('-')[0]!;
  return { result: language === source.split('-')[0] ? 'match' : 'non_match', language };
}

/** A deliberate lookup can use a clearly leading selected language. Automatic
 * page filtering keeps the stricter classify() threshold. Never default to the
 * first selected language when the ranking is ambiguous or leads elsewhere. */
export function classifyLookup(candidates: LanguageCandidate[], source: string): LanguageEvidence {
  const [first, second] = candidates;
  if (!first || first.detectedLanguage === 'und' || first.confidence <= .5 || first.confidence - (second?.confidence ?? 0) < .2) return { result: 'unknown' };
  const language = first.detectedLanguage.split('-')[0]!;
  return { result: language === source.split('-')[0] ? 'match' : 'non_match', language };
}

export async function languageGate(text: string, source: string, detector: LanguageDetector, signal: AbortSignal, context = '', shortLabels = false): Promise<LanguageEvidence> {
  if (letterCount(text) < 2 || /^(?:https?:\/\/|www\.|@)|^[\d\s\p{P}\p{S}]+$/u.test(text)) return { result: 'non_match' };
  if (['en', 'fr', 'es', 'de'].includes(source)
    && (text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0) > (text.match(/\p{Script=Latin}/gu)?.length ?? 0)) return { result: 'non_match' };
  const ranking = await detector.detect(text, signal);
  const evidence = classify(ranking, source);
  if (evidence.result === 'non_match') return evidence;
  if (letterCount(text) >= 40 && evidence.result !== 'unknown') return evidence;
  // Medium multiword headings can be decisive without unrelated page context.
  if (letterCount(text) >= 24 && text.trim().split(/\s+/u).length >= 4 && evidence.result === 'match' && (ranking[0]?.confidence ?? 0) >= 0.98 && (ranking[0]!.confidence - (ranking[1]?.confidence ?? 0)) >= 0.8) return evidence;
  // Short UI labels need contextual evidence; a decisive mismatch still wins.
  if (!shortLabels && source === 'en' && text.trim().split(/\s+/u).length < 3) return { result: 'unknown' };
  if (shortLabels && letterCount(text) < 40 && evidence.result === 'match' && (ranking[0]?.confidence ?? 0) >= .98) return evidence;
  if (!context || letterCount(context) < 40) return { result: 'unknown' };
  const parts = sentences(context, source).filter(p => letterCount(p) >= 20).slice(0, 6);
  if (!parts.length) return { result: 'unknown' };
  let matches = 0;
  for (const part of parts) {
    if (classify(await detector.detect(part, signal), source).result === 'match') matches++;
  }
  return matches / parts.length >= .8 ? { result: 'match', language: source } : { result: 'unknown' };
}

export async function translatableSegments(text: string, source: string, detector: LanguageDetector, signal: AbortSignal, context = ''): Promise<string[]> {
  const parts = sentences(text, source);
  const fullContext = letterCount(text) >= 40 ? text : context;
  const accepted: string[] = [];
  for (const part of parts) {
    if ((await languageGate(part, source, detector, signal, fullContext)).result === 'match') accepted.push(part);
  }
  return accepted;
}

/** Route each sentence independently; never infer a language from the document's lang. */
export async function selectedSegments(text: string, sources: readonly string[], detector: LanguageDetector, signal: AbortSignal, context = ''): Promise<Array<{ text: string; source: string }>> {
  const accepted: Array<{ text: string; source: string }> = [];
  for (const part of sentences(text, sources[0] ?? 'en')) {
    for (const source of sources) {
      if ((await languageGate(part, source, detector, signal, context || (letterCount(text) >= 40 ? text : ''), true)).result === 'match') {
        accepted.push({ text: part, source }); break;
      }
    }
  }
  return accepted;
}
