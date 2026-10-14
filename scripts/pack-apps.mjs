import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative, join } from 'node:path';

const root = resolve(process.argv[2] || 'apps');
const output = resolve(process.argv[3] || 'apps/dist');
await mkdir(output, { recursive: true });
for (const entry of await readdir(root, { withFileTypes: true })) {
  if (!entry.isDirectory() || ['dist', 'shared'].includes(entry.name)) continue;
  const directory = join(root, entry.name);
  const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
  const files = {};
  async function collect(folder) {
    for (const item of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, item.name);
      if (item.isSymbolicLink()) throw new Error(`Symlink not allowed: ${path}`);
      if (item.isDirectory()) await collect(path);
      else if (item.name !== 'manifest.json') {
        files[relative(directory, path).replaceAll('\\', '/')] = (await readFile(path)).toString('base64');
      }
    }
  }
  await collect(directory);
  for (const name of ['ui.js', 'common.css']) {
    files[name] = (await readFile(resolve('apps/shared', name))).toString('base64');
  }
  await writeFile(join(output, `${manifest.id}.orbit`), JSON.stringify({ manifest, files }));
  console.log(`Packed ${manifest.id} ${manifest.version}`);
}
