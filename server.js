#!/usr/bin/env node

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const directory = process.argv[2] === 'dist' ? './dist/' : './';
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';
const resources = new Map([
  ['/', ['index.html', 'text/html']],
  ['/public/styles.css', ['public/styles.css', 'text/css']],
  ['/public/app.js', ['public/app.js', 'text/javascript']],
  ['/public/board-model.js', ['public/board-model.js', 'text/javascript']],
]);

const server = createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end();
    return;
  }

  const resource = resources.get(request.url.split('?')[0]);
  if (!resource) {
    response.writeHead(404).end();
    return;
  }

  const [file, contentType] = resource;
  try {
    const body = await readFile(new URL(directory + file, import.meta.url));
    response.writeHead(200, {
      'Content-Type': contentType + '; charset=utf-8',
      'Content-Length': body.length,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-cache',
    }).end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(500).end('File unavailable');
  }
});

server.listen(port, host, () => console.log('Cashflow Studio → http://' + host + ':' + port));
