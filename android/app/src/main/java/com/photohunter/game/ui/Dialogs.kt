package com.photohunter.game.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.photohunter.game.DialogState
import com.photohunter.game.data.ChapterRecord
import com.photohunter.game.data.Ranking
import com.photohunter.game.game.GameRules

private val dialogShape = RoundedCornerShape(18.dp)

@Composable
private fun HunterDialog(
    title: String,
    onDismiss: () -> Unit,
    content: @Composable () -> Unit,
    confirm: @Composable () -> Unit,
    dismiss: (@Composable () -> Unit)? = null,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                text = title,
                color = GoldSoft,
                style = MaterialTheme.typography.headlineMedium,
            )
        },
        text = content,
        confirmButton = confirm,
        dismissButton = dismiss,
        shape = dialogShape,
        containerColor = Ink700,
        textContentColor = PaperDim,
        titleContentColor = GoldSoft,
    )
}

@Composable
fun HintChooserDialog(hints: Int, onChoose: (String) -> Unit, onDismiss: () -> Unit) {
    HunterDialog(
        title = "使用錦囊",
        onDismiss = onDismiss,
        confirm = {},
        content = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(
                    "每個錦囊只能用一次，選一種用法：",
                    style = MaterialTheme.typography.bodyMedium,
                )
                HintOption(
                    title = "自動找出",
                    body = "直接替你找出 1 件，立即算入十件",
                    onClick = { onChoose("reveal") },
                )
                HintOption(
                    title = "提示位置",
                    body = "在相片上圈出 1 件的位置 5 秒",
                    onClick = { onChoose("locate") },
                )
                Text(
                    "剩餘錦囊：$hints",
                    style = MaterialTheme.typography.labelMedium,
                    color = TextDim,
                )
            }
        },
        dismiss = {
            OutlinedButton(onClick = onDismiss) { Text("先不用") }
        },
    )
}

@Composable
private fun HintOption(title: String, body: String, onClick: () -> Unit) {
    OutlinedButton(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
    ) {
        Column(Modifier.fillMaxWidth().padding(vertical = 6.dp)) {
            Text(title, color = GoldSoft, style = MaterialTheme.typography.titleMedium)
            Text(body, color = TextDim, style = MaterialTheme.typography.labelMedium)
        }
    }
}

@Composable
fun HelpDialog(onDismiss: () -> Unit) {
    HunterDialog(
        title = "玩法說明",
        onDismiss = onDismiss,
        confirm = { OutlinedButton(onClick = onDismiss) { Text("知道了") } },
        content = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                HelpItem("1", "每一關是一張古代相片，裡面藏了 10 件不屬於那個年代的東西。")
                HelpItem("2", "點一下可疑的地方，找對會亮起來；找錯只會出現提示，不會扣分。")
                HelpItem("3", "開局有 3 個錦囊：可以「自動找出」或「提示位置」。")
                HelpItem("4", "成功過 5 關會再獲得 3 個錦囊，過 10 關再獲得 3 個。")
                HelpItem("5", "進度與錦囊都存在手機的 SQLite 資料庫，關掉遊戲也不會不見。")
                HelpItem("6", "成績榜的成績 = 用時 + 誤點 × 3 秒：每一章取最好的一次，數字越小排名越前，所以既要快、也要少點錯。")
            }
        },
    )
}

@Composable
private fun HelpItem(index: String, text: String) {
    Column {
        Text("$index.", color = Gold, style = MaterialTheme.typography.labelMedium)
        Text(text, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
fun InfoDialog(title: String, body: String, onDismiss: () -> Unit) {
    HunterDialog(
        title = title,
        onDismiss = onDismiss,
        confirm = { OutlinedButton(onClick = onDismiss) { Text("關閉") } },
        content = { Text(body, style = MaterialTheme.typography.bodyMedium) },
    )
}

@Composable
fun ChapterClearDialog(
    state: DialogState.ChapterClear,
    totalChapters: Int,
    onNext: () -> Unit,
    onReplay: () -> Unit,
    onMap: () -> Unit,
) {
    HunterDialog(
        title = "第 ${state.levelId} 章 完成",
        onDismiss = onMap,
        confirm = {
            Button(
                onClick = if (state.hasNext) onNext else onMap,
                colors = ButtonDefaults.buttonColors(containerColor = Gold, contentColor = Color(0xFF241A08)),
            ) {
                Text(if (state.hasNext) "前往第 ${state.levelId + 1} 章" else "回到選關")
            }
        },
        dismiss = { OutlinedButton(onClick = onReplay) { Text("重玩本章") } },
        content = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    "${state.levelTitle} · 十個目標全數尋獲",
                    style = MaterialTheme.typography.bodyLarge,
                    color = Paper,
                )
                StatRow(
                    items = listOf(
                        GameRules.formatTime(state.durationMs) to "用時",
                        state.wrongTaps.toString() to "誤點",
                        state.hintsUsed.toString() to "錦囊",
                    ),
                )
                Text(
                    "本章成績 ${GameRules.formatTime(state.chapterScoreMs)}（用時 + 誤點 × ${GameRules.WRONG_TAP_PENALTY_MS / 1000} 秒）",
                    color = GoldSoft,
                    style = MaterialTheme.typography.labelMedium,
                )
                if (state.isNewBest) {
                    Text(
                        "⚡ 本章最快紀錄！",
                        color = Jade,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                    )
                } else if (state.previousBestMs != null) {
                    Text(
                        "本章最佳 ${GameRules.formatTime(state.previousBestMs)}",
                        color = TextDim,
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
                if (state.reward > 0) {
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .padding(top = 2.dp),
                    ) {
                        Text(
                            "完成 ${state.milestone} 關，獲得 ${state.reward} 個錦囊！（目前錦囊 ×${state.hintsNow}）",
                            color = GoldSoft,
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                        )
                    }
                }
                Text(
                    "已破 ${state.levelId} / $totalChapters 章",
                    style = MaterialTheme.typography.labelMedium,
                    color = TextDim,
                )
            }
        },
    )
}

@Composable
fun GameClearDialog(state: DialogState.GameClear, onMap: () -> Unit) {
    HunterDialog(
        title = "十張相片，全部破解",
        onDismiss = onMap,
        confirm = { Button(onClick = onMap, colors = ButtonDefaults.buttonColors(containerColor = Gold, contentColor = Color(0xFF241A08))) { Text("回選關") } },
        content = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("你把一百件不屬於那個年代的東西全都揪出來了。", style = MaterialTheme.typography.bodyMedium)
                StatRow(
                    items = listOf(
                        "10/10" to "章節",
                        GameRules.formatTime(state.totalMs) to "總用時",
                        state.hintsSpent.toString() to "用掉錦囊",
                    ),
                )
            }
        },
    )
}

