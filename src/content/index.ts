import { Controller } from './controller';
import type { Message } from '../shared/messages';

// Keep the existing guard so reinjection cannot create a second controller.
const scope = globalThis as typeof globalThis & { __parallelReadV1?: Controller };
if (!scope.__parallelReadV1 && document.body) {
  // A reloaded extension gets a new isolated world; remove its prior visual output.
  document.querySelectorAll('[data-pr-owned]').forEach(node => node.remove());
  const controller = new Controller(); scope.__parallelReadV1 = controller;
  chrome.runtime.onMessage.addListener((message: Message, sender, reply) => {
    if (sender.id !== chrome.runtime.id || !message || typeof message !== 'object') return;
    switch (message.type) {
      case 'PR_GET_STATUS': reply({ status: controller.status() }); break;
      case 'PR_SETTINGS': controller.apply(message.settings, message.autoAllowed === true); reply({ status: controller.status() }); break;
      case 'PR_TRANSLATE': reply({ status: controller.translate() }); break;
      case 'PR_RESTORE': reply({ status: controller.restore() }); break;
      case 'PR_RETRY': reply({ status: controller.retry() }); break;
      case 'PR_CLEAR_CACHE': controller.clearCache(); reply({ ok: true }); break;
    }
  });
  void controller.initialize().catch(() => undefined);
}
