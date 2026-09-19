/**
 * HTTP API for the web app (mounted at /api).
 *
 * The server is authoritative for the 錦囊 economy and for what counts as
 * "found": the client reports taps, the server updates progress, decides when a
 * chapter is cleared and hands out milestone rewards.
 */
import crypto from 'node:crypto';
import express from 'express';
import { pool, query, queryOne, transaction } from './db.js';
import { RULES, attemptScoreMs, milestoneReward, parseFoundObjects, pickHintTarget } from './game.js';
import { objectRowToJson } from './levels.js';

export const router = express.Router();

const DEFAULT_NICKNAME = '無名捕手';

class ApiError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

function cleanNickname(value) {
  const text = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return text.slice(0, 32) || DEFAULT_NICKNAME;
}

function playerPayload(row) {
  return {
    playerKey: row.player_key,
    nickname: row.nickname,
    hints: Number(row.hints),
    hintsGranted: Number(row.hints_granted),
    hintsSpent: Number(row.hints_spent),
    levelsCleared: Number(row.levels_cleared),
    totalMs: Number(row.total_ms),
    createdAt: row.created_at,
  };
}

async function getPlayer(key) {
  const row = await queryOne('SELECT * FROM players WHERE player_key = ?', [key]);
  if (!row) throw new ApiError(404, 'PLAYER_NOT_FOUND', '找不到這位玩家，請重新建立角色。');
  return row;
}

async function getLevelMeta(levelId) {
  const row = await queryOne('SELECT * FROM levels WHERE id = ?', [Number(levelId)]);
  if (!row) throw new ApiError(404, 'LEVEL_NOT_FOUND', `沒有第 ${levelId} 章。`);
  return row;
}

async function getLevelObjects(levelId) {
  return query('SELECT * FROM level_objects WHERE level_id = ? ORDER BY object_id', [Number(levelId)]);
}

async function ensureProgress(playerId, levelId) {
  await pool.execute(
    'INSERT IGNORE INTO level_progress (player_id, level_id, found_objects, found_count) VALUES (?, ?, ?, 0)',
    [playerId, Number(levelId), JSON.stringify([])],
  );
  return queryOne('SELECT * FROM level_progress WHERE player_id = ? AND level_id = ?', [playerId, Number(levelId)]);
}

function progressPayload(row) {
  const found = parseFoundObjects(row.found_objects);
  return {
    levelId: Number(row.level_id),
    completed: Boolean(row.completed),
    found,
    foundCount: found.length,
    hintsUsed: Number(row.hints_used),
    wrongTaps: Number(row.wrong_taps),
    attempts: Number(row.attempts),
    bestMs: row.best_ms === null ? null : Number(row.best_ms),
    completedAt: row.completed_at,
  };
}

/**
 * Server-side elapsed time for a session, falling back to the client's own
 * measurement when the session is unknown to us.
 */
async function sessionElapsedMs(sessionId, fallback, conn = pool) {
  const clientMs = Number.isFinite(fallback) ? Math.max(0, Math.round(fallback)) : null;
  if (sessionId) {
    const [rows] = await conn.execute(
      'SELECT TIMESTAMPDIFF(MICROSECOND, started_at, NOW(3)) / 1000 AS elapsed_ms FROM play_sessions WHERE id = ?',
      [sessionId],
    );
    if (rows.length && rows[0].elapsed_ms !== null) {
      const serverMs = Math.round(Number(rows[0].elapsed_ms));
      if (serverMs > 0) return serverMs;
    }
  }
  return clientMs;
}

/**
 * The attempt row a request belongs to.
 *
 * The client normally sends the sessionId it got from /start, but the ranking
 * must not depend on that: a client that forgets it would otherwise complete a
 * chapter with no timed session and silently never appear on the leaderboard.
 * So when it is missing we fall back to the player's newest unfinished attempt
 * at that chapter.
 */
async function resolveSessionId(conn, playerId, levelId, provided) {
  const given = Number.parseInt(provided, 10);
  if (Number.isFinite(given)) return given;
  const [rows] = await conn.execute(
    'SELECT id FROM play_sessions WHERE player_id = ? AND level_id = ? AND finished_at IS NULL ORDER BY id DESC LIMIT 1',
    [playerId, Number(levelId)],
  );
  return rows.length ? Number(rows[0].id) : null;
}

