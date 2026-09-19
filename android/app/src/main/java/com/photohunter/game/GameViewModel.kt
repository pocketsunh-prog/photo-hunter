package com.photohunter.game

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.photohunter.game.data.ChapterSummary
import com.photohunter.game.data.GameRepository
import com.photohunter.game.data.LevelDefinition
import com.photohunter.game.data.LevelObject
import com.photohunter.game.data.PlayerProfile
import com.photohunter.game.data.ProgressEntity
import com.photohunter.game.data.Ranking
import com.photohunter.game.game.GameRules
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class Screen { Home, Chapters, Game }

/** One-shot sound effects the UI layer should play. */
enum class Sfx { Found, Wrong, Hint, LevelClear, GameClear, Bonus, Click }

sealed interface DialogState {
    data object HintChoice : DialogState
    data object Help : DialogState
    data object Ranking : DialogState
    data class Info(val title: String, val body: String) : DialogState
    data class ChapterClear(
        val levelId: Int,
        val levelTitle: String,
        val durationMs: Long,
        val hintsUsed: Int,
        val wrongTaps: Int,
        /** 用時 + 誤點 × 罰時 for this attempt */
        val chapterScoreMs: Long,
        val isNewBest: Boolean,
        val previousBestMs: Long?,
        val reward: Int,
        val milestone: Int,
        val hintsNow: Int,
        val hasNext: Boolean,
    ) : DialogState

    data class GameClear(val totalMs: Long, val hintsSpent: Int) : DialogState
}

data class UiState(
    val ready: Boolean = false,
    val screen: Screen = Screen.Home,
    val nickname: String = "無名捕手",
    val hints: Int = GameRules.START_HINTS,
    val hintsSpent: Int = 0,
    val levelsCleared: Int = 0,
    val totalMs: Long = 0,
    val chapters: List<ChapterSummary> = emptyList(),
    val level: LevelDefinition? = null,
    val found: Set<Int> = emptySet(),
    val revealed: Set<Int> = emptySet(),
    val hintsUsedThisRun: Int = 0,
    val wrongTaps: Int = 0,
    val startedAt: Long = 0L,
    val now: Long = 0L,
    val hintTargetId: Int? = null,
    val sessionId: Long = 0L,
    val muted: Boolean = false,
    val dialog: DialogState? = null,
    val message: String? = null,
    val ranking: Ranking? = null,
) {
    val elapsedMs: Long get() = if (startedAt == 0L) 0L else (now - startedAt).coerceAtLeast(0L)
    val hintTarget: LevelObject? get() = level?.objects?.firstOrNull { it.id == hintTargetId }
}

class GameViewModel(application: Application) : AndroidViewModel(application) {

    private val repository = GameRepository(application)

    private val _state = MutableStateFlow(UiState())
    val state: StateFlow<UiState> = _state.asStateFlow()

    private val _sfx = MutableSharedFlow<Sfx>(extraBufferCapacity = 8)
    val sfx: SharedFlow<Sfx> = _sfx.asSharedFlow()

    init {
        viewModelScope.launch {
            repository.ensureSeeded()
            val profile = repository.loadProfile()
            val chapters = repository.chapters()
            _state.update {
                it.copy(
                    ready = true,
                    nickname = profile.nickname,
                    hints = profile.hints,
                    hintsSpent = profile.hintsSpent,
                    levelsCleared = profile.levelsCleared,
                    totalMs = profile.totalMs,
                    chapters = chapters,
                )
            }
        }
    }

    // ── home ──────────────────────────────────────────────────────────────

    fun onNicknameChange(value: String) {
        _state.update { it.copy(nickname = value.take(32)) }
    }

    fun startGame() {
        viewModelScope.launch {
            emitSfx(Sfx.Click)
            val profile = repository.saveNickname(_state.value.nickname)
            applyProfile(profile)
            refreshChapters()
            _state.update { it.copy(screen = Screen.Chapters) }
        }
    }

    fun toggleMute() {
        _state.update { it.copy(muted = !it.muted) }
    }

    fun showHelp() = _state.update { it.copy(dialog = DialogState.Help) }

    /** Recompute and show the local 成績榜 (best attempt per chapter). */
    fun showRanking() {
        viewModelScope.launch {
            emitSfx(Sfx.Click)
            val ranking = repository.ranking()
            _state.update { it.copy(ranking = ranking, dialog = DialogState.Ranking) }
        }
    }

    fun clearHintTarget() = _state.update { it.copy(hintTargetId = null) }

