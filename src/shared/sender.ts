export function isExtensionUI(sender: chrome.runtime.MessageSender, extensionId: string): boolean {
  if (sender.id !== extensionId || !sender.url) return false;
  const url = sender.url.split(/[?#]/)[0];
  return url === `chrome-extension://${extensionId}/options.html` || url === `chrome-extension://${extensionId}/popup.html`;
}