/**
 * Record one anachronism as found (a real tap, or a 錦囊 auto-find) and finish
 * the chapter when the tenth one lands. Returns the fresh progress + rewards.
 */
async function recordFind({ playerKey, levelId, objectId, elapsedMs, sessionId, source }) {
  const player = await getPlayer(playerKey);
  const level = await getLevelMeta(levelId);
  const objects = await getLevelObjects(levelId);
  const target = objects.find((row) => row.object_id === Number(objectId));
  if (!target) throw new ApiError(400, 'OBJECT_NOT_IN_LEVEL', '這件物品不屬於本章。');

  await ensureProgress(player.id, level.id);

  return transaction(async (conn) => {
    const [progressRows] = await conn.execute(
      'SELECT * FROM level_progress WHERE player_id = ? AND level_id = ? FOR UPDATE',
      [player.id, level.id],
    );
    const progress = progressRows[0];
    const found = parseFoundObjects(progress.found_objects);
    if (found.includes(target.object_id)) {
      return {
        alreadyFound: true,
        found,
        foundCount: found.length,
        objectCount: Number(level.object_count),
        completed: Boolean(progress.completed),
        object: objectRowToJson(target),
        progress: progressPayload(progress),
        player: playerPayload(player),
        reward: { awarded: 0, milestone: null },
      };
    }

    found.push(target.object_id);
    const completedNow = found.length >= Number(level.object_count);
    const [playerRows] = await conn.execute('SELECT * FROM players WHERE id = ? FOR UPDATE', [player.id]);
    const freshPlayer = playerRows[0];

    await conn.execute(
      // completed is monotonic (GREATEST): a replay resets the found list, and a
      // half-finished replay must never un-clear a chapter that was already done -
      // otherwise the level counter and the 錦囊 milestones could be farmed.
      `UPDATE level_progress
          SET found_objects = ?, found_count = ?, completed = GREATEST(completed, ?)
        WHERE player_id = ? AND level_id = ?`,
      [JSON.stringify(found), found.length, completedNow ? 1 : 0, player.id, level.id],
    );

    let reward = { awarded: 0, milestone: null };
    let durationMs = null;
    let record = null;
    const activeSessionId = completedNow ? await resolveSessionId(conn, player.id, level.id, sessionId) : sessionId;
    if (completedNow) {
      durationMs = await sessionElapsedMs(activeSessionId, elapsedMs, conn);

      // Score this attempt with the same formula the leaderboard uses, using the
      // SESSION's wrong taps (this run) rather than the chapter's running total.
      let sessionWrongTaps = 0;
      let sessionHints = 0;
      if (activeSessionId) {
        const [sessionRows] = await conn.execute(
          'SELECT wrong_taps, hints_used FROM play_sessions WHERE id = ? AND player_id = ?',
          [activeSessionId, player.id],
        );
        if (sessionRows.length) {
          sessionWrongTaps = Number(sessionRows[0].wrong_taps) || 0;
          sessionHints = Number(sessionRows[0].hints_used) || 0;
        }
      }
      const previousBestMs = progress.best_ms === null ? null : Number(progress.best_ms);
      record = {
        chapterScoreMs: attemptScoreMs(durationMs, sessionWrongTaps),
        durationMs,
        wrongTaps: sessionWrongTaps,
        hintsUsed: sessionHints,
        previousBestMs,
        isNewBest: durationMs !== null && (previousBestMs === null || durationMs < previousBestMs),
      };

      // Always record the attempt's time ...
      await conn.execute(
        `UPDATE level_progress
            SET completed_at = NOW(),
                best_ms = CASE
                            WHEN ? IS NULL THEN best_ms
                            WHEN best_ms IS NULL OR ? < best_ms THEN ?
                            ELSE best_ms
                          END
          WHERE player_id = ? AND level_id = ?`,
        [durationMs, durationMs, durationMs, player.id, level.id],
      );
      if (!progress.completed) {
        // ... but chapter counters and the 錦囊 milestone only move the first
        // time a chapter is cleared, so replays can never farm hints.
        reward = milestoneReward(Number(freshPlayer.levels_cleared), Number(freshPlayer.levels_cleared) + 1);
        await conn.execute(
          `UPDATE players
              SET levels_cleared = levels_cleared + 1,
                  total_ms = total_ms + ?,
                  hints = hints + ?,
                  hints_granted = hints_granted + ?
            WHERE id = ?`,
          [durationMs ?? 0, reward.awarded, reward.awarded, player.id],
        );
        if (reward.awarded > 0) {
          await conn.execute(
            'INSERT INTO hint_grants (player_id, amount, milestone, reason) VALUES (?, ?, ?, ?)',
            [player.id, reward.awarded, reward.milestone, `cleared_${reward.milestone}_chapters`],
          );
        }
      }
    }

    const sessionToFinish = completedNow ? activeSessionId : sessionId;
    if (sessionToFinish) {
      await conn.execute(
        `UPDATE play_sessions
            SET finished_at = CASE WHEN ? THEN NOW() ELSE finished_at END,
                duration_ms = CASE WHEN ? THEN ? ELSE duration_ms END,
                completed = CASE WHEN ? THEN 1 ELSE completed END
          WHERE id = ? AND player_id = ?`,
        [completedNow ? 1 : 0, completedNow ? 1 : 0, durationMs ?? 0, completedNow ? 1 : 0, sessionToFinish, player.id],
      );
    }

    const [updatedPlayerRows] = await conn.execute('SELECT * FROM players WHERE id = ?', [player.id]);
    const [updatedProgressRows] = await conn.execute(
      'SELECT * FROM level_progress WHERE player_id = ? AND level_id = ?',
      [player.id, level.id],
    );

    return {
      alreadyFound: false,
      source,
      object: objectRowToJson(target),
      found,
      foundCount: found.length,
      objectCount: Number(level.object_count),
      completed: completedNow,
      durationMs,
      record,
      reward,
      level: { id: level.id, title: level.title },
      player: playerPayload(updatedPlayerRows[0]),
      progress: progressPayload(updatedProgressRows[0]),
    };
  });
}

