// Standalone "Russian words" browser — a copy of Languru's Words tab, but for
// Russian (learned) → Hungarian (native). Runs on its OWN localhost port, fully
// separate from the Languru app. No database, no AI: the word list is a static
// file (data.js) served alongside the page. Zero dependencies (built-in http).

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';

const DIR = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 4300;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const server = createServer(async (req, res) => {
  try {
    let path = decodeURIComponent((req.url || '/').split('?')[0]);
    if (path === '/') path = '/index.html';
    // Prevent path traversal: resolve inside DIR only.
    const file = normalize(join(DIR, path));
    if (!file.startsWith(DIR)) { res.writeHead(403).end('Forbidden'); return; }
    const ext = file.slice(file.lastIndexOf('.'));
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Orosz szavak — http://localhost:${PORT}`);
});
