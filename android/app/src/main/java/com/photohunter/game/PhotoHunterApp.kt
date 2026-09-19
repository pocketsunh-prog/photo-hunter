package com.photohunter.game

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.photohunter.game.data.Ranking
import com.photohunter.game.game.AudioController
import com.photohunter.game.ui.ChapterClearDialog
import com.photohunter.game.ui.ChapterSelectScreen
import com.photohunter.game.ui.GameClearDialog
import com.photohunter.game.ui.GameScreen
import com.photohunter.game.ui.HelpDialog
import com.photohunter.game.ui.HintChooserDialog
import com.photohunter.game.ui.HomeScreen
import com.photohunter.game.ui.InfoDialog
import com.photohunter.game.ui.Ink700
import com.photohunter.game.ui.Ink900
import com.photohunter.game.ui.Paper
import com.photohunter.game.ui.RankingDialog
import com.photohunter.game.ui.Gold
import kotlinx.coroutines.delay

/**
 * Root composable: owns the audio controller, the level timer, the Android back
 * button and the dialog routing, and hands plain callbacks down to the screens.
 */
@Composable
fun PhotoHunterApp(viewModel: GameViewModel = viewModel()) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val audio = remember { AudioController(context) }

    LaunchedEffect(Unit) {
        audio.preload(
            R.raw.sfx_found,
            R.raw.sfx_wrong,
            R.raw.sfx_hint,
            R.raw.sfx_level_clear,
            R.raw.sfx_game_clear,
            R.raw.sfx_bonus,
            R.raw.sfx_click,
        )
    }

    LaunchedEffect(state.muted) { audio.setMuted(state.muted) }

    LaunchedEffect(state.screen) {
        if (state.screen == Screen.Game) audio.playBgm(R.raw.bgm_game) else audio.playBgm(R.raw.bgm_menu)
    }

    LaunchedEffect(Unit) {
        viewModel.sfx.collect { effect ->
            when (effect) {
                Sfx.Found -> audio.playSfx(R.raw.sfx_found)
                Sfx.Wrong -> audio.playSfx(R.raw.sfx_wrong, 0.7f)
                Sfx.Hint -> audio.playSfx(R.raw.sfx_hint)
                Sfx.LevelClear -> audio.playSfx(R.raw.sfx_level_clear)
                Sfx.GameClear -> audio.playSfx(R.raw.sfx_game_clear)
                Sfx.Bonus -> audio.playSfx(R.raw.sfx_bonus)
                Sfx.Click -> audio.playSfx(R.raw.sfx_click, 0.6f)
            }
        }
    }

    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_STOP -> audio.pause()
                Lifecycle.Event.ON_START -> audio.resume()
                else -> Unit
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose {
            lifecycleOwner.lifecycle.removeObserver(observer)
            audio.release()
        }
    }

    // Level clock: ticked while a chapter is open, using the composable's scope.
    LaunchedEffect(state.screen) {
        if (state.screen == Screen.Game) {
            while (true) {
                delay(250)
                viewModel.tick()
            }
        }
    }

    // The locate ring stays on screen for five seconds, like the web build.
    LaunchedEffect(state.hintTargetId) {
        if (state.hintTargetId != null) {
            delay(5000)
            viewModel.clearHintTarget()
        }
    }

    // Auto-dismiss the transient status line.
    state.message?.let { message ->
        LaunchedEffect(message) {
            delay(2800)
            viewModel.clearMessage()
        }
    }

    BackHandler(enabled = state.screen != Screen.Home) {
        when (state.screen) {
            Screen.Game -> viewModel.leaveLevel()
            Screen.Chapters -> viewModel.backHome()
            Screen.Home -> Unit
        }
    }

    Box(
        Modifier
            .fillMaxSize()
            .background(Ink900)
            .safeDrawingPadding(),
    ) {
        when (state.screen) {
            Screen.Home -> HomeScreen(
                state = state,
                onNicknameChange = viewModel::onNicknameChange,
                onStart = viewModel::startGame,
                onHelp = viewModel::showHelp,
                onToggleMute = viewModel::toggleMute,
                onShowRanking = viewModel::showRanking,
            )

            Screen.Chapters -> ChapterSelectScreen(
                state = state,
                onBack = viewModel::backHome,
                onOpenChapter = { viewModel.openChapter(it) },
                onToggleMute = viewModel::toggleMute,
            )

            Screen.Game -> GameScreen(
                state = state,
                onBack = viewModel::leaveLevel,
                onToggleMute = viewModel::toggleMute,
                onTap = viewModel::onPhotoTap,
                onHint = viewModel::showHintChooser,
                onObjectInfo = viewModel::showObjectReason,
            )
        }

        if (!state.ready) {
            Box(
                Modifier
                    .fillMaxSize()
                    .background(Ink900),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator(color = Gold)
            }
        }

        state.message?.let { message ->
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(bottom = 92.dp),
                contentAlignment = Alignment.BottomCenter,
            ) {
                Box(
                    Modifier
                        .padding(horizontal = 24.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(Ink700)
                        .border(1.dp, Gold.copy(alpha = 0.4f), RoundedCornerShape(12.dp))
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                ) {
                    Text(message, color = Paper, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }

        when (val dialog = state.dialog) {
            null -> Unit
            DialogState.HintChoice -> HintChooserDialog(
                hints = state.hints,
                onChoose = viewModel::useHint,
                onDismiss = viewModel::dismissDialog,
            )

            DialogState.Help -> HelpDialog(onDismiss = viewModel::dismissDialog)
            is DialogState.Info -> InfoDialog(
                title = dialog.title,
                body = dialog.body,
                onDismiss = viewModel::dismissDialog,
            )

            DialogState.Ranking -> RankingDialog(
                ranking = state.ranking ?: Ranking(),
                nickname = state.nickname,
                onDismiss = viewModel::dismissDialog,
            )

            is DialogState.ChapterClear -> ChapterClearDialog(
                state = dialog,
                totalChapters = state.chapters.size,
                onNext = viewModel::nextChapter,
                onReplay = viewModel::replayChapter,
                onMap = viewModel::leaveLevel,
            )

            is DialogState.GameClear -> GameClearDialog(
                state = dialog,
                onMap = viewModel::leaveLevel,
            )
        }
    }
}
