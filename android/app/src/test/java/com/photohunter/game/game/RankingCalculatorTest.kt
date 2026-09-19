package com.photohunter.game.game

import com.photohunter.game.data.SessionEntity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Unit tests for the 成績榜 rule: fastest time AND fewest wrong clicks.
 * Pure JVM tests - no emulator, no database.
 */
class RankingCalculatorTest {

    private fun session(
        levelId: Int,
        durationMs: Long?,
        wrongTaps: Int,
        hintsUsed: Int = 0,
        completed: Boolean = true,
    ) = SessionEntity(
        id = 0,
        levelId = levelId,
        attempt = 1,
        startedAt = 0,
        finishedAt = 1,
        durationMs = durationMs,
        hintsUsed = hintsUsed,
        wrongTaps = wrongTaps,
        completed = completed,
    )

    @Test
    fun `chapters unlock in order`() {
        // Nothing cleared: only the first mission is open.
        assertTrue(GameRules.isLevelUnlocked(1, emptySet()))
        assertTrue(!GameRules.isLevelUnlocked(2, emptySet()))
        assertTrue(!GameRules.isLevelUnlocked(5, emptySet()))
        // Clearing chapter 1 opens exactly chapter 2 - not chapter 3.
        assertTrue(GameRules.isLevelUnlocked(2, setOf(1)))
        assertTrue(!GameRules.isLevelUnlocked(3, setOf(1)))
        // The previous chapter is what matters.
        assertTrue(GameRules.isLevelUnlocked(4, setOf(1, 2, 3)))
        assertTrue(!GameRules.isLevelUnlocked(4, setOf(1, 2)))
        // Volume 2 is gated behind the last chapter of volume 1.
        assertTrue(GameRules.isLevelUnlocked(11, (1..10).toSet()))
        assertTrue(!GameRules.isLevelUnlocked(11, (1..9).toSet()))
    }

    @Test
    fun `required level points at the previous chapter`() {
        assertEquals(null, GameRules.requiredLevelFor(1))
        assertEquals(1, GameRules.requiredLevelFor(2))
        assertEquals(19, GameRules.requiredLevelFor(20))
    }

    @Test
    fun `score is time plus a penalty per wrong tap`() {
        assertEquals(10_000L, GameRules.attemptScoreMs(10_000L, 0))
        assertEquals(13_000L, GameRules.attemptScoreMs(10_000L, 1))
        assertEquals(40_000L, GameRules.attemptScoreMs(10_000L, 10))
        // negative / nonsense input is clamped instead of producing a better score
        assertEquals(0L, GameRules.attemptScoreMs(-500L, -3))
    }

    @Test
    fun `a clean run beats a faster but sloppy run`() {
        // 20s clean = 20_000 ; 19s with 2 wrong taps = 19_000 + 6_000 = 25_000
        val clean = session(levelId = 1, durationMs = 20_000, wrongTaps = 0)
        val sloppy = session(levelId = 2, durationMs = 19_000, wrongTaps = 2)
        val ranking = RankingCalculator.build(listOf(sloppy, clean))

        assertEquals(listOf(1, 2), ranking.records.map { it.levelId })
        assertEquals(20_000L, ranking.records[0].scoreMs)
        assertEquals(25_000L, ranking.records[1].scoreMs)
        assertEquals(45_000L, ranking.scoreMs)
        assertEquals(2, ranking.wrongTaps)
        assertEquals(39_000L, ranking.totalMs)
    }

    @Test
    fun `only the best attempt of a chapter counts`() {
        val slow = session(levelId = 1, durationMs = 60_000, wrongTaps = 0)
        val fastButSloppy = session(levelId = 1, durationMs = 30_000, wrongTaps = 5) // 45_000
        val balanced = session(levelId = 1, durationMs = 32_000, wrongTaps = 0) // 32_000 - winner

        val ranking = RankingCalculator.build(listOf(slow, fastButSloppy, balanced))
        assertEquals(1, ranking.records.size)
        assertEquals(32_000L, ranking.records[0].scoreMs)
        assertEquals(32_000L, ranking.totalMs)
        assertEquals(0, ranking.wrongTaps)
    }

    @Test
    fun `replaying a chapter improves the record`() {
        val first = session(levelId = 3, durationMs = 50_000, wrongTaps = 1) // 53_000
        val replay = session(levelId = 3, durationMs = 41_000, wrongTaps = 1) // 44_000
        val ranking = RankingCalculator.build(listOf(first, replay))
        assertEquals(44_000L, ranking.records[0].scoreMs)
        assertEquals(41_000L, ranking.records[0].durationMs)
    }

    @Test
    fun `unfinished and untimed attempts are ignored`() {
        val ranking = RankingCalculator.build(
            listOf(
                session(levelId = 1, durationMs = 20_000, wrongTaps = 0, completed = false),
                session(levelId = 2, durationMs = null, wrongTaps = 0),
                session(levelId = 3, durationMs = 0, wrongTaps = 0),
                session(levelId = 4, durationMs = 21_000, wrongTaps = 1),
            ),
        )
        assertEquals(listOf(4), ranking.records.map { it.levelId })
        assertEquals(1, ranking.chapters)
    }

    @Test
    fun `chapter titles fall back to the chapter number`() {
        val ranking = RankingCalculator.build(
            listOf(session(levelId = 7, durationMs = 10_000, wrongTaps = 0)),
            titles = mapOf(7 to "第七章・帳房核帳圖"),
        )
        assertEquals("第七章・帳房核帳圖", ranking.records[0].title)

        val untitled = RankingCalculator.build(listOf(session(levelId = 12, durationMs = 10_000, wrongTaps = 0)))
        assertEquals("第 12 章", untitled.records[0].title)
    }

    @Test
    fun `equal scores fall back to fewer wrong taps then faster time`() {
        // Same score (30_000) reached two different ways:
        //   A: 30s with 0 misses, B: 27s with 1 miss
        val a = session(levelId = 1, durationMs = 30_000, wrongTaps = 0)
        val b = session(levelId = 2, durationMs = 27_000, wrongTaps = 1)
        val ranking = RankingCalculator.build(listOf(b, a))
        assertEquals(listOf(1, 2), ranking.records.map { it.levelId })
        assertTrue(ranking.records.all { it.scoreMs == 30_000L })
    }
}
