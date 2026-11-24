import { copyFile, mkdir } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
await mkdir(new URL('dist/public/', root), { recursive: true });
for (const file of ['.nojekyll', 'index.html', 'public/styles.css', 'public/app.js', 'public/model.js']) {
  await copyFile(new URL(file, root), new URL('dist/' + file, root));
}
