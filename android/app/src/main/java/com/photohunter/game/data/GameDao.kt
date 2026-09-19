package com.photohunter.game.data

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Update

@Dao
interface GameDao {

    // ── player ────────────────────────────────────────────────────────────
    @Query("SELECT * FROM players WHERE id = 1")
    suspend fun player(): PlayerEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertPlayer(player: PlayerEntity)

    // ── chapter catalogue (seeded from assets) ────────────────────────────
    @Query("SELECT * FROM levels ORDER BY sortOrder, id")
    suspend fun levels(): List<LevelEntity>

    @Query("SELECT * FROM level_objects WHERE levelId = :levelId ORDER BY objectId")
    suspend fun objects(levelId: Int): List<LevelObjectEntity>

    @Query("SELECT COUNT(*) FROM levels")
    suspend fun levelCount(): Int

    @Query("SELECT COUNT(*) FROM level_objects")
    suspend fun objectCount(): Int

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertLevels(levels: List<LevelEntity>)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertObjects(objects: List<LevelObjectEntity>)

    @Query("DELETE FROM level_objects")
    suspend fun clearObjects()

    // ── progress ──────────────────────────────────────────────────────────
    @Query("SELECT * FROM progress")
    suspend fun allProgress(): List<ProgressEntity>

    @Query("SELECT * FROM progress WHERE levelId = :levelId")
    suspend fun progress(levelId: Int): ProgressEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertProgress(progress: ProgressEntity)

    // ── sessions / hint audit trail ───────────────────────────────────────
    @Insert
    suspend fun insertSession(session: SessionEntity): Long

    @Update
    suspend fun updateSession(session: SessionEntity)

    @Query("SELECT * FROM sessions WHERE id = :id")
    suspend fun session(id: Long): SessionEntity?

    /**
     * Every finished, timed attempt - the raw material for the local 成績榜.
     * The best attempt per chapter (by score) is picked in the repository, so
     * the ranking rule lives in Kotlin next to GameRules instead of in SQL.
     */
    @Query("SELECT * FROM sessions WHERE completed = 1 AND durationMs IS NOT NULL AND durationMs > 0 ORDER BY levelId, durationMs")
    suspend fun completedSessions(): List<SessionEntity>

    @Query("SELECT * FROM sessions WHERE levelId = :levelId AND completed = 1 AND durationMs IS NOT NULL AND durationMs > 0 ORDER BY durationMs LIMIT 1")
    suspend fun bestSessionForLevel(levelId: Int): SessionEntity?

    @Insert
    suspend fun insertHintEvent(event: HintEventEntity)

    @Insert
    suspend fun insertHintGrant(grant: HintGrantEntity)

    @Query("SELECT * FROM hint_events ORDER BY id DESC LIMIT 25")
    suspend fun recentHintEvents(): List<HintEventEntity>

    @Query("SELECT COUNT(*) FROM hint_events")
    suspend fun hintEventCount(): Int

    // ── key/value meta (seed version) ─────────────────────────────────────
    @Query("SELECT * FROM meta WHERE metaKey = :key")
    suspend fun meta(key: String): MetaEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun putMeta(entry: MetaEntity)

    @Query("DELETE FROM progress")
    suspend fun clearProgress()

    @Query("DELETE FROM hint_events")
    suspend fun clearHintEvents()
}
