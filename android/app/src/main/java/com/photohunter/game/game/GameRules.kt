package com.photohunter.game.game

import com.photohunter.game.data.LevelObject

/**
 * Game rules + hit testing, ported 1:1 from the web client (web/public/js/game.js)
 * so a tap behaves identically in both apps.
 */
object GameRules {

    const val OBJECTS_PER_LEVEL = 10
    const val START_HINTS = 3
    const val MILESTONE_EVERY = 5
    const val HINTS_PER_MILESTONE = 3

    /**
     * Ranking weight, identical to the web build's WRONG_TAP_PENALTY_MS: one
     * wrong tap costs this many milliseconds of 成績, so the local 成績榜
     * rewards both a fast chapter and a clean one.
     */
    const val WRONG_TAP_PENALTY_MS = 3000L

    /** Extra finger tolerance around every box, in normalised units. */
    private const val PAD_X = 0.014f
    private const val PAD_Y = 0.012f

    /** Minimum tappable size of a target, in normalised units. */
    private const val MIN_W = 0.026f
    private const val MIN_H = 0.022f

    /** Grow a bbox to the minimum tappable size, keeping it inside the photo. */
    fun tappableBox(bbox: FloatArray): FloatArray {
        var x = bbox[0]
        var y = bbox[1]
        var w = bbox[2]
        var h = bbox[3]
        if (w < MIN_W) {
            x -= (MIN_W - w) / 2f
            w = MIN_W
        }
        if (h < MIN_H) {
            y -= (MIN_H - h) / 2f
            h = MIN_H
        }
        x = x.coerceIn(0f, (1f - w).coerceAtLeast(0f))
        y = y.coerceIn(0f, (1f - h).coerceAtLeast(0f))
        return floatArrayOf(x, y, w.coerceAtMost(1f), h.coerceAtMost(1f))
    }

    /**
     * @return the hit object, or null. When several boxes match (a small object
     *         sitting on a bigger one) the SMALLEST wins, because that is what
     *         the player aimed at.
     */
    fun hitTest(candidates: List<LevelObject>, nx: Float, ny: Float): LevelObject? {
        var best: LevelObject? = null
        var bestArea = Float.MAX_VALUE
        for (item in candidates) {
            val box = tappableBox(item.bbox)
            val x = box[0]
            val y = box[1]
            val w = box[2]
            val h = box[3]
            if (nx < x - PAD_X || nx > x + w + PAD_X) continue
            if (ny < y - PAD_Y || ny > y + h + PAD_Y) continue
            val area = w * h
            if (area < bestArea) {
                bestArea = area
                best = item
            }
        }
        return best
    }

    /** Extra 錦囊 awarded when the cleared-chapter count crosses a milestone. */
    fun milestoneReward(clearedBefore: Int, clearedAfter: Int): Pair<Int, Int> {
        val before = clearedBefore / MILESTONE_EVERY
        val after = clearedAfter / MILESTONE_EVERY
        if (after <= before) return 0 to 0
        val crossings = after - before
        return crossings * HINTS_PER_MILESTONE to after * MILESTONE_EVERY
    }

    /** 成績 of one attempt: elapsed time plus a penalty per wrong tap. */
    fun attemptScoreMs(durationMs: Long, wrongTaps: Int): Long =
        durationMs.coerceAtLeast(0L) + wrongTaps.coerceAtLeast(0).toLong() * WRONG_TAP_PENALTY_MS

    fun formatTime(ms: Long): String {
        val totalSeconds = (ms / 1000L).coerceAtLeast(0L)
        return "%02d:%02d".format(totalSeconds / 60, totalSeconds % 60)
    }
}
