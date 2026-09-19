/**
 * Configuration for the photo-hunter API server.
 * Values come from the environment, with an optional web/.env file loaded first
 * (tiny hand-rolled loader so the app has no runtime dependency for config).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadDotEnv() {
  const file = path.join(WEB_ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv();

const int = (name, fallback) => {
  const raw = process.env[name];
  const parsed = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const config = {
  port: int('PORT', 4000),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: int('DB_PORT', 3306),
    user: process.env.DB_USER || 'hunter',
    password: process.env.DB_PASSWORD || 'hunter_pass',
    database: process.env.DB_NAME || 'photo_hunter',
  },
  levelsDir: path.isAbsolute(process.env.LEVELS_DIR || '')
    ? process.env.LEVELS_DIR
    : path.join(WEB_ROOT, process.env.LEVELS_DIR || 'data/levels'),
  publicDir: path.join(WEB_ROOT, 'public'),
  schemaFile: path.join(WEB_ROOT, 'db', 'schema.sql'),
  rules: {
    startHints: int('START_HINTS', 3),
    milestoneEvery: int('MILESTONE_EVERY', 5),
    hintsPerMilestone: int('HINTS_PER_MILESTONE', 3),
    /**
     * Ranking weight: one wrong tap costs this many milliseconds of "time" in
     * the 成績 (score) used by the leaderboard, so the board rewards both a fast
     * run and a clean one. See server/game.js for the exact formula.
     */
    wrongTapPenaltyMs: int('WRONG_TAP_PENALTY_MS', 3000),
  },
};
