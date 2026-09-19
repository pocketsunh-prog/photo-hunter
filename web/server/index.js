/**
 * photo-hunter web server: MySQL bootstrap + JSON API + static SPA host.
 *
 *   npm start           boots against the MySQL from `docker compose up -d db`
 *   docker compose --profile full up -d --build
 *                       runs MySQL *and* this server in containers
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config } from './config.js';
import { ensureSchema, pool, transaction, waitForDatabase } from './db.js';
import { loadLevelsFromDisk, seedLevels } from './levels.js';
import { RULES } from './game.js';
import { router } from './routes.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

function buildApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));

  // The Android client and the browser both talk to this API; it is a
  // single-player friendly game API with no cookies, so a permissive CORS
  // policy is safe and keeps local tooling simple.
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  });

  app.use('/api', router);

  app.use(
    express.static(config.publicDir, {
      etag: true,
      maxAge: '1h',
      setHeaders(res, filePath) {
        const ext = path.extname(filePath).toLowerCase();
        if (MIME[ext]) res.type(MIME[ext]);
        // Photos and audio are content-addressed by chapter; cache them hard.
        if (/[\\/]assets[\\/]/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=604800');
      },
    }),
  );

  // SPA fallback for non-API routes.
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(config.publicDir, 'index.html'));
  });

  app.use((req, res) => {
    res.status(404).json({ error: 'NOT_FOUND', message: `沒有這個路徑：${req.method} ${req.originalUrl}` });
  });

  // eslint-disable-next-line no-unused-vars -- express identifies error handlers by arity
  app.use((error, _req, res, _next) => {
    const status = error.status || 500;
    if (status >= 500) console.error('[api] unhandled error:', error);
    res.status(status).json({
      error: error.code || 'INTERNAL_ERROR',
      message: status >= 500 ? '伺服器內部錯誤，請稍後再試。' : error.message || '請求有誤。',
    });
  });

  return app;
}

async function main() {
  console.log('── 尋物獵人 Photo Hunter ── web server');
  console.log(`[cfg] db=${config.db.user}@${config.db.host}:${config.db.port}/${config.db.database} levels=${config.levelsDir}`);

  const levels = await loadLevelsFromDisk();

  const reachable = await waitForDatabase();
  if (!reachable) {
    console.error('[db] cannot reach MySQL. Start it with:  docker compose up -d db');
    process.exitCode = 1;
    return;
  }

  await ensureSchema();
  await transaction(async (conn) => seedLevels(conn, levels));

  const app = buildApp();
  const server = app.listen(config.port, () => {
    const base = `http://127.0.0.1:${config.port}`;
    console.log(`[web] game      ${base}/`);
    console.log(`[web] api       ${base}/api/health`);
    console.log(
      `[rules] 錦囊 ${RULES.startHints} 個起手，每完成 ${RULES.milestoneEvery} 關 +${RULES.hintsPerMilestone} 個`,
    );
  });

  const shutdown = async (signal) => {
    console.log(`\n[web] ${signal} received, closing ...`);
    server.close();
    await pool.end().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

const isDirectRun =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    console.error('[fatal]', error);
    process.exitCode = 1;
  });
}

export { buildApp };
