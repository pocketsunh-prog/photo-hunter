package com.photohunter.game.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material.icons.filled.MusicOff
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp

@Composable
fun HunterTopBar(
    title: String,
    subtitle: String,
    onBack: (() -> Unit)?,
    muted: Boolean,
    onToggleMute: () -> Unit,
    trailing: @Composable (() -> Unit)? = null,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(Ink900.copy(alpha = 0.96f))
            .padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        if (onBack != null) {
            IconButton(
                onClick = onBack,
                modifier = Modifier
                    .size(38.dp)
                    .clip(RoundedCornerShape(10.dp))
                    .background(Color.White.copy(alpha = 0.06f)),
            ) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "返回", tint = Paper)
            }
        }
        Column(Modifier.weight(1f)) {
            Text(
                text = title,
                color = Paper,
                style = MaterialTheme.typography.titleMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (subtitle.isNotEmpty()) {
                Text(
                    text = subtitle,
                    color = TextDim,
                    style = MaterialTheme.typography.labelMedium,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        trailing?.invoke()
        IconButton(
            onClick = onToggleMute,
            modifier = Modifier
                .size(38.dp)
                .clip(RoundedCornerShape(10.dp))
                .background(Color.White.copy(alpha = 0.06f)),
        ) {
            Icon(
                imageVector = if (muted) Icons.Filled.MusicOff else Icons.Filled.MusicNote,
                contentDescription = if (muted) "開啟背景音樂" else "關閉背景音樂",
                tint = if (muted) TextDim else GoldSoft,
            )
        }
    }
}

@Composable
fun TimerChip(text: String) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(9.dp))
            .background(Gold.copy(alpha = 0.12f))
            .padding(horizontal = 10.dp, vertical = 6.dp),
    ) {
        Text(text = text, color = GoldSoft, style = MaterialTheme.typography.labelLarge)
    }
}
