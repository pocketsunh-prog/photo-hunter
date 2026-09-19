package com.photohunter.game.data

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * SQLite schema (via Room) for the Android build.
 *
 * It intentionally mirrors the MySQL schema used by the web build
 * (web/db/schema.sql): the same chapters, the same ten objects per chapter, the
 * same 錦囊 economy - only the engine differs (SQLite on the device, no server).
 */
@Entity(tableName = "players")
data class PlayerEntity(
    @PrimaryKey val id: Int = 1,
    val nickname: String = "無名捕手",
    val hints: Int = 3,
    val hintsGranted: Int = 0,
    val hintsSpent: Int = 0,
    val levelsCleared: Int = 0,
    val totalMs: Long = 0,
    val updatedAt: Long = System.currentTimeMillis(),
)

@Entity(tableName = "levels")
data class LevelEntity(
    @PrimaryKey val id: Int,
    val slug: String,
    val title: String,
    val subtitle: String,
    val era: String,
    val image: String,
    val imageWidth: Int,
    val imageHeight: Int,
    val objectCount: Int,
    val sortOrder: Int,
)

@Entity(tableName = "level_objects", primaryKeys = ["levelId", "objectId"])
data class LevelObjectEntity(
    val levelId: Int,
    val objectId: Int,
    val name: String,
    val nameEn: String,
    val reason: String,
    val hint: String,
    val bboxX: Float,
    val bboxY: Float,
    val bboxW: Float,
    val bboxH: Float,
    val confidence: String,
)

@Entity(tableName = "progress")
data class ProgressEntity(
    @PrimaryKey val levelId: Int,
    val completed: Boolean = false,
    /** comma separated object ids, e.g. "1,4,7" */
    val foundObjects: String = "",
    val hintsUsed: Int = 0,
    val wrongTaps: Int = 0,
    val attempts: Int = 0,
    val bestMs: Long? = null,
    val completedAt: Long? = null,
    val updatedAt: Long = System.currentTimeMillis(),
) {
    val foundIds: Set<Int>
        get() = foundObjects.split(',').mapNotNull { it.trim().toIntOrNull() }.toSet()
}

@Entity(tableName = "sessions")
data class SessionEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val levelId: Int,
    val attempt: Int,
    val startedAt: Long,
    val finishedAt: Long? = null,
    val durationMs: Long? = null,
    val hintsUsed: Int = 0,
    val wrongTaps: Int = 0,
    val completed: Boolean = false,
)

@Entity(tableName = "hint_events")
data class HintEventEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val levelId: Int,
    val objectId: Int,
    /** "reveal" (auto-found) or "locate" (position marked) */
    val mode: String,
    val createdAt: Long = System.currentTimeMillis(),
)

@Entity(tableName = "hint_grants")
data class HintGrantEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val amount: Int,
    val milestone: Int,
    val reason: String,
    val createdAt: Long = System.currentTimeMillis(),
)

@Entity(tableName = "meta")
data class MetaEntity(
    @PrimaryKey val metaKey: String,
    val value: String,
)
