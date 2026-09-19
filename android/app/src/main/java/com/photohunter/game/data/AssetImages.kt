package com.photohunter.game.data

import android.content.Context
import android.graphics.BitmapFactory
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Decodes photos/thumbnails from assets with a tiny in-memory cache. */
object AssetImages {

    private val cache = HashMap<String, ImageBitmap>()

    suspend fun load(context: Context, name: String): ImageBitmap? = withContext(Dispatchers.IO) {
        cache[name] ?: runCatching {
            context.assets.open("images/$name").use { stream ->
                BitmapFactory.decodeStream(stream)?.asImageBitmap()
            }
        }.getOrNull()?.also { cache[name] = it }
    }

    fun cached(name: String): ImageBitmap? = cache[name]
}