    fun backHome() {
        emitSfx(Sfx.Click)
        _state.update { it.copy(screen = Screen.Home, dialog = null) }
    }

    // ── chapters ──────────────────────────────────────────────────────────

    fun openChapters() {
        viewModelScope.launch {
            emitSfx(Sfx.Click)
            refreshChapters()
            _state.update { it.copy(screen = Screen.Chapters, level = null, found = emptySet()) }
        }
    }

    fun openChapter(levelId: Int, restart: Boolean = false) {
        viewModelScope.launch {
            val level = repository.level(levelId) ?: return@launch
            var progress = repository.progress(levelId)
            if (restart && progress.foundIds.isNotEmpty()) {
                // Replay starts a clean photo; `completed` and `bestMs` are kept,
                // so a replayed chapter can never re-award a 錦囊 milestone.
                progress = progress.copy(foundObjects = "")
                repository.saveProgress(progress)
            }
            progress = progress.copy(attempts = progress.attempts + 1)
            repository.saveProgress(progress)

            val sessionId = repository.beginSession(levelId, progress.attempts)
            _state.update {
                it.copy(
                    screen = Screen.Game,
                    level = level,
                    found = progress.foundIds,
                    revealed = emptySet(),
                    hintsUsedThisRun = 0,
                    wrongTaps = 0,
                    startedAt = System.currentTimeMillis(),
                    now = System.currentTimeMillis(),
                    hintTargetId = null,
                    sessionId = sessionId,
                    dialog = null,
                    message = if (progress.foundIds.isEmpty()) null else "已找回 ${progress.foundIds.size} 件，繼續找剩下的。",
                )
            }
        }
    }

    fun leaveLevel() {
        emitSfx(Sfx.Click)
        viewModelScope.launch {
            refreshChapters()
            _state.update { it.copy(screen = Screen.Chapters, level = null, dialog = null, hintTargetId = null) }
        }
    }

    fun nextChapter() {
        val current = _state.value.dialog as? DialogState.ChapterClear ?: return
        val next = _state.value.chapters.firstOrNull { it.id == current.levelId + 1 }
        if (next != null) openChapter(next.id) else leaveLevel()
    }

    fun replayChapter() {
        val levelId = (_state.value.dialog as? DialogState.ChapterClear)?.levelId ?: _state.value.level?.id
        if (levelId != null) openChapter(levelId, restart = true)
    }

    fun dismissDialog() = _state.update { it.copy(dialog = null) }

    fun clearMessage() = _state.update { it.copy(message = null) }

    fun tick() {
        if (_state.value.screen == Screen.Game) {
            _state.update { it.copy(now = System.currentTimeMillis()) }
        }
    }

    // ── play ──────────────────────────────────────────────────────────────

    fun onPhotoTap(nx: Float, ny: Float) {
        val current = _state.value
        val level = current.level ?: return
        if (current.dialog != null) return
        val candidates = level.objects.filter { it.id !in current.found }
        val hit = GameRules.hitTest(candidates, nx, ny)
        if (hit != null) {
            foundObject(hit, revealed = false)
        } else {
            viewModelScope.launch {
                emitSfx(Sfx.Wrong)
                val progress = repository.progress(level.id).copy(wrongTaps = current.wrongTaps + 1)
                repository.saveProgress(progress)
                _state.update { it.copy(wrongTaps = it.wrongTaps + 1) }
            }
        }
    }

    fun showHintChooser() {
        val current = _state.value
        if (current.hints < 1) {
            _state.update { it.copy(message = "錦囊已用完，完成 5 關可再獲得 3 個。") }
            return
        }
        emitSfx(Sfx.Click)
        _state.update { it.copy(dialog = DialogState.HintChoice) }
    }

    /**
     * Spend one 錦囊.
     *   reveal  -> auto-find one anachronism (counts towards the ten)
     *   locate  -> mark where one anachronism is, without counting it
     * The target is picked from the still-missing objects, like the server does
     * for the web build.
     */
    fun useHint(mode: String) {
        val current = _state.value
        val level = current.level ?: return
        if (current.hints < 1) {
            _state.update { it.copy(dialog = null, message = "錦囊已用完，完成 5 關可再獲得 3 個。") }
            return
        }
        val remaining = level.objects.filter { it.id !in current.found }
        if (remaining.isEmpty()) {
            _state.update { it.copy(dialog = null, message = "本章已全部找齊。") }
            return
        }
        val target = remaining.random()
        viewModelScope.launch {
            emitSfx(Sfx.Hint)
            repository.logHint(level.id, target.id, mode)
            val profile = repository.addHints(delta = -1, spentDelta = 1)
            applyProfile(profile)
            _state.update {
                it.copy(
                    dialog = null,
                    hintsUsedThisRun = it.hintsUsedThisRun + 1,
                    hintTargetId = if (mode == "locate") target.id else null,
                    message = if (mode == "reveal") "錦囊替你找出了「${target.name}」。" else "錦囊指路：${target.hint}",
                )
            }
            if (mode == "reveal") {
                foundObject(target, revealed = true)
                // keep the locate ring cleared after an auto-find
                _state.update { it.copy(hintTargetId = null) }
            }
        }
    }

