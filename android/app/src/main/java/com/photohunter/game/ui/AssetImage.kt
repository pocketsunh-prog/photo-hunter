package com.photohunter.game.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import com.photohunter.game.data.AssetImages

/**
 * Draws a photo or thumbnail from assets, decoding off the main thread.
 * Shows the placeholder colour until the bitmap is ready.
 */
@Composable
fun AssetImage(
    name: String,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    contentScale: ContentScale = ContentScale.Crop,
) {
    val context = LocalContext.current
    var bitmap: ImageBitmap? by remember(name) { mutableStateOf(AssetImages.cached(name)) }
    LaunchedEffect(name) {
        if (bitmap == null) bitmap = AssetImages.load(context, name)
    }
    val current = bitmap
    if (current != null) {
        Image(
            bitmap = current,
            contentDescription = contentDescription,
            modifier = modifier,
            contentScale = contentScale,
        )
    } else {
        Box(modifier.background(Ink600))
    }
}
