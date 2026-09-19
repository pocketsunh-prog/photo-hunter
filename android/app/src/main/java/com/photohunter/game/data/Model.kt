package com.photohunter.game.data

/**
 * Runtime model of one anachronistic object, loaded from the chapter JSON in
 * assets (the same JSON that seeds MySQL for the web app) and mirrored into SQLite.
 *
 * bbox is normalised [x, y, w, h] against the full photo, origin top-left.
 */
data class LevelObject(
    val id: Int,
    val name: String,
    val nameEn: String,
    val reason: String,
    val hint: String,
    val bbox: FloatArray,
    val confidence: String,
) {
    val centerX: Float get() = bbox[0] + bbox[2] / 2f
    val centerY: Float get() = bbox[1] + bbox[3] / 2f

    // FloatArray needs manual equals/hashCode; compare by identity fields instead.
    override fun equals(other: Any?): Boolean = other is LevelObject && other.id == id
    override fun hashCode(): Int = id
}

data class LevelDefinition(
    val id: Int,
    val slug: String,
    val collection: String,
    val title: String,
    val subtitle: String,
    val era: String,
    val image: String,
    val imageWidth: Int,
    val imageHeight: Int,
    val objectCount: Int,
    val objects: List<LevelObject>,
)

data class ChapterSummary(
    val id: Int,
    val collection: String,
    val title: String,
    val subtitle: String,
    val era: String,
    val image: String,
    val objectCount: Int,
    val foundCount: Int,
    val completed: Boolean,
    val bestMs: Long?,
) {
    val thumbName: String get() = image.replace(".jpg", "-thumb.jpg")
}

data class PlayerProfile(
    val nickname: String = "無名捕手",
    val hints: Int = 3,
    val hintsGranted: Int = 0,
    val hintsSpent: Int = 0,
    val levelsCleared: Int = 0,
    val totalMs: Long = 0,
)

/** One chapter's best local attempt, ranked by 成績 (time + wrong-tap penalty). */
data class ChapterRecord(
    val levelId: Int,
    val title: String,
    val durationMs: Long,
    val wrongTaps: Int,
    val hintsUsed: Int,
    val scoreMs: Long,
    val finishedAt: Long?,
)

/** The whole local 成績榜: per-chapter records plus their totals. */
data class Ranking(
    val records: List<ChapterRecord> = emptyList(),
    val chapters: Int = 0,
    val totalMs: Long = 0,
    val wrongTaps: Int = 0,
    val hintsUsed: Int = 0,
    val scoreMs: Long = 0,
    val wrongTapPenaltyMs: Long = 3000,
)
