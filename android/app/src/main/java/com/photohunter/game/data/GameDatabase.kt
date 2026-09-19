package com.photohunter.game.data

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

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
    version = 2,
    exportSchema = true,
)
abstract class GameDatabase : RoomDatabase() {

    abstract fun dao(): GameDao

    companion object {
        private const val NAME = "photo_hunter.db"

        /**
         * v1 -> v2: chapters gained a `collection` column so the level map can be
         * grouped by volume. A real migration is used (instead of the destructive
         * fallback) so an existing player keeps their progress, 錦囊 and records.
         */
        private val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(db: SupportSQLiteDatabase) {
                db.execSQL("ALTER TABLE levels ADD COLUMN collection TEXT NOT NULL DEFAULT ''")
            }
        }

        @Volatile
        private var instance: GameDatabase? = null

        fun get(context: Context): GameDatabase =
            instance ?: synchronized(this) {
                instance ?: Room.databaseBuilder(
                    context.applicationContext,
                    GameDatabase::class.java,
                    NAME,
                )
                    .addMigrations(MIGRATION_1_2)
                    // Last resort for a version with no migration path: chapters
                    // are re-seeded from the APK assets anyway.
                    .fallbackToDestructiveMigration()
                    .build()
                    .also { instance = it }
            }
    }
}
