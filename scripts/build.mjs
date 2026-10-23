import { build, context } from 'esbuild';
import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
await rm(path.join(root, 'dist'), { recursive: true, force: true });
await mkdir(path.join(root, 'dist'), { recursive: true });
await cp(path.join(root, 'src/manifest.json'), path.join(root, 'dist/manifest.json'));
await cp(path.join(root, 'assets/icons'), path.join(root, 'dist/icons'), { recursive: true });
await mkdir(path.join(root, 'dist/images'), { recursive: true });
await cp(path.join(root, 'assets/reading-example.jpg'), path.join(root, 'dist/images/reading-example.jpg'));
await cp(path.join(root, 'src/providers/offscreen.html'), path.join(root, 'dist/offscreen.html'));
for (const name of ['popup.html', 'options.html', 'ui.css']) {
  await cp(path.join(root, 'src/ui', name), path.join(root, 'dist', name));
}
const common = { loader: { '.png': 'binary' }, bundle: true, target: 'chrome138', minify: false, sourcemap: false, logLevel: 'info' };
const builds = [
  { ...common, entryPoints: [path.join(root, 'src/content/index.ts')], outfile: path.join(root, 'dist/content.js'), format: 'iife' },
  { ...common, entryPoints: { offscreen: path.join(root, 'src/providers/offscreen.ts'), 'native-worker': path.join(root, 'src/providers/native-worker.ts'), background: path.join(root, 'src/background/index.ts'), popup: path.join(root, 'src/ui/popup.ts'), options: path.join(root, 'src/ui/options.ts') }, outdir: path.join(root, 'dist'), format: 'esm', splitting: true },
];
if (process.argv.includes('--watch')) {
  for (const options of builds) { const c = await context(options); await c.watch(); }
} else {
  for (const options of builds) await build(options);
  const manifest = JSON.parse(await readFile(path.join(root, 'dist/manifest.json'), 'utf8'));
  console.log(`Built ${manifest.name} ${manifest.version} → dist/`);
}
