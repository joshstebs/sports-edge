// Standalone hosting entry point. Serves the Vite build and the existing API on one port.
import 'dotenv/config';
import express from 'express';
import { access, mkdir, mkdtemp, rmdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { securityHeaders } from './auth/index.js';

process.env.NODE_ENV = 'production';
if (process.env.RENDER === 'true' && !process.env.APP_ORIGIN && process.env.RENDER_EXTERNAL_URL) {
  process.env.APP_ORIGIN = process.env.RENDER_EXTERNAL_URL;
}
const { storageStatus } = await import('./lib/predictionStore.js');

const port = Number(process.env.PORT ?? '3000');
const proxyHops = Number(process.env.TRUST_PROXY_HOPS ?? '0');
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
if (!Number.isInteger(proxyHops) || proxyHops < 0 || proxyHops > 10) {
  throw new Error('TRUST_PROXY_HOPS must be an integer from 0 to 10.');
}

const { UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN, SPORTS_EDGE_DATA_DIR } = process.env;
if (Boolean(UPSTASH_REDIS_REST_URL) !== Boolean(UPSTASH_REDIS_REST_TOKEN)) {
  throw new Error('Configure both Upstash settings together.');
}
const storage = storageStatus();
if (process.env.SPORTS_EDGE_REQUIRE_REDIS === 'true' && storage.backend !== 'upstash-redis') {
  throw new Error('Configure Upstash Redis before starting this service.');
}
if (storage.backend === 'local-json') {
  if (!SPORTS_EDGE_DATA_DIR || !isAbsolute(SPORTS_EDGE_DATA_DIR)) {
    throw new Error('Set SPORTS_EDGE_DATA_DIR to an absolute path on persistent storage.');
  }
  await mkdir(SPORTS_EDGE_DATA_DIR, { recursive: true });
  const probe = await mkdtemp(join(SPORTS_EDGE_DATA_DIR, '.startup-check-'));
  await rmdir(probe);
} else if (storage.backend === 'not-configured') {
  throw new Error('Configure SportsEdge storage before starting the server.');
}

const clientDir = fileURLToPath(new URL('../../dist/', import.meta.url));
await access(join(clientDir, 'index.html'));

const { default: app } = await import('./app.js');
app.set('trust proxy', proxyHops);
const hosted = express();
hosted.disable('x-powered-by');
hosted.set('trust proxy', proxyHops);
const serveClient = express.static(clientDir, { dotfiles: 'deny' });
const clientHeaders = securityHeaders(true);
hosted.use((req, res, next) => {
  if (req.path === '/api' || req.path.startsWith('/api/')) return next();
  clientHeaders(req, res, () => serveClient(req, res, next));
});
hosted.use(app);

const server = hosted.listen(port, process.env.HOST ?? '0.0.0.0', () => {
  console.log(`SportsEdge listening on port ${port} with ${storage.backend} storage.`);
});

process.once('SIGTERM', () => server.close());
process.once('SIGINT', () => server.close());