// ---------------------------------------------------------------- meta

router.get('/health', asyncRoute(async (_req, res) => {
  const started = Date.now();
  const counts = await queryOne(
    `SELECT (SELECT COUNT(*) FROM levels) AS chapters,
            (SELECT COUNT(*) FROM level_objects) AS objects,
            (SELECT COUNT(*) FROM players) AS players`,
  );
  res.json({
    ok: true,
    service: 'photo-hunter-web',
    database: {
      connected: true,
      latencyMs: Date.now() - started,
      chapters: Number(counts.chapters),
      objects: Number(counts.objects),
      players: Number(counts.players),
    },
    rules: RULES,
    uptimeSeconds: Math.round(process.uptime()),
  });
}));

router.get('/config', asyncRoute(async (_req, res) => {
  const rows = await query('SELECT COUNT(*) AS total FROM levels');
  res.json({ rules: RULES, chapters: Number(rows[0].total) });
}));

// ---------------------------------------------------------------- players

router.post('/players', asyncRoute(async (req, res) => {
  const nickname = cleanNickname(req.body?.nickname);
  const playerKey = crypto.randomUUID();
  await pool.execute(
    'INSERT INTO players (player_key, nickname, hints) VALUES (?, ?, ?)',
    [playerKey, nickname, RULES.startHints],
  );
  const row = await queryOne('SELECT * FROM players WHERE player_key = ?', [playerKey]);
  res.status(201).json({ player: playerPayload(row), rules: RULES });
}));

router.get('/players/:key', asyncRoute(async (req, res) => {
  const player = await getPlayer(req.params.key);
  const progress = await query(
    `SELECT lp.*, l.title, l.object_count
       FROM level_progress lp JOIN levels l ON l.id = lp.level_id
      WHERE lp.player_id = ? ORDER BY lp.level_id`,
    [player.id],
  );
  res.json({ player: playerPayload(player), progress: progress.map(progressPayload) });
}));

router.patch('/players/:key', asyncRoute(async (req, res) => {
  const player = await getPlayer(req.params.key);
  const nickname = cleanNickname(req.body?.nickname);
  await pool.execute('UPDATE players SET nickname = ? WHERE id = ?', [nickname, player.id]);
  const row = await queryOne('SELECT * FROM players WHERE id = ?', [player.id]);
  res.json({ player: playerPayload(row) });
}));

