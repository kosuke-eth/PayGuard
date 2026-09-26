/**
 * Production Node server for the PayGuard frontend. No dependencies.
 *
 *   - serves the Vite build in ./dist (SPA fallback to index.html)
 *   - reverse-proxies /v1/* and /health/* to the PayGuard API
 *
 * The API sends no CORS headers and its session cookie is SameSite=Strict, so the browser has to
 * reach it on the SAME origin as this page. Request headers (Origin, Cookie, X-CSRF-Token,
 * Idempotency-Key) and response headers (Set-Cookie) pass through untouched. This process holds no
 * key, no database credential and no session state.
 */
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

function loadDotEnv() {
  const file = path.join(here, '.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}
loadDotEnv();

const API = new URL(process.env.PAYGUARD_API_URL ?? 'http://127.0.0.1:3000');
const PORT = Number.parseInt(process.env.WEB_PORT ?? '5173', 10);
const HOST = process.env.WEB_HOST ?? 'localhost';
const DIST = path.join(here, 'dist');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function proxy(request, response) {
  const upstream = http.request(
    {
      protocol: API.protocol,
      hostname: API.hostname,
      port: API.port,
      method: request.method,
      path: request.url,
      headers: request.headers,
    },
    (answer) => {
      response.writeHead(answer.statusCode ?? 502, answer.headers);
      answer.pipe(response);
    },
  );
  upstream.on('error', () => {
    // Same Failure envelope the API uses, so the client reports "unreachable", never a fake result.
    response.writeHead(502, { 'content-type': 'application/json' });
    response.end(
      JSON.stringify({
        error: {
          code: 'NOT_READY',
          message: `PayGuard API is unreachable at ${API.origin}`,
          retryable: true,
          requestId: 'web-proxy',
        },
      }),
    );
  });
  request.pipe(upstream);
}

function serveStatic(request, response) {
  const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname);
  let file = path.normalize(path.join(DIST, pathname));
  if (!file.startsWith(DIST)) {
    response.writeHead(403).end();
    return;
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  const type = TYPES[path.extname(file)] ?? 'application/octet-stream';
  response.writeHead(200, {
    'content-type': type,
    'cache-control': file.includes(`${path.sep}assets${path.sep}`)
      ? 'public, max-age=31536000, immutable'
      : 'no-cache',
  });
  createReadStream(file).pipe(response);
}

if (!existsSync(path.join(DIST, 'index.html'))) {
  console.error('dist/ is missing. Run `pnpm --filter @payguard/web build` first.');
  process.exit(1);
}

http
  .createServer((request, response) => {
    const url = request.url ?? '/';
    if (url.startsWith('/v1/') || url === '/v1' || url.startsWith('/health/'))
      proxy(request, response);
    else serveStatic(request, response);
  })
  .listen(PORT, HOST, () => {
    console.log(`PayGuard web  http://${HOST}:${PORT}  ->  API ${API.origin}`);
  });
