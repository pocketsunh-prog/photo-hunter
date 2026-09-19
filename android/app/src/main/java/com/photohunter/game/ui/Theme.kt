package com.photohunter.game.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp

// Ink & scroll palette - kept in sync with web/public/styles.css.
val Ink900 = Color(0xFF100D0A)
val Ink800 = Color(0xFF17130F)
val Ink700 = Color(0xFF201A14)
val Ink600 = Color(0xFF2B231B)
val Paper = Color(0xFFF4E9D6)
val PaperDim = Color(0xFFCDBFA6)
val TextDim = Color(0xFFA3947C)
val Gold = Color(0xFFD9A441)
val GoldSoft = Color(0xFFF0CD82)
val Vermilion = Color(0xFFC0442F)
val Jade = Color(0xFF5D9C7E)

private val HunterColorScheme = darkColorScheme(
    primary = Gold,
    onPrimary = Color(0xFF241A08),
    primaryContainer = Color(0xFF3A2C11),
    onPrimaryContainer = GoldSoft,
    secondary = Jade,
    onSecondary = Color(0xFF06231A),
    tertiary = Vermilion,
    onTertiary = Color(0xFFFFEEDE),
    background = Ink900,
    onBackground = Paper,
    surface = Ink800,
    onSurface = Paper,
    surfaceVariant = Ink700,
    onSurfaceVariant = PaperDim,
    outline = Color(0x55D9A441),
    outlineVariant = Color(0x22F4E9D6),
    error = Vermilion,
    onError = Color(0xFFFFEEDE),
)

private val HunterTypography = Typography().run {
    copy(
        headlineLarge = headlineLarge.copy(fontSize = 44.sp, fontWeight = FontWeight.Bold, letterSpacing = 6.sp),
        headlineMedium = headlineMedium.copy(fontSize = 26.sp, fontWeight = FontWeight.Bold, letterSpacing = 2.sp),
        titleLarge = titleLarge.copy(fontSize = 19.sp, fontWeight = FontWeight.SemiBold),
        titleMedium = titleMedium.copy(fontSize = 16.sp, fontWeight = FontWeight.SemiBold),
        bodyLarge = bodyLarge.copy(fontSize = 15.sp, lineHeight = 24.sp),
        bodyMedium = bodyMedium.copy(fontSize = 13.5.sp, lineHeight = 21.sp),
        labelLarge = labelLarge.copy(fontSize = 14.sp, letterSpacing = 1.sp),
        labelMedium = labelMedium.copy(fontSize = 11.5.sp, letterSpacing = 1.sp),
    )
}

@Composable
fun PhotoHunterTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = HunterColorScheme,
        typography = HunterTypography,
        content = content,
    )
}