/**
 * Wipe everything this player owns and start over: chapter progress, every
 * attempt (so the leaderboard entry disappears), and the 錦囊 audit trail.
 * The player row itself is kept (same playerKey and nickname) and gets a fresh
 * set of starter 錦囊, which is what makes this safe to offer as a button.
 */
router.post('/players/:key/reset', asyncRoute(async (req, res) => {
  const player = await getPlayer(req.params.key);
  const cleared = await transaction(async (conn) => {
    const counts = {};
    for (const table of ['play_sessions', 'level_progress', 'hint_events', 'hint_grants']) {
      const [result] = await conn.execute(`DELETE FROM ${table} WHERE player_id = ?`, [player.id]);
      counts[table] = Number(result.affectedRows) || 0;
    }
    await conn.execute(
      `UPDATE players
          SET hints = ?, hints_granted = 0, hints_spent = 0, levels_cleared = 0, total_ms = 0
        WHERE id = ?`,
      [RULES.startHints, player.id],
    );
    return counts;
  });
  const row = await queryOne('SELECT * FROM players WHERE id = ?', [player.id]);
  res.json({
    player: playerPayload(row),
    cleared,
    message: `已重置：清除 ${cleared.level_progress} 章進度、${cleared.play_sessions} 筆挑戰紀錄，錦囊回到 ${RULES.startHints} 個。`,
  });
}));

// ---------------------------------------------------------------- levels

router.get('/levels', asyncRoute(async (req, res) => {
  const levels = await query(
    `SELECT l.*,
            (SELECT COUNT(*) FROM level_objects o WHERE o.level_id = l.id) AS seeded_objects
       FROM levels l ORDER BY l.sort_order, l.id`,
  );
  let progressByLevel = new Map();
  if (req.query.player) {
    const player = await getPlayer(String(req.query.player));
    const rows = await query('SELECT * FROM level_progress WHERE player_id = ?', [player.id]);
    progressByLevel = new Map(rows.map((row) => [Number(row.level_id), progressPayload(row)]));
  }
  res.json({
    levels: levels.map((level) => ({
      id: Number(level.id),
      slug: level.slug,
      collection: level.collection || '',
      title: level.title,
      subtitle: level.subtitle,
      era: level.era,
      image: level.image,
      imageWidth: Number(level.image_width),
      imageHeight: Number(level.image_height),
      objectCount: Number(level.object_count),
      seededObjects: Number(level.seeded_objects),
      thumb: level.image.replace(/\.jpg$/, '-thumb.jpg'),
      progress: progressByLevel.get(Number(level.id)) ?? null,
    })),
  });
}));

router.get('/levels/:id', asyncRoute(async (req, res) => {
  const level = await getLevelMeta(req.params.id);
  const objects = await getLevelObjects(level.id);
  let progress = null;
  if (req.query.player) {
    const player = await getPlayer(String(req.query.player));
    const row = await ensureProgress(player.id, level.id);
    progress = progressPayload(row);
  }
  res.json({
    level: {
      id: Number(level.id),
      slug: level.slug,
      title: level.title,
      subtitle: level.subtitle,
      era: level.era,
      image: level.image,
      imageWidth: Number(level.image_width),
      imageHeight: Number(level.image_height),
      objectCount: Number(level.object_count),
      objects: objects.map((row) => objectRowToJson(row)),
    },
    progress,
  });
}));

// ---------------------------------------------------------------- play

router.post('/players/:key/levels/:id/start', asyncRoute(async (req, res) => {
  const player = await getPlayer(req.params.key);
  const level = await getLevelMeta(req.params.id);
  const previous = await ensureProgress(player.id, level.id);

  let found = parseFoundObjects(previous.found_objects);
  if (req.body?.restart === true && found.length) {
    // Replaying starts a clean round. `completed` and `best_ms` are deliberately
    // preserved, so a replayed chapter can never re-award a 錦囊 milestone.
    found = [];
    await pool.execute(
      'UPDATE level_progress SET found_objects = ?, found_count = 0 WHERE player_id = ? AND level_id = ?',
      [JSON.stringify([]), player.id, level.id],
    );
  }
  await pool.execute(
    'UPDATE level_progress SET attempts = attempts + 1 WHERE player_id = ? AND level_id = ?',
    [player.id, level.id],
  );
  const [session] = await pool.execute(
    'INSERT INTO play_sessions (player_id, level_id, attempt) VALUES (?, ?, ?)',
    [player.id, level.id, Number(previous.attempts) + 1],
  );
  const fresh = await queryOne('SELECT * FROM level_progress WHERE player_id = ? AND level_id = ?', [player.id, level.id]);
  const objects = await getLevelObjects(level.id);

  res.json({
    sessionId: Number(session.insertId),
    player: playerPayload(player),
    level: {
      id: Number(level.id),
      collection: level.collection || '',
      title: level.title,
      subtitle: level.subtitle,
      era: level.era,
      image: level.image,
      imageWidth: Number(level.image_width),
      imageHeight: Number(level.image_height),
      objectCount: Number(level.object_count),
      objects: objects.map((row) => objectRowToJson(row)),
    },
    progress: progressPayload(fresh),
    rules: RULES,
  });
}));

