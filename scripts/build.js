import { copyFile, mkdir, rm } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const output = new URL('dist/', root);
await rm(output, { recursive: true, force: true });
await mkdir(new URL('public/', output), { recursive: true });
for (const file of ['.nojekyll', 'index.html', 'public/styles.css', 'public/app.js', 'public/board-model.js']) {
  await copyFile(new URL(file, root), new URL(file, output));
}
