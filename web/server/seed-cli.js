/**
 * CLI: re-seed the chapter tables from web/data/levels without starting the API.
 *   npm run seed
 */
import { ensureSchema, pool, transaction, waitForDatabase } from './db.js';
import { config } from './config.js';
import { loadLevelsFromDisk, seedLevels } from './levels.js';

const reachable = await waitForDatabase({ attempts: 10 });
if (!reachable) {
  console.error(`[seed] cannot reach MySQL at ${config.db.host}:${config.db.port} - run: docker compose up -d db`);
  process.exit(1);
}

const levels = await loadLevelsFromDisk();
await ensureSchema();
await transaction(async (conn) => seedLevels(conn, levels));

const [rows] = await pool.query(
  `SELECT l.id, l.title, COUNT(o.object_id) AS objects
     FROM levels l LEFT JOIN level_objects o ON o.level_id = l.id
    GROUP BY l.id, l.title ORDER BY l.id`,
);
for (const row of rows) console.log(`  #${String(row.id).padStart(2, '0')}  ${row.title}  (${row.objects} objects)`);
await pool.end();
console.log('[seed] done');