router.post('/players/:key/levels/:id/found', asyncRoute(async (req, res) => {
  const objectId = Number.parseInt(req.body?.objectId, 10);
  if (!Number.isFinite(objectId)) throw new ApiError(400, 'BAD_OBJECT_ID', '缺少 objectId。');
  const result = await recordFind({
    playerKey: req.params.key,
    levelId: req.params.id,
    objectId,
    elapsedMs: req.body?.elapsedMs,
    sessionId: req.body?.sessionId,
    source: 'tap',
  });
  res.json(result);
}));

router.post('/players/:key/levels/:id/miss', asyncRoute(async (req, res) => {
  const player = await getPlayer(req.params.key);
  const level = await getLevelMeta(req.params.id);
  await ensureProgress(player.id, level.id);
  await pool.execute(
    'UPDATE level_progress SET wrong_taps = wrong_taps + 1 WHERE player_id = ? AND level_id = ?',
    [player.id, level.id],
  );
  // Wrong taps belong to the current attempt, so the ranking's per-attempt
  // score stays honest even if the client never told us its sessionId.
  const sessionId = await resolveSessionId(pool, player.id, level.id, req.body?.sessionId);
  if (sessionId) {
    await pool.execute('UPDATE play_sessions SET wrong_taps = wrong_taps + 1 WHERE id = ? AND player_id = ?', [sessionId, player.id]);
  }
  const progress = await queryOne('SELECT * FROM level_progress WHERE player_id = ? AND level_id = ?', [player.id, level.id]);
  res.json({ progress: progressPayload(progress) });
}));

/**
 * Spend one 錦囊.
 *   mode=reveal : auto-find one anachronism (counts towards the ten)
 *   mode=locate : mark where one anachronism is, without counting it
 * The server picks the target so clients cannot choose the easiest one, and
 * binds the hint to an object that is still missing.
 */
router.post('/players/:key/levels/:id/hint', asyncRoute(async (req, res) => {
  const mode = String(req.body?.mode ?? 'locate');
  if (!RULES.hintModes.includes(mode)) throw new ApiError(400, 'BAD_HINT_MODE', '錦囊用法只有 reveal 或 locate。');

  const player = await getPlayer(req.params.key);
  const level = await getLevelMeta(req.params.id);
  const objects = await getLevelObjects(level.id);
  const previous = await ensureProgress(player.id, level.id);
  const found = parseFoundObjects(previous.found_objects);

  if (Number(player.hints) < 1) throw new ApiError(409, 'NO_HINTS', '錦囊已用完，完成 5 關可再獲得錦囊。');
  const target = pickHintTarget(objects, found);
  if (!target) throw new ApiError(409, 'NOTHING_TO_HINT', '本章已全部找齊。');

  const result = await transaction(async (conn) => {
    await conn.execute(
      'UPDATE players SET hints = hints - 1, hints_spent = hints_spent + 1 WHERE id = ?',
      [player.id],
    );
    await conn.execute(
      'INSERT INTO hint_events (player_id, level_id, object_id, mode) VALUES (?, ?, ?, ?)',
      [player.id, level.id, target.object_id, mode],
    );
    await conn.execute(
      'UPDATE level_progress SET hints_used = hints_used + 1 WHERE player_id = ? AND level_id = ?',
      [player.id, level.id],
    );
    const [rows] = await conn.execute('SELECT * FROM players WHERE id = ?', [player.id]);
    return playerPayload(rows[0]);
  });

  let findResult = null;
  if (mode === 'reveal') {
    findResult = await recordFind({
      playerKey: req.params.key,
      levelId: level.id,
      objectId: target.object_id,
      elapsedMs: req.body?.elapsedMs,
      sessionId: req.body?.sessionId,
      source: 'hint-reveal',
    });
  } else {
    const sessionId = await resolveSessionId(pool, player.id, level.id, req.body?.sessionId);
    if (sessionId) {
      await pool.execute('UPDATE play_sessions SET hints_used = hints_used + 1 WHERE id = ? AND player_id = ?', [sessionId, player.id]);
    }
  }

  res.json({
    mode,
    object: objectRowToJson(target),
    player: findResult ? findResult.player : result,
    found: findResult ? findResult.found : found,
    completed: findResult ? findResult.completed : false,
    reward: findResult ? findResult.reward : { awarded: 0, milestone: null },
    progress: findResult ? findResult.progress : progressPayload(previous),
  });
}));

