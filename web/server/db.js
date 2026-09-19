/**
 * MySQL access layer: pool, schema bootstrap and small query helpers.
 * The schema file (db/schema.sql) is the single source of truth and is applied
 * idempotently on boot, so an existing Docker volume is upgraded automatically.
 */
import fs from 'node:fs/promises';
import mysql from 'mysql2/promise';
import { config } from './config.js';

export const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4_unicode_ci',
  timezone: 'local',
  multipleStatements: false,
});

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait until MySQL answers; the Docker container may still be initialising. */
export async function waitForDatabase({ attempts = 40, delayMs = 1500, log = console.log } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const conn = await pool.getConnection();
      try {
        await conn.query('SELECT 1');
      } finally {
        conn.release();
      }
      if (attempt > 1) log(`[db] connected after ${attempt} attempt(s)`);
      return true;
    } catch (error) {
      if (attempt === attempts) {
        log(`[db] still unreachable after ${attempts} attempts: ${error.code || error.message}`);
        return false;
      }
      if (attempt === 1) log(`[db] waiting for ${config.db.host}:${config.db.port} ...`);
      await sleep(delayMs);
    }
  }
  return false;
}

/** Split a .sql file into statements, ignoring `--` comment lines. */
export function splitStatements(sql) {
  return sql
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

export async function ensureSchema(log = console.log) {
  const sql = await fs.readFile(config.schemaFile, 'utf8');
  const statements = splitStatements(sql);
  const conn = await pool.getConnection();
  try {
    for (const statement of statements) {
      await conn.query(statement);
    }
    // Columns added after the first release: MySQL 8 has no
    // "ADD COLUMN IF NOT EXISTS", so check the catalogue first. This keeps an
    // existing Docker volume working after an upgrade.
    const added = [];
    if (!(await hasColumn(conn, 'levels', 'collection'))) {
      await conn.query("ALTER TABLE levels ADD COLUMN collection VARCHAR(32) NOT NULL DEFAULT '' AFTER slug");
      added.push('levels.collection');
    }
    if (added.length) log(`[db] added column(s): ${added.join(', ')}`);
  } finally {
    conn.release();
  }
  log(`[db] schema ready (${statements.length} statements)`);
}

async function hasColumn(conn, table, column) {
  const [rows] = await conn.query(
    'SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [table, column],
  );
  return rows.length > 0;
}

export async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

export async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows.length ? rows[0] : null;
}

/** Run a set of statements inside a transaction, retrying once on deadlock. */
export async function transaction(handler) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await handler(conn);
    await conn.commit();
    return result;
  } catch (error) {
    try {
      await conn.rollback();
    } catch {
      /* connection already gone */
    }
    throw error;
  } finally {
    conn.release();
  }
}
