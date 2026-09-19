package com.photohunter.game.ui

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.max
import kotlin.math.roundToInt
import com.photohunter.game.UiState
import com.photohunter.game.data.LevelObject
import com.photohunter.game.game.GameRules

@Composable
fun GameScreen(
    state: UiState,
    onBack: () -> Unit,
    onToggleMute: () -> Unit,
    onTap: (Float, Float) -> Unit,
    onHint: () -> Unit,
    onObjectInfo: (Int) -> Unit,
) {
    val level = state.level ?: return
    val objects = level.objects
    val foundCount = state.found.size

    Column(Modifier.fillMaxSize()) {
        HunterTopBar(
            title = level.title,
            subtitle = listOf(level.era, level.subtitle).filter { it.isNotEmpty() }.joinToString(" · "),
            onBack = onBack,
            muted = state.muted,
            onToggleMute = onToggleMute,
            trailing = { TimerChip(GameRules.formatTime(state.elapsedMs)) },
        )

        // ── HUD ───────────────────────────────────────────────────────────
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 14.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Row(verticalAlignment = Alignment.Bottom) {
                Text(
                    text = "$foundCount",
                    color = GoldSoft,
                    style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold,
                )
                Text(
                    text = "/${level.objectCount}",
                    color = TextDim,
                    style = MaterialTheme.typography.labelLarge,
                    modifier = Modifier.padding(bottom = 3.dp),
                )
            }
            Row(
                modifier = Modifier.weight(1f),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                objects.forEach { entry ->
                    val found = entry.id in state.found
                    Box(
                        Modifier
                            .weight(1f)
                            .height(6.dp)
                            .clip(RoundedCornerShape(50))
                            .background(
                                when {
                                    found && entry.id in state.revealed -> Jade
                                    found -> Gold
                                    else -> Color.White.copy(alpha = 0.1f)
                                },
                            ),
                    )
                }
            }
            Button(
                onClick = onHint,
                enabled = state.hints > 0,
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = Vermilion,
                    contentColor = Color(0xFFFFEEDE),
                    disabledContainerColor = Vermilion.copy(alpha = 0.35f),
                    disabledContentColor = Color(0xFFFFEEDE).copy(alpha = 0.6f),
                ),
                contentPadding = PaddingValues(horizontal = 14.dp, vertical = 8.dp),
            ) {
                Text("錦囊", style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold)
                Text(
                    text = " ×${state.hints}",
                    style = MaterialTheme.typography.labelLarge,
                    fontWeight = FontWeight.Bold,
                )
            }
        }

        // ── photo ─────────────────────────────────────────────────────────
        PhotoStage(
            state = state,
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .padding(horizontal = 12.dp),
            onTap = onTap,
        )

        // ── found strip ───────────────────────────────────────────────────
        LazyRow(
            modifier = Modifier
                .fillMaxWidth()
                .padding(vertical = 12.dp),
            contentPadding = PaddingValues(horizontal = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(7.dp),
        ) {
            items(objects, key = { it.id }) { entry ->
                val found = entry.id in state.found
                val revealed = entry.id in state.revealed
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(10.dp))
                        .background(
                            when {
                                !found -> Color.White.copy(alpha = 0.04f)
                                revealed -> Jade
                                else -> Gold
                            },
                        )
                        .then(
                            if (found) Modifier.clickable { onObjectInfo(entry.id) } else Modifier,
                        )
                        .padding(horizontal = 10.dp, vertical = 7.dp),
                ) {
                    Text(
                        text = if (found) entry.name else "？？？",
                        color = when {
                            !found -> TextDim
                            revealed -> Color(0xFF06231A)
                            else -> Color(0xFF241A08)
                        },
                        style = MaterialTheme.typography.labelMedium,
                        fontWeight = if (found) FontWeight.Bold else FontWeight.Normal,
                        maxLines = 1,
                    )
                }
            }
        }
    }
}