// ---------------------------------------------------------------- leaderboard

/**
 * Ranking on "fastest time, fewest wrong clicks".
 *
 * For every player we take their BEST completed attempt at each chapter, where
 * an attempt's 成績 is  duration + wrong_taps × 誤點罰時  (RULES.wrongTapPenaltyMs).
 * Those chapter records are summed, then sorted by chapters completed first, so
 * a 10/10 run always outranks a 9/10 run, and within the same progress the
 * lowest total 成績 wins. Wrong taps, raw time and 錦囊 usage are tie-breakers.
 *
 * A window function is used instead of MIN() because we need the winning
 * attempt's raw time / wrong taps / hints as well as its score.
 */
router.get('/leaderboard', asyncRoute(async (req, res) => {
  const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit ?? '20', 10) || 20));
  const penalty = RULES.wrongTapPenaltyMs;
  const rows = await query(
    `WITH best_attempt AS (
       SELECT ps.player_id,
              ps.level_id,
              ps.duration_ms,
              ps.wrong_taps,
              ps.hints_used,
              ROW_NUMBER() OVER (
                PARTITION BY ps.player_id, ps.level_id
                ORDER BY (ps.duration_ms + ps.wrong_taps * ?) ASC, ps.wrong_taps ASC, ps.duration_ms ASC
              ) AS rn
         FROM play_sessions ps
        WHERE ps.completed = 1 AND ps.duration_ms IS NOT NULL AND ps.duration_ms > 0
     ),
     totals AS (
       SELECT player_id,
              COUNT(*)                                   AS chapters,
              SUM(duration_ms)                           AS time_ms,
              SUM(wrong_taps)                            AS wrong_taps,
              SUM(hints_used)                            AS hints_used,
              SUM(duration_ms + wrong_taps * ?)          AS score_ms
         FROM best_attempt
        WHERE rn = 1
        GROUP BY player_id
     )
     SELECT p.player_key, p.nickname, p.last_seen_at,
            t.chapters, t.time_ms, t.wrong_taps, t.hints_used, t.score_ms,
            (SELECT COUNT(*) FROM level_progress lp
              WHERE lp.player_id = p.id AND lp.completed = 1) AS completed_chapters
       FROM totals t
       JOIN players p ON p.id = t.player_id
      ORDER BY t.chapters DESC,
               t.score_ms ASC,
               t.wrong_taps ASC,
               t.time_ms ASC,
               t.hints_used ASC,
               p.last_seen_at ASC
      LIMIT ?`,
    [penalty, penalty, limit],
  );
  res.json({
    scoring: {
      wrongTapPenaltyMs: penalty,
      basis: RULES.ranking.basis,
      tieBreakers: RULES.ranking.tieBreakers,
      note: '取每章最佳一次成績加總；成績 = 用時 + 誤點 × 罰時，數字越小越好。',
    },
    leaderboard: rows.map((row, index) => ({
      rank: index + 1,
      playerKey: row.player_key,
      nickname: row.nickname,
      chapters: Number(row.chapters),
      completedChapters: Number(row.completed_chapters),
      timeMs: Number(row.time_ms),
      wrongTaps: Number(row.wrong_taps),
      hintsUsed: Number(row.hints_used),
      scoreMs: Number(row.score_ms),
      lastSeenAt: row.last_seen_at,
    })),
  });
}));

export { ApiError, recordFind };
