package com.photohunter.game.data

import android.content.Context
import com.photohunter.game.game.GameRules
import com.photohunter.game.game.RankingCalculator
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Everything the game needs from SQLite. Chapters are seeded from the bundled
 * JSON on first launch (and re-seeded when the bundled level set changes), while
 * the player row, per-chapter progress and the 錦囊 audit trail are owned by the
 * database from then on.
 */
class GameRepository(private val context: Context) {

    private val dao = GameDatabase.get(context).dao()

    suspend fun ensureSeeded(): Int = withContext(Dispatchers.IO) {
        val definition = LevelCatalog.load(context)
        // The fingerprint covers everything the UI reads from the levels table,
        // including the volume name, so new chapters (or a new volume) trigger a
        // re-seed while player progress is left untouched.
        val fingerprint = definition.joinToString("|") { "${it.id}:${it.objectCount}:${it.collection}:${it.slug}" }
        val stored = dao.meta(META_LEVELS).valueOrNull()
        val complete = dao.levelCount() == definition.size && dao.objectCount() == definition.sumOf { it.objectCount }
        if (stored == fingerprint && complete) return@withContext definition.size

        dao.insertLevels(
            definition.map {
                LevelEntity(
                    id = it.id,
                    slug = it.slug,
                    collection = it.collection,
                    title = it.title,
                    subtitle = it.subtitle,
                    era = it.era,
                    image = it.image,
                    imageWidth = it.imageWidth,
                    imageHeight = it.imageHeight,
                    objectCount = it.objectCount,
                    sortOrder = it.id,
                )
            },
        )
        // Objects are replaced wholesale so a corrected bbox never leaves a stale row.
        dao.clearObjects()
        dao.insertObjects(
            definition.flatMap { level ->
                level.objects.map { o ->
                    LevelObjectEntity(
                        levelId = level.id,
                        objectId = o.id,
                        name = o.name,
                        nameEn = o.nameEn,
                        reason = o.reason,
                        hint = o.hint,
                        bboxX = o.bbox[0],
                        bboxY = o.bbox[1],
                        bboxW = o.bbox[2],
                        bboxH = o.bbox[3],
                        confidence = o.confidence,
                    )
                }
            },
        )
        dao.putMeta(MetaEntity(META_LEVELS, fingerprint))
        definition.size
    }

    suspend fun loadProfile(): PlayerProfile = withContext(Dispatchers.IO) {
        val existing = dao.player()
        if (existing == null) {
            val fresh = PlayerEntity(hints = com.photohunter.game.game.GameRules.START_HINTS)
            dao.upsertPlayer(fresh)
            return@withContext fresh.toProfile()
        }
        existing.toProfile()
    }

    suspend fun saveNickname(nickname: String): PlayerProfile = withContext(Dispatchers.IO) {
        val current = dao.player() ?: PlayerEntity(hints = com.photohunter.game.game.GameRules.START_HINTS)
        val cleaned = nickname.trim().ifEmpty { "無名捕手" }.take(32)
        val updated = current.copy(nickname = cleaned, updatedAt = System.currentTimeMillis())
        dao.upsertPlayer(updated)
        updated.toProfile()
    }

    suspend fun addHints(delta: Int, spentDelta: Int = 0, grantedDelta: Int = 0, totalMsDelta: Long = 0, levelsClearedDelta: Int = 0): PlayerProfile =
        withContext(Dispatchers.IO) {
            val current = dao.player() ?: PlayerEntity(hints = com.photohunter.game.game.GameRules.START_HINTS)
            val updated = current.copy(
                hints = (current.hints + delta).coerceAtLeast(0),
                hintsSpent = current.hintsSpent + spentDelta,
                hintsGranted = current.hintsGranted + grantedDelta,
                totalMs = current.totalMs + totalMsDelta,
                levelsCleared = current.levelsCleared + levelsClearedDelta,
                updatedAt = System.currentTimeMillis(),
            )
            dao.upsertPlayer(updated)
            updated.toProfile()
        }

    suspend fun chapters(): List<ChapterSummary> = withContext(Dispatchers.IO) {
        val progress = dao.allProgress().associateBy { it.levelId }
        dao.levels().map { level ->
            val row = progress[level.id]
            ChapterSummary(
                id = level.id,
                collection = level.collection,
                title = level.title,
                subtitle = level.subtitle,
                era = level.era,
                image = level.image,
                objectCount = level.objectCount,
                // A cleared chapter always reads as full, even if the player
                // replayed it and left the photo half finished.
                foundCount = if (row?.completed == true) level.objectCount else row?.foundIds?.size ?: 0,
                completed = row?.completed == true,
                bestMs = row?.bestMs,
            )
        }
    }