@Composable
private fun PhotoStage(
    state: UiState,
    modifier: Modifier = Modifier,
    onTap: (Float, Float) -> Unit,
) {
    val level = state.level ?: return
    BoxWithConstraints(
        modifier = modifier.clip(RoundedCornerShape(14.dp)).background(Ink800),
        contentAlignment = Alignment.Center,
    ) {
        val aspect = if (level.imageHeight > 0) level.imageWidth.toFloat() / level.imageHeight else 0.75f
        val availableW = maxWidth.value
        val availableH = maxHeight.value
        val stageW = if (availableH <= 0f) availableW else minOf(availableW, availableH * aspect)
        val stageH = if (aspect <= 0f) availableH else stageW / aspect

        val widthDp = stageW.dp
        val heightDp = stageH.dp
        val objects = level.objects

        val density = LocalDensity.current
        val stagePxW = with(density) { widthDp.toPx() }
        val stagePxH = with(density) { heightDp.toPx() }

        // Zoom state, reset whenever a different chapter is opened.
        var scale by remember(level.id) { mutableStateOf(1f) }
        var offset by remember(level.id) { mutableStateOf(Offset.Zero) }

        fun clampOffset(candidate: Offset, atScale: Float): Offset {
            val minX = -(atScale - 1f) * stagePxW
            val minY = -(atScale - 1f) * stagePxH
            return Offset(candidate.x.coerceIn(minX, 0f), candidate.y.coerceIn(minY, 0f))
        }

        fun zoomAround(centre: Offset, nextScale: Float) {
            val next = nextScale.coerceIn(MIN_ZOOM, MAX_ZOOM)
            val factor = next / scale
            val candidate = Offset(
                centre.x - (centre.x - offset.x) * factor,
                centre.y - (centre.y - offset.y) * factor,
            )
            scale = next
            offset = clampOffset(candidate, next)
        }

        Box(
            modifier = Modifier
                .size(widthDp, heightDp)
                .border(1.dp, Gold.copy(alpha = 0.16f), RoundedCornerShape(14.dp))
                // Both gesture handlers work in the *untransformed* stage space, so
                // a tap is converted with the same scale/offset used for drawing
                // instead of relying on layer hit testing.
                .pointerInput(level.id) {
                    detectTapGestures { position ->
                        val localX = (position.x - offset.x) / scale
                        val localY = (position.y - offset.y) / scale
                        if (localX < 0f || localY < 0f || localX > stagePxW || localY > stagePxH) {
                            return@detectTapGestures // tapped the letterbox, not the photo
                        }
                        onTap(localX / stagePxW, localY / stagePxH)
                    }
                }
                .pointerInput(level.id) {
                    detectTransformGestures { centroid, pan, zoom, _ ->
                        val next = (scale * zoom).coerceIn(MIN_ZOOM, MAX_ZOOM)
                        if (next == scale && pan == Offset.Zero) return@detectTransformGestures
                        val factor = next / scale
                        // Keep the photo point under the gesture centroid fixed.
                        val candidate = Offset(
                            centroid.x - (centroid.x - offset.x) * factor + pan.x,
                            centroid.y - (centroid.y - offset.y) * factor + pan.y,
                        )
                        scale = next
                        offset = clampOffset(candidate, next)
                    }
                },
        ) {
            Box(
                modifier = Modifier
                    .matchParentSize()
                    .graphicsLayer {
                        scaleX = scale
                        scaleY = scale
                        translationX = offset.x
                        translationY = offset.y
                        transformOrigin = TransformOrigin(0f, 0f)
                    },
            ) {
                AssetImage(
                    name = level.image,
                    contentDescription = level.title,
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.FillBounds,
                )

                objects.forEachIndexed { index, entry ->
                    if (entry.id !in state.found) return@forEachIndexed
                    FoundMarker(
                        target = entry,
                        index = index,
                        revealed = entry.id in state.revealed,
                        stageWidth = widthDp,
                        stageHeight = heightDp,
                        zoom = scale,
                    )
                }

                state.hintTarget?.let { target ->
                    HintRing(target = target, stageWidth = widthDp, stageHeight = heightDp, zoom = scale)
                }
            }

            // Controls live outside the transformed box so they keep their size.
            Row(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .padding(8.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(Ink900.copy(alpha = 0.72f))
                    .border(1.dp, Gold.copy(alpha = 0.28f), RoundedCornerShape(12.dp))
                    .padding(4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                ZoomButton(label = "−", enabled = scale > MIN_ZOOM + 0.001f) {
                    zoomAround(Offset(stagePxW / 2f, stagePxH / 2f), scale / ZOOM_STEP)
                }
                ZoomButton(label = "${(scale * 100).roundToInt()}%", enabled = scale > MIN_ZOOM + 0.001f, wide = true) {
                    scale = 1f
                    offset = Offset.Zero
                }
                ZoomButton(label = "＋", enabled = scale < MAX_ZOOM - 0.001f) {
                    zoomAround(Offset(stagePxW / 2f, stagePxH / 2f), scale * ZOOM_STEP)
                }
            }
        }
    }
}

private const val MIN_ZOOM = 1f
private const val MAX_ZOOM = 4f
private const val ZOOM_STEP = 1.35f

@Composable
private fun ZoomButton(label: String, enabled: Boolean, wide: Boolean = false, onClick: () -> Unit) {
    Box(
        modifier = Modifier
            .size(width = if (wide) 56.dp else 32.dp, height = 32.dp)
            .clip(RoundedCornerShape(9.dp))
            .background(Color.White.copy(alpha = if (enabled) 0.08f else 0.03f))
            .then(if (enabled) Modifier.clickable { onClick() } else Modifier),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            color = if (enabled) GoldSoft else TextDim.copy(alpha = 0.5f),
            style = MaterialTheme.typography.labelMedium,
        )
    }
}

@Composable
private fun FoundMarker(
    target: LevelObject,
    index: Int,
    revealed: Boolean,
    stageWidth: androidx.compose.ui.unit.Dp,
    stageHeight: androidx.compose.ui.unit.Dp,
    zoom: Float,
) {
    // The ring hugs the object, but never drops below ~44 screen pixels: the
    // floor shrinks as the photo is zoomed in so a ring cannot balloon.
    val minScreen = 44.dp / zoom
    val markerW = max(stageWidth * target.bbox[2], minScreen)
    val markerH = max(stageHeight * target.bbox[3], minScreen)
    val centerX = stageWidth * target.centerX
    val centerY = stageHeight * target.centerY
    val accent = if (revealed) Jade else Gold

    Box(
        modifier = Modifier
            .offset(x = centerX - markerW / 2, y = centerY - markerH / 2)
            .size(markerW, markerH),
        contentAlignment = Alignment.Center,
    ) {
        Box(
            Modifier
                .fillMaxSize()
                .border(2.dp / zoom, accent, CircleShape),
        )
        Box(
            modifier = Modifier
                .size(18.dp / zoom)
                .clip(CircleShape)
                .background(if (revealed) Color(0xFFB6E3CA) else GoldSoft),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = "${index + 1}",
                color = Color(0xFF241A08),
                style = MaterialTheme.typography.labelMedium.copy(fontSize = MaterialTheme.typography.labelMedium.fontSize / zoom),
                fontWeight = FontWeight.Bold,
            )
        }
        Box(
            modifier = Modifier
                .align(Alignment.BottomCenter)
                .offset(y = 22.dp / zoom)
                .clip(RoundedCornerShape(8.dp / zoom))
                .background(Paper.copy(alpha = 0.94f))
                .padding(horizontal = 8.dp / zoom, vertical = 3.dp / zoom),
        ) {
            Text(
                text = target.name,
                color = Color(0xFF241A08),
                style = MaterialTheme.typography.labelMedium.copy(fontSize = MaterialTheme.typography.labelMedium.fontSize / zoom),
                fontWeight = FontWeight.Bold,
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun HintRing(
    target: LevelObject,
    stageWidth: androidx.compose.ui.unit.Dp,
    stageHeight: androidx.compose.ui.unit.Dp,
    zoom: Float,
) {
    val transition = rememberInfiniteTransition(label = "hint-ring")
    val alpha by transition.animateFloat(
        initialValue = 0.35f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(700), RepeatMode.Reverse),
        label = "hint-alpha",
    )
    val ringW = max(stageWidth * target.bbox[2] * 1.6f, 88.dp / zoom)
    val ringH = max(stageHeight * target.bbox[3] * 1.6f, 88.dp / zoom)
    Box(
        modifier = Modifier
            .offset(
                x = stageWidth * target.centerX - ringW / 2,
                y = stageHeight * target.centerY - ringH / 2,
            )
            .width(ringW)
            .height(ringH)
            .border(3.dp / zoom, Vermilion.copy(alpha = alpha), CircleShape),
    )
}
