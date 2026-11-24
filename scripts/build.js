import { copyFile, mkdir } from 'node:fs/promises';

await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
for (const file of ['index.html', 'styles.css', 'app.js', 'model.js']) {
  await copyFile(new URL('../public/' + file, import.meta.url), new URL('../dist/' + file, import.meta.url));
}
