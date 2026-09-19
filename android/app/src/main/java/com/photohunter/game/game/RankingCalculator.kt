package com.photohunter.game.game

import com.photohunter.game.data.ChapterRecord
import com.photohunter.game.data.Ranking
import com.photohunter.game.data.SessionEntity

/**
 * The local 成績榜 rule, kept free of Android and Room dependencies so it can be
 * unit tested directly (see app/src/test/java/.../RankingCalculatorTest.kt).
 *
 *   成績 = 用時 + 誤點 × 罰時        (smaller is better)
 *   a player's chapter record = their BEST completed attempt at that chapter
 *   the board = those chapter records, summed per player
 *
 * The web build ranks with the same formula (web/server/game.js), so the two
 * numbers mean the same thing.
 */
object RankingCalculator {

    /** Keep only the best attempt of each chapter. */
    fun bestPerChapter(sessions: List<SessionEntity>): List<SessionEntity> {
        val best = LinkedHashMap<Int, SessionEntity>()
        for (session in sessions) {
            val duration = session.durationMs ?: continue
            if (!session.completed || duration <= 0L) continue
            val score = GameRules.attemptScoreMs(duration, session.wrongTaps)
            val current = best[session.levelId]
            if (current == null) {
                best[session.levelId] = session
                continue
            }
            val currentScore = GameRules.attemptScoreMs(current.durationMs ?: 0L, current.wrongTaps)
            val better = score < currentScore ||
                (score == currentScore && session.wrongTaps < current.wrongTaps) ||
                (score == currentScore && session.wrongTaps == current.wrongTaps && duration < (current.durationMs ?: 0L))
            if (better) best[session.levelId] = session
        }
        return best.values.toList()
    }

    fun build(
        sessions: List<SessionEntity>,
        titles: Map<Int, String> = emptyMap(),
        penaltyMs: Long = GameRules.WRONG_TAP_PENALTY_MS,
    ): Ranking {
        val records = bestPerChapter(sessions)
            .map { session ->
                val duration = session.durationMs ?: 0L
                ChapterRecord(
                    levelId = session.levelId,
                    title = titles[session.levelId] ?: "第 ${session.levelId} 章",
                    durationMs = duration,
                    wrongTaps = session.wrongTaps,
                    hintsUsed = session.hintsUsed,
                    scoreMs = GameRules.attemptScoreMs(duration, session.wrongTaps),
                    finishedAt = session.finishedAt,
                )
            }
            .sortedWith(compareBy({ it.scoreMs }, { it.wrongTaps }, { it.durationMs }, { it.levelId }))

        return Ranking(
            records = records,
            chapters = records.size,
            totalMs = records.sumOf { it.durationMs },
            wrongTaps = records.sumOf { it.wrongTaps },
            hintsUsed = records.sumOf { it.hintsUsed },
            scoreMs = records.sumOf { it.scoreMs },
            wrongTapPenaltyMs = penaltyMs,
        )
    }
}
