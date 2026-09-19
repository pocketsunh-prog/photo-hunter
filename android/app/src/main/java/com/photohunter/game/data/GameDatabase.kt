package com.photohunter.game.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase

@Database(
    entities = [
        PlayerEntity::class,
        LevelEntity::class,
        LevelObjectEntity::class,
        ProgressEntity::class,
        SessionEntity::class,
        HintEventEntity::class,
        HintGrantEntity::class,
        MetaEntity::class,
    ],
    version = 1,
    exportSchema = true,
)
abstract class GameDatabase : RoomDatabase() {

    abstract fun dao(): GameDao

    companion object {
        private const val NAME = "photo_hunter.db"

        @Volatile
        private var instance: GameDatabase? = null

        fun get(context: Context): GameDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    GameDatabase::class.java,
                    NAME,
                )
                    // Chapters live in the APK assets; if the on-disk schema ever
                    // changes, rebuilding from assets is harmless (player rows are
                    // re-created with default values only when the table is empty).
                    .fallbackToDestructiveMigration()
                    .build()
                    .also { instance = it }
            }
    }
}
