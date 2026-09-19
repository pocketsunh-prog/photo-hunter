/**
 * Game rules shared by every endpoint.
 *
 *   錦囊 (hint pouch) economy
 *     - a new player starts with START_HINTS (3) pouches
 *     - ONE 錦囊 buys exactly one of:
 *         reveal : the game finds one anachronism for you (counts as found)
 *         locate : the game marks where one anachronism is (no free find)
 *     - clearing every MILESTONE_EVERY-th chapter (5, then 10) grants
 *       HINTS_PER_MILESTONE (3) extra pouches
 *   The server owns the pouch count and picks the hint target, so a client
 *   cannot talk itself into free hints.
 *
 *   Ranking (排行榜)
 *     - an attempt's 成績 (score) is  用時 + 誤點 × WRONG_TAP_PENALTY_MS
 *       so both "finish fastest" and "click fewest wrong spots" are rewarded
 *     - a player's chapter record is their BEST attempt at that chapter
 *     - the board sorts by 完成章節數 ↓, 總成績 ↑, 誤點 ↑, 總用時 ↑, 錦囊 ↑
 *     - 錦囊 usage is deliberately only a tie-breaker, not part of the score
 */
import { config } from './config.js';

export const RULES = {
  objectsPerLevel: 10,
  startHints: config.rules.startHints,
  milestoneEvery: config.rules.milestoneEvery,
  hintsPerMilestone: config.rules.hintsPerMilestone,
  hintModes: ['reveal', 'locate'],
  wrongTapPenaltyMs: config.rules.wrongTapPenaltyMs,
  ranking: {
    basis: 'chapterScore = durationMs + wrongTaps * wrongTapPenaltyMs',
    tieBreakers: ['wrongTaps', 'durationMs', 'hintsUsed'],
  },
};

/** 成績 of a single attempt: elapsed time plus a penalty per wrong tap. */
export function attemptScoreMs(durationMs, wrongTaps) {
  const time = Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : 0;
  const misses = Number.isFinite(wrongTaps) ? Math.max(0, Math.round(wrongTaps)) : 0;
  return time + misses * RULES.wrongTapPenaltyMs;
}

export function parseFoundObjects(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(Number).filter(Number.isFinite);
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : [];
  } catch {
    return String(raw)
      .split(',')
      .map((v) => Number.parseInt(v, 10))
      .filter(Number.isFinite);
  }
}

/**
 * Chapters unlock in order: the next mission only opens once the current one has
 * been cleared. `completedIds` are the chapters this player already finished.
 */
export function isLevelUnlocked(levelId, completedIds) {
  const id = Number(levelId);
  if (!Number.isFinite(id) || id <= 1) return true;
  return completedIds.map(Number).includes(id - 1);
}

/** The chapter that must be cleared before `levelId` opens (null for chapter 1). */
export function requiredLevelFor(levelId) {
  const id = Number(levelId);
  return Number.isFinite(id) && id > 1 ? id - 1 : null;
}

/** Pick which anachronism a 錦囊 should point at: a random one still missing. */
export function pickHintTarget(objects, foundIds) {
  const remaining = objects.filter((object) => !foundIds.includes(object.object_id ?? object.id));
  if (!remaining.length) return null;
  return remaining[Math.floor(Math.random() * remaining.length)];
}

/** Milestone bonus for a given number of cleared chapters (0 when none). */
export function milestoneReward(clearedBefore, clearedAfter) {
  const { milestoneEvery, hintsPerMilestone } = RULES;
  const before = Math.floor(clearedBefore / milestoneEvery);
  const after = Math.floor(clearedAfter / milestoneEvery);
  if (after <= before) return { awarded: 0, milestone: null };
  const crossings = after - before;
  return {
    awarded: crossings * hintsPerMilestone,
    milestone: after * milestoneEvery,
    message: `完成 ${after * milestoneEvery} 關，獲得 ${crossings * hintsPerMilestone} 個錦囊！`,
  };
}
