// Ember Yard — a small static file server for local play-testing.
// Serves game/ on http://localhost:8080 (or --port N) so the game can be
// opened in a desktop browser with no build step. It answers only files
// inside game/, sends the MIME types a browser game needs, and never
// reaches the network. Not a production server.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const gameRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'game');
const argv = process.argv.slice(2);
const portFlag = argv.indexOf('--port');
const wanted = portFlag === -1 ? 8080 : Number(argv[portFlag + 1]);
const port = Number.isInteger(wanted) && wanted > 0 && wanted < 65536 ? wanted : 8080;

const mediaTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
]);

async function serveFile(request, response) {
  let pathname = '/';
  try {
    pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
  } catch {
    response.writeHead(400);
    response.end('bad request');
    return;
  }
  const leaf = pathname.endsWith('/') ? 'index.html' : '';
  const target = path.resolve(path.join(gameRoot, path.normalize(pathname + leaf)));
  if (target !== gameRoot && !target.startsWith(gameRoot + path.sep)) {
    response.writeHead(403);
    response.end('forbidden');
    return;
  }
  let body;
  try {
    body = await readFile(target);
  } catch {
    response.writeHead(404);
    response.end('not found');
    return;
  }
  const kind = mediaTypes.get(path.extname(target).toLowerCase()) ?? 'application/octet-stream';
  response.writeHead(200, { 'content-type': kind, 'content-length': body.length, 'cache-control': 'no-store' });
  response.end(body);
}

const server = http.createServer((request, response) => {
  serveFile(request, response).catch(() => {
    if (!response.headersSent) response.writeHead(500);
    response.end('server error');
  });
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Ember Yard is on http://localhost:${port}`);
});