/**
 * Destructive confirmation for the reset button: spells out exactly what this
 * device loses, because there is no undo.
 */
@Composable
fun ResetDialog(
    chaptersCleared: Int,
    totalChapters: Int,
    foundObjects: Int,
    hints: Int,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    HunterDialog(
        title = "重置遊戲進度",
        onDismiss = onDismiss,
        confirm = {
            Button(
                onClick = onConfirm,
                colors = ButtonDefaults.buttonColors(containerColor = Vermilion, contentColor = Color(0xFFFFEEDE)),
            ) {
                Text("確認重置", fontWeight = FontWeight.Bold)
            }
        },
        dismiss = { OutlinedButton(onClick = onDismiss) { Text("取消") } },
        content = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("這會清空這台裝置上的所有紀錄，而且無法復原：", style = MaterialTheme.typography.bodyMedium)
                Text(
                    "• 目前的 $chaptersCleared/$totalChapters 章進度與 $foundObjects 件已找到的物件\n" +
                        "• 成績榜上的每一筆成績與最佳時間\n" +
                        "• 錦囊的使用與獲得紀錄（目前 ×$hints）",
                    style = MaterialTheme.typography.bodyMedium,
                    color = Paper,
                )
                Text(
                    "重置後錦囊會回到 ${GameRules.START_HINTS} 個，名號保留不變。",
                    style = MaterialTheme.typography.labelMedium,
                    color = TextDim,
                )
            }
        },
    )
}

/**
 * Local 成績榜: every chapter's best attempt, ranked by
 * 成績 = 用時 + 誤點 × 罰時 (smaller is better) - the same rule the web
 * leaderboard uses, so the two builds are directly comparable.
 */
@Composable
fun RankingDialog(ranking: Ranking, nickname: String, onDismiss: () -> Unit) {
    HunterDialog(
        title = "成績榜",
        onDismiss = onDismiss,
        confirm = { OutlinedButton(onClick = onDismiss) { Text("關閉") } },
        content = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(nickname, color = Paper, style = MaterialTheme.typography.titleMedium)
                Text(
                    "成績 = 用時 + 誤點 × ${ranking.wrongTapPenaltyMs / 1000} 秒；每章取最好的一次，數字越小越好。",
                    color = GoldSoft,
                    style = MaterialTheme.typography.labelMedium,
                )
                if (ranking.records.isEmpty()) {
                    Text("還沒有完成任何章節。", style = MaterialTheme.typography.bodyMedium)
                    return@Column
                }
                StatRow(
                    items = listOf(
                        "${ranking.chapters}" to "章節",
                        GameRules.formatTime(ranking.scoreMs) to "總成績",
                        "${ranking.wrongTaps}" to "總誤點",
                    ),
                )
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .heightIn(max = 300.dp)
                        .verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    RecordHeader()
                    ranking.records.forEach { record -> RecordRow(record) }
                }
                Text(
                    "總用時 ${GameRules.formatTime(ranking.totalMs)} · 錦囊共 ${ranking.hintsUsed} 個",
                    color = TextDim,
                    style = MaterialTheme.typography.labelMedium,
                )
            }
        },
    )
}

@Composable
private fun RecordHeader() {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("章節", color = TextDim, style = MaterialTheme.typography.labelMedium, modifier = Modifier.weight(1f))
        listOf("成績", "用時", "誤點").forEach { label ->
            Text(
                label,
                color = TextDim,
                style = MaterialTheme.typography.labelMedium,
                textAlign = TextAlign.End,
                modifier = Modifier.width(52.dp),
            )
        }
    }
}

@Composable
private fun RecordRow(record: ChapterRecord) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(
            "第 ${record.levelId} 章",
            color = Paper,
            style = MaterialTheme.typography.bodyMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        Text(
            GameRules.formatTime(record.scoreMs),
            color = GoldSoft,
            style = MaterialTheme.typography.bodyMedium,
            textAlign = TextAlign.End,
            modifier = Modifier.width(52.dp),
        )
        Text(
            GameRules.formatTime(record.durationMs),
            color = PaperDim,
            style = MaterialTheme.typography.bodyMedium,
            textAlign = TextAlign.End,
            modifier = Modifier.width(52.dp),
        )
        Text(
            record.wrongTaps.toString(),
            color = if (record.wrongTaps == 0) Jade else PaperDim,
            style = MaterialTheme.typography.bodyMedium,
            textAlign = TextAlign.End,
            modifier = Modifier.width(52.dp),
        )
    }
}
