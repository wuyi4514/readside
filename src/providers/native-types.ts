export type Availability = 'unavailable' | 'downloadable' | 'downloading' | 'available';
export interface ProgressMonitor { addEventListener(type: 'downloadprogress', listener: (event: { loaded: number }) => void): void }
export interface NativeTranslator {
  translate(text: string, options?: { signal?: AbortSignal }): Promise<string>;
  destroy(): void;
}
export interface NativeDetector {
  detect(text: string, options?: { signal?: AbortSignal }): Promise<Array<{ detectedLanguage: string; confidence: number }>>;
  destroy(): void;
}
interface CreateOptions { signal?: AbortSignal; monitor?: (monitor: ProgressMonitor) => void }
export interface TranslatorAPI {
  availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<Availability>;
  create(options: CreateOptions & { sourceLanguage: string; targetLanguage: string }): Promise<NativeTranslator>;
}
export interface DetectorAPI {
  availability(): Promise<Availability>;
  create(options?: CreateOptions): Promise<NativeDetector>;
}
export function nativeAPIs(): { translator?: TranslatorAPI; detector?: DetectorAPI } {
  const scope = globalThis as typeof globalThis & { Translator?: TranslatorAPI; LanguageDetector?: DetectorAPI };
  return { translator: scope.Translator, detector: scope.LanguageDetector };
}
