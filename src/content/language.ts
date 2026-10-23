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

export async function languageGate(text: string, source: string, detector: LanguageDetector, signal: AbortSignal, context = ''): Promise<LanguageEvidence> {
  if (letterCount(text) < 2 || /^(?:https?:\/\/|www\.|@)|^[\d\s\p{P}\p{S}]+$/u.test(text)) return { result: 'non_match' };
  const ranking = await detector.detect(text, signal);
  const evidence = classify(ranking, source);
  if (evidence.result === 'non_match') return evidence;
  if (letterCount(text) >= 40) return evidence;
  // Medium multiword headings can be decisive without unrelated page context.
  if (letterCount(text) >= 24 && text.trim().split(/\s+/u).length >= 4 && evidence.result === 'match' && (ranking[0]?.confidence ?? 0) >= 0.98 && (ranking[0]!.confidence - (ranking[1]?.confidence ?? 0)) >= 0.8) return evidence;
  // A short proper name or isolated word is never auto-assumed to be English.
  if (source === 'en' && text.trim().split(/\s+/u).length < 3) return { result: 'unknown' };
  if (!context || letterCount(context) < 40) return { result: 'unknown' };
  const parts = sentences(context, source).filter(p => letterCount(p) >= 20).slice(0, 6);
  if (!parts.length) return { result: 'unknown' };
  for (const part of parts) {
    if (classify(await detector.detect(part, signal), source).result !== 'match') return { result: 'unknown' };
  }
  return { result: 'match', language: source };
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
      if ((await languageGate(part, source, detector, signal, letterCount(text) >= 40 ? text : context)).result === 'match') {
        accepted.push({ text: part, source }); break;
      }
    }
  }
  return accepted;
}