    private fun foundObject(target: LevelObject, revealed: Boolean) {
        val current = _state.value
        val level = current.level ?: return
        if (target.id in current.found) return

        val found = current.found + target.id
        val revealedIds = if (revealed) current.revealed + target.id else current.revealed

        viewModelScope.launch {
            emitSfx(Sfx.Found)
            _state.update { it.copy(found = found, revealed = revealedIds) }

            val previous = repository.progress(level.id)
            val completedNow = found.size >= level.objectCount
            var progress = previous.copy(
                foundObjects = found.sorted().joinToString(","),
                completed = completedNow,
            )

            if (completedNow && !previous.completed) {
                val duration = current.elapsedMs
                val best = previous.bestMs?.let { minOf(it, duration) } ?: duration
                // 成績 for this attempt, using this run's wrong taps (not the
                // chapter's running total) - same formula as the web leaderboard.
                val chapterScore = GameRules.attemptScoreMs(duration, current.wrongTaps)
                val isNewBest = previous.bestMs == null || duration < previous.bestMs
                progress = progress.copy(completedAt = System.currentTimeMillis(), bestMs = best)
                repository.saveProgress(progress)

                val profileBefore = repository.loadProfile()
                val (awarded, milestone) = GameRules.milestoneReward(
                    profileBefore.levelsCleared,
                    profileBefore.levelsCleared + 1,
                )
                val profile = repository.addHints(
                    delta = awarded,
                    grantedDelta = awarded,
                    totalMsDelta = duration,
                    levelsClearedDelta = 1,
                )
                applyProfile(profile)
                if (awarded > 0) {
                    repository.logHintGrant(awarded, milestone)
                    emitSfx(Sfx.Bonus)
                }
                repository.finishSession(
                    sessionId = current.sessionId,
                    durationMs = duration,
                    hintsUsed = current.hintsUsedThisRun,
                    wrongTaps = current.wrongTaps,
                    completed = true,
                )

                val chapters = repository.chapters()
                val allCleared = chapters.isNotEmpty() && chapters.all { it.completed }
                _state.update { state ->
                    state.copy(
                        chapters = chapters,
                        hintTargetId = null,
                        dialog = if (allCleared) {
                            DialogState.GameClear(totalMs = state.totalMs, hintsSpent = state.hintsSpent)
                        } else {
                            DialogState.ChapterClear(
                                levelId = level.id,
                                levelTitle = level.title,
                                durationMs = duration,
                                hintsUsed = state.hintsUsedThisRun,
                                wrongTaps = state.wrongTaps,
                                chapterScoreMs = chapterScore,
                                isNewBest = isNewBest,
                                previousBestMs = previous.bestMs,
                                reward = awarded,
                                milestone = milestone,
                                hintsNow = state.hints,
                                hasNext = chapters.any { it.id == level.id + 1 },
                            )
                        },
                    )
                }
                emitSfx(Sfx.LevelClear)
            } else {
                repository.saveProgress(progress)
                _state.update {
                    it.copy(message = "找到了：${target.name}（${found.size}/${level.objectCount}）")
                }
            }
        }
    }

    fun showObjectReason(objectId: Int) {
        val entry = _state.value.level?.objects?.firstOrNull { it.id == objectId } ?: return
        _state.update { it.copy(dialog = DialogState.Info(entry.name, entry.reason)) }
    }

    // ── helpers ───────────────────────────────────────────────────────────

    private suspend fun refreshChapters() {
        val chapters = repository.chapters()
        _state.update { it.copy(chapters = chapters) }
    }

    private fun applyProfile(profile: PlayerProfile) {
        _state.update {
            it.copy(
                nickname = profile.nickname,
                hints = profile.hints,
                hintsSpent = profile.hintsSpent,
                levelsCleared = profile.levelsCleared,
                totalMs = profile.totalMs,
            )
        }
    }

    private fun emitSfx(effect: Sfx) {
        _sfx.tryEmit(effect)
    }
}
