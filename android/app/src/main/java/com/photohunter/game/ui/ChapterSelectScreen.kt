package com.photohunter.game.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.photohunter.game.UiState
import com.photohunter.game.data.ChapterSummary
import com.photohunter.game.game.GameRules

@Composable
fun ChapterSelectScreen(
    state: UiState,
    onBack: () -> Unit,
    onOpenChapter: (Int) -> Unit,
    onLockedChapter: (ChapterSummary) -> Unit,
    onToggleMute: () -> Unit,
) {
    val cleared = state.chapters.count { it.completed }
    val foundTotal = state.chapters.sumOf { it.foundCount }

    Column(Modifier.fillMaxSize()) {
        HunterTopBar(
            title = "選關",
            subtitle = "共 ${state.chapters.size} 章 · 每章 10 件",
            onBack = onBack,
            muted = state.muted,
            onToggleMute = onToggleMute,
            trailing = { Chip(text = "錦囊 ×${state.hints}", accent = Vermilion) },
        )

        LazyVerticalGrid(
            columns = GridCells.Adaptive(minSize = 152.dp),
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            horizontalArrangement = Arrangement.spacedBy(14.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            item(span = { androidx.compose.foundation.lazy.grid.GridItemSpan(maxLineSpan) }) {
                StatRow(
                    items = listOf(
                        state.hints.toString() to "錦囊",
                        "$cleared/${state.chapters.size}" to "已破章節",
                        "$foundTotal/${state.chapters.size * GameRules.OBJECTS_PER_LEVEL}" to "已找到目標",
                    ),
                )
            }

            // One header per volume (卷一 / 卷二), so twenty cards stay readable.
            var lastCollection: String? = null
            state.chapters.forEach { chapter ->
                if (chapter.collection.isNotEmpty() && chapter.collection != lastCollection) {
                    lastCollection = chapter.collection
                    val volumeChapters = state.chapters.filter { it.collection == chapter.collection }
                    val volumeCleared = volumeChapters.count { it.completed }
                    item(
                        key = "header-${chapter.collection}",
                        span = { androidx.compose.foundation.lazy.grid.GridItemSpan(maxLineSpan) },
                    ) {
                        CollectionHeader(
                            name = chapter.collection,
                            progress = "$volumeCleared/${volumeChapters.size} 章已破",
                        )
                    }
                }
                item(key = "chapter-${chapter.id}") {
                    ChapterCard(
                        chapter = chapter,
                        onClick = {
                            if (chapter.locked) onLockedChapter(chapter) else onOpenChapter(chapter.id)
                        },
                    )
                }
            }

            item(span = { androidx.compose.foundation.lazy.grid.GridItemSpan(maxLineSpan) }) {
                Text(
                    text = "提示：卡關時用錦囊，可以自動找出 1 個目標或圈出 1 個目標的位置。完成 5 章再獲得 3 個錦囊。",
                    color = TextDim,
                    style = MaterialTheme.typography.labelMedium,
                    modifier = Modifier.padding(top = 6.dp),
                )
            }
        }
    }
}

@Composable
private fun CollectionHeader(name: String, progress: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(top = 10.dp, bottom = 2.dp),
        verticalAlignment = Alignment.Bottom,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Text(
            text = name,
            color = GoldSoft,
            style = MaterialTheme.typography.titleMedium,
            letterSpacing = 2.sp,
        )
        Text(text = progress, color = TextDim, style = MaterialTheme.typography.labelMedium)
    }
}

@Composable
private fun ChapterCard(chapter: ChapterSummary, onClick: () -> Unit) {
    val shape = RoundedCornerShape(14.dp)
    Column(
        modifier = Modifier
            .clip(shape)
            .background(Ink700)
            .border(
                width = 1.dp,
                color = when {
                    chapter.completed -> Jade.copy(alpha = 0.6f)
                    chapter.locked -> Color.White.copy(alpha = 0.06f)
                    else -> Color.White.copy(alpha = 0.1f)
                },
                shape = shape,
            )
            .clickable { onClick() },
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .aspectRatio(3f / 4f)
                .background(Ink600),
        ) {
            AssetImage(
                name = chapter.thumbName,
                contentDescription = chapter.title,
                modifier = Modifier
                    .fillMaxSize()
                    .graphicsLayer { alpha = if (chapter.locked) 0.45f else 1f },
                contentScale = ContentScale.Crop,
            )
            Chip(
                text = "第 ${chapter.id} 章",
                modifier = Modifier
                    .align(Alignment.TopStart)
                    .padding(8.dp),
                accent = if (chapter.locked) TextDim else GoldSoft,
            )
            if (chapter.locked) {
                Box(
                    modifier = Modifier
                        .align(Alignment.BottomCenter)
                        .padding(8.dp)
                        .clip(RoundedCornerShape(8.dp))
                        .background(Ink900.copy(alpha = 0.85f))
                        .border(1.dp, Vermilion.copy(alpha = 0.5f), RoundedCornerShape(8.dp))
                        .padding(horizontal = 8.dp, vertical = 5.dp),
                ) {
                    Text(
                        text = "🔒 先完成第 ${chapter.requiresLevel} 章",
                        color = Color(0xFFFFE9D6),
                        style = MaterialTheme.typography.labelMedium,
                    )
                }
            }
            if (chapter.completed) {
                Box(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .padding(8.dp)
                        .clip(RoundedCornerShape(50))
                        .background(Jade)
                        .padding(horizontal = 9.dp, vertical = 4.dp),
                ) {
                    Text(
                        "✓ 已破",
                        color = Color(0xFF06231A),
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
        }
        Column(
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            Text(
                text = chapter.title,
                color = Paper,
                style = MaterialTheme.typography.titleMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            Text(
                text = if (chapter.locked) "尚未解鎖" else chapter.era,
                color = if (chapter.locked) TextDim else Gold,
                style = MaterialTheme.typography.labelMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            ProgressBar(fraction = if (chapter.locked) 0f else chapter.foundCount.toFloat() / chapter.objectCount.coerceAtLeast(1))
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(
                    text = if (chapter.locked) {
                        "完成第 ${chapter.requiresLevel} 章即可進入"
                    } else {
                        "${chapter.foundCount}/${chapter.objectCount}"
                    },
                    color = TextDim,
                    style = MaterialTheme.typography.labelMedium,
                )
                if (!chapter.locked) {
                    chapter.bestMs?.let {
                        Text(
                            text = "· 最佳 ${GameRules.formatTime(it)}",
                            color = TextDim,
                            style = MaterialTheme.typography.labelMedium,
                        )
                    }
                }
            }
            Spacer(Modifier.height(0.dp))
        }
    }
}
