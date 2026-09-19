package com.photohunter.game

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import com.photohunter.game.ui.PhotoHunterTheme

/**
 * 尋物獵人 Photo Hunter - single-activity Compose app.
 *
 * Everything lives on the device: the ten chapters ship in assets, progress and
 * the 錦囊 economy are stored in SQLite (Room), and the music/effects are
 * generated WAV files in res/raw.
 */
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            PhotoHunterTheme {
                PhotoHunterApp()
            }
        }
    }
}