    suspend fun level(levelId: Int): LevelDefinition? = withContext(Dispatchers.IO) {
        val level = dao.levels().firstOrNull { it.id == levelId } ?: return@withContext null
        val objects = dao.objects(levelId).map { row ->
            LevelObject(
                id = row.objectId,
                name = row.name,
                nameEn = row.nameEn,
                reason = row.reason,
                hint = row.hint,
                bbox = floatArrayOf(row.bboxX, row.bboxY, row.bboxW, row.bboxH),
                confidence = row.confidence,
            )
        }
        LevelDefinition(
            id = level.id,
            slug = level.slug,
            collection = level.collection,
            title = level.title,
            subtitle = level.subtitle,
            era = level.era,
            image = level.image,
            imageWidth = level.imageWidth,
            imageHeight = level.imageHeight,
            objectCount = level.objectCount,
            objects = objects,
        )
    }

    suspend fun progress(levelId: Int): ProgressEntity = withContext(Dispatchers.IO) {
        dao.progress(levelId) ?: ProgressEntity(levelId = levelId)
    }

    suspend fun saveProgress(progress: ProgressEntity) = withContext(Dispatchers.IO) {
        dao.upsertProgress(progress.copy(updatedAt = System.currentTimeMillis()))
    }

    suspend fun beginSession(levelId: Int, attempt: Int): Long = withContext(Dispatchers.IO) {
        dao.insertSession(
            SessionEntity(
                levelId = levelId,
                attempt = attempt,
                startedAt = System.currentTimeMillis(),
            ),
        )
    }

    suspend fun finishSession(sessionId: Long, durationMs: Long, hintsUsed: Int, wrongTaps: Int, completed: Boolean) =
        withContext(Dispatchers.IO) {
            val session = dao.session(sessionId) ?: return@withContext
            dao.updateSession(
                session.copy(
                    finishedAt = System.currentTimeMillis(),
                    durationMs = durationMs,
                    hintsUsed = hintsUsed,
                    wrongTaps = wrongTaps,
                    completed = completed,
                ),
            )
        }

    suspend fun logHint(levelId: Int, objectId: Int, mode: String) = withContext(Dispatchers.IO) {
        dao.insertHintEvent(HintEventEntity(levelId = levelId, objectId = objectId, mode = mode))
    }

    suspend fun logHintGrant(amount: Int, milestone: Int) = withContext(Dispatchers.IO) {
        dao.insertHintGrant(
            HintGrantEntity(amount = amount, milestone = milestone, reason = "cleared_${milestone}_chapters"),
        )
    }

    suspend fun hintEventCount(): Int = withContext(Dispatchers.IO) { dao.hintEventCount() }

    /**
     * Local 成績榜: for every chapter take the best completed attempt by
     * 成績 = 用時 + 誤點 × 罰時, then sum the chapter records. The rule itself
     * lives in RankingCalculator so it can be unit tested; it is identical to the
     * web leaderboard's formula (web/server/game.js).
     */
    suspend fun ranking(): Ranking = withContext(Dispatchers.IO) {
        val titles = dao.levels().associate { it.id to it.title }
        RankingCalculator.build(dao.completedSessions(), titles)
    }

    /**
     * Wipe this device's whole game environment: chapter progress, every attempt
     * (so the local 成績榜 is emptied) and the 錦囊 audit trail. The nickname is
     * kept and the 錦囊 count goes back to the starter amount, matching what the
     * web build's POST /players/:key/reset does.
     */
    suspend fun resetProgress() = withContext(Dispatchers.IO) {
        dao.clearProgress()
        dao.clearSessions()
        dao.clearHintEvents()
        dao.clearHintGrants()
        val nickname = dao.player()?.nickname ?: "無名捕手"
        dao.upsertPlayer(
            PlayerEntity(id = 1, nickname = nickname, hints = com.photohunter.game.game.GameRules.START_HINTS),
        )
    }

    private fun PlayerEntity.toProfile() = PlayerProfile(
        nickname = nickname,
        hints = hints,
        hintsGranted = hintsGranted,
        hintsSpent = hintsSpent,
        levelsCleared = levelsCleared,
        totalMs = totalMs,
    )

    private fun MetaEntity?.valueOrNull(): String? = this?.value

    companion object {
        const val META_LEVELS = "levels_fingerprint"
    }
}
