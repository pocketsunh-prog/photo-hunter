package com.photohunter.game.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/** Small rounded pill, used for 錦囊 counts and status labels. */
@Composable
fun Chip(
    text: String,
    modifier: Modifier = Modifier,
    accent: Color = Gold,
    onClick: (() -> Unit)? = null,
) {
    val shape = RoundedCornerShape(50)
    Box(
        modifier = modifier
            .clip(shape)
            .background(accent.copy(alpha = 0.12f))
            .border(1.dp, accent.copy(alpha = 0.3f), shape)
            .then(if (onClick != null) Modifier.clickable { onClick() } else Modifier)
            .padding(horizontal = 12.dp, vertical = 7.dp),
    ) {
        Text(text = text, color = accent, style = MaterialTheme.typography.labelMedium)
    }
}

/** One number + caption, used on the chapter-select and result screens. */
@Composable
fun StatBox(value: String, caption: String, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .background(Color.White.copy(alpha = 0.05f))
            .border(1.dp, Color.White.copy(alpha = 0.09f), RoundedCornerShape(12.dp))
            .padding(vertical = 12.dp, horizontal = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        Text(
            text = value,
            color = GoldSoft,
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
        )
        Text(
            text = caption,
            color = TextDim,
            style = MaterialTheme.typography.labelMedium,
            textAlign = TextAlign.Center,
        )
    }
}

/** Three-across stat row. */
@Composable
fun StatRow(items: List<Pair<String, String>>, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        items.forEach { (value, caption) ->
            StatBox(value = value, caption = caption, modifier = Modifier.weight(1f))
        }
    }
}

/** Thin progress bar; hand drawn so it always matches the theme. */
@Composable
fun ProgressBar(
    fraction: Float,
    modifier: Modifier = Modifier,
    color: Color = Gold,
    height: Dp = 4.dp,
) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .height(height)
            .clip(RoundedCornerShape(50))
            .background(Color.White.copy(alpha = 0.12f)),
    ) {
        Box(
            Modifier
                .fillMaxWidth(fraction.coerceIn(0f, 1f))
                .height(height)
                .clip(RoundedCornerShape(50))
                .background(Brush.horizontalGradient(listOf(color, GoldSoft))),
        )
    }
}
