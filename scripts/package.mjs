import { zipSync } from 'fflate';
import { readdir, readFile, mkdir, writeFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const files = {};
// ZIP timestamps store local wall time, without a timezone.
const stamp = new Date(2020, 0, 1, 0, 0, 0);
async function collect(directory, prefix = '') {
  for (const name of (await readdir(directory)).sort()) {
    const absolute = path.join(directory, name), stat = await lstat(absolute);
    if (stat.isSymbolicLink()) throw new Error(`Refusing symbolic link: ${name}`);
    const relative = prefix + name;
    if (stat.isDirectory()) await collect(absolute, relative + '/');
    else files[relative] = [new Uint8Array(await readFile(absolute)), { mtime: stamp }];
  }
}
await collect(path.join(root, 'dist'));
for (const [from, to] of [['docs/INSTALL.md', 'INSTALL.md'], ['LICENSE', 'LICENSE'], ['PRIVACY.md', 'PRIVACY.md']]) {
  files[to] = [new Uint8Array(await readFile(path.join(root, from))), { mtime: stamp }];
}
if (!files['manifest.json']) throw new Error('Missing manifest at archive root');
const directory = path.join(root, 'releases'); await mkdir(directory, { recursive: true });
const name = `parallel-read-${pkg.version}.zip`;
const archive = zipSync(files, { level: 9 });
await writeFile(path.join(directory, name), archive);
const checksum = createHash('sha256').update(archive).digest('hex');
await writeFile(path.join(directory, name + '.sha256'), `${checksum}  ${name}\n`);
console.log(`Packaged ${name}: ${archive.length} bytes, ${Object.keys(files).length} files`);
console.log(`SHA256 ${checksum}`);
