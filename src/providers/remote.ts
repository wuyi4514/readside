import type { DetectorAPI, NativeDetector, NativeTranslator, TranslatorAPI } from './native-types';

/** Extension-internal RPC. Text stays in Chrome; each content generation owns its sessions. */
export function remoteAPIs(): { translator: TranslatorAPI; detector: DetectorAPI } {
  const client = crypto.randomUUID();
  async function call(op: string, source = '', target = '', text = '', signal?: AbortSignal): Promise<unknown> {
    signal?.throwIfAborted(); const request = crypto.randomUUID();
    const cancel = () => { void chrome.runtime.sendMessage({ type: 'PR_NATIVE_CANCEL', request, client }).catch(() => undefined); };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      const response = await chrome.runtime.sendMessage({ type: 'PR_NATIVE', request, client, op, source, target, text });
      signal?.throwIfAborted();
      if (!response?.ok) { const error = new Error(response?.message ?? 'Local engine unavailable'); error.name = response?.name ?? 'Error'; throw error; }
      return response.value;
    } finally { signal?.removeEventListener('abort', cancel); }
  }
  return {
    translator: {
      availability: async ({ sourceLanguage, targetLanguage }) => call('availability', sourceLanguage, targetLanguage) as ReturnType<TranslatorAPI['availability']>,
      create: async ({ sourceLanguage, targetLanguage, signal }) => {
        await call('open-translator', sourceLanguage, targetLanguage, '', signal);
        return {
          translate: (text, options) => call('translate', sourceLanguage, targetLanguage, text, options?.signal) as Promise<string>,
          destroy: () => { void call('close-translator', sourceLanguage, targetLanguage).catch(() => undefined); },
        } satisfies NativeTranslator;
      },
    },
    detector: {
      availability: () => call('detector-availability') as ReturnType<DetectorAPI['availability']>,
      create: async options => {
        await call('open-detector', '', '', '', options?.signal);
        return {
          detect: (text, options) => call('detect', '', '', text, options?.signal) as ReturnType<NativeDetector['detect']>,
          destroy: () => { void call('close-detector').catch(() => undefined); },
        } satisfies NativeDetector;
      },
    },
  };
}
