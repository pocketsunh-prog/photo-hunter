package com.photohunter.game.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.photohunter.game.UiState

@Composable
fun HomeScreen(
    state: UiState,
    onNicknameChange: (String) -> Unit,
    onStart: () -> Unit,
    onHelp: () -> Unit,
    onToggleMute: () -> Unit,
    onShowRanking: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(
                Brush.verticalGradient(
                    listOf(Ink900, Ink800, Ink900),
                ),
            )
            .imePadding()
            .padding(horizontal = 24.dp, vertical = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        // vermilion seal
        Box(
            modifier = Modifier
                .size(62.dp)
                .clip(RoundedCornerShape(12.dp))
                .background(Brush.linearGradient(listOf(Vermilion, Color(0xFF8E2C1D))))
                .border(2.dp, Color.White.copy(alpha = 0.18f), RoundedCornerShape(12.dp)),
            contentAlignment = Alignment.Center,
        ) {
            Text("尋", fontSize = 30.sp, color = Color(0xFFFFF2DD), fontWeight = FontWeight.Bold)
        }

        Spacer(Modifier.height(18.dp))
        Text(
            text = "十張古畫 · 一百件穿越之物",
            color = Gold,
            style = MaterialTheme.typography.labelMedium.copy(letterSpacing = 4.sp),
        )
        Spacer(Modifier.height(10.dp))
        Text(
            text = "尋物獵人",
            style = MaterialTheme.typography.headlineLarge.copy(
                brush = Brush.verticalGradient(listOf(Color(0xFFFFF4DE), GoldSoft, Color(0xFFB9862F))),
            ),
        )
        Spacer(Modifier.height(16.dp))
        Text(
            text = "每一張古畫裡，藏著十件不屬於那個年代的東西。\n把十件都找出來，才能翻到下一張。",
            color = PaperDim,
            style = MaterialTheme.typography.bodyMedium,
            textAlign = TextAlign.Center,
        )

        Spacer(Modifier.height(26.dp))
        OutlinedTextField(
            value = state.nickname,
            onValueChange = onNicknameChange,
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            label = { Text("你的名號") },
            shape = RoundedCornerShape(12.dp),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { onStart() }),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = Gold,
                unfocusedBorderColor = Gold.copy(alpha = 0.35f),
                focusedLabelColor = Gold,
                unfocusedLabelColor = TextDim,
                cursorColor = Gold,
                focusedTextColor = Paper,
                unfocusedTextColor = Paper,
            ),
        )

        Spacer(Modifier.height(18.dp))
        Button(
            onClick = onStart,
            modifier = Modifier
                .fillMaxWidth()
                .height(54.dp),
            shape = RoundedCornerShape(12.dp),
            colors = ButtonDefaults.buttonColors(containerColor = Gold, contentColor = Color(0xFF241A08)),
        ) {
            Text("開始尋物", style = MaterialTheme.typography.titleMedium)
        }
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.fillMaxWidth()) {
            OutlinedButton(
                onClick = onHelp,
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(12.dp),
            ) { Text("玩法說明") }
            OutlinedButton(
                onClick = onShowRanking,
                modifier = Modifier.weight(1f),
                shape = RoundedCornerShape(12.dp),
            ) { Text("成績榜") }
        }

        Spacer(Modifier.height(26.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Chip(
                text = if (state.muted) "♪ 音樂：關" else "♪ 音樂：開",
                accent = if (state.muted) TextDim else GoldSoft,
                onClick = onToggleMute,
            )
            Chip(text = "錦囊 ×${state.hints}", accent = Vermilion)
            Chip(text = "已過 ${state.levelsCleared} 章", accent = Jade)
        }

        Spacer(Modifier.height(14.dp))
        Text(
            text = "進度儲存在本機 SQLite 資料庫",
            color = TextDim,
            style = MaterialTheme.typography.labelMedium,
        )
    }
}
