import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { access, mkdir, open } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const endpoint = 'http://127.0.0.1:9327';
const defaults = { darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', linux: '/usr/bin/google-chrome', win32: `${process.env.PROGRAMFILES ?? 'C:\\Program Files'}\\Google\\Chrome\\Application\\chrome.exe` };
const executable = process.env.CHROME_PATH ?? defaults[process.platform];
if (!executable) throw new Error('Set CHROME_PATH to your desktop Google Chrome executable.');
await access(path.join(root, 'dist/manifest.json'));
await mkdir(path.join(root, '.private'), { recursive: true });
try { await fetch(endpoint + '/json/version'); }
catch {
  await access(executable);
  const log = await open(path.join(root, '.private/chrome.log'), 'a');
  const child = spawn(executable, [`--user-data-dir=${path.join(root, '.private/chrome-profile')}`, '--remote-debugging-port=9327', '--enable-unsafe-extension-debugging', '--no-first-run', '--no-default-browser-check', '--disable-sync', 'about:blank'], { detached: true, stdio: ['ignore', log.fd, log.fd] });
  child.unref(); await log.close();
}
let available = false;
for (let attempt = 0; attempt < 40; attempt++) {
  try { await fetch(endpoint + '/json/version'); available = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 250)); }
}
if (!available) throw new Error('Test Chrome could not start on port 9327.');
const browser = await chromium.connectOverCDP(endpoint);
const cdp = await browser.newBrowserCDPSession();
const extensions = await cdp.send('Extensions.getExtensions');
for (const extension of extensions.extensions) if (['Parallel Read · 对照读', '伴读 · Readside'].includes(extension.name)) await cdp.send('Extensions.uninstall', { id: extension.id });
const { id } = await cdp.send('Extensions.loadUnpacked', { path: path.join(root, 'dist') });
const page = await browser.contexts()[0].newPage();
await page.goto(`chrome-extension://${id}/options.html`);
console.log(`Isolated test Chrome: ${endpoint}\nPrepare local models in the opened settings tab, then run npm run test:browser.`);
await browser.close();
