package com.photohunter.game.data

import android.content.Context
import java.security.MessageDigest

/**
 * Accounts on this device.
 *
 * A nickname is an account, exactly like the web build: signing in with a name
 * loads that name's progress, 錦囊, score records and settings. Each account gets
 * its own SQLite file, which keeps the data completely separate and makes
 * "reset" simply mean "clear this account's file".
 *
 * The database used before accounts existed (photo_hunter.db) is adopted by the
 * first nickname that signs in, so an existing player keeps their progress.
 */
class AccountStore(context: Context) {

    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private val legacyFile = context.getDatabasePath(LEGACY_DATABASE)

    /** The nickname remembered from the last session (not necessarily signed in). */
    var lastNickname: String?
        get() = prefs.getString(KEY_LAST, null)
        set(value) = prefs.edit().putString(KEY_LAST, value).apply()

    /** Every nickname that has an account on this device. */
    fun accounts(): List<String> =
        prefs.getStringSet(KEY_ACCOUNTS, emptySet()).orEmpty().sorted()

    /**
     * Resolve the database file for [nickname], registering it if needed.
     * The legacy database is claimed by the first account that asks for it.
     */
    fun databaseFor(nickname: String): String {
        prefs.getString(dbKey(nickname), null)?.let { return it }

        val claimed = prefs.getBoolean(KEY_LEGACY_CLAIMED, false)
        val adoptLegacy = !claimed && legacyFile.exists()
        val name = if (adoptLegacy) LEGACY_DATABASE else "${DATABASE_PREFIX}${hash(nickname)}.db"

        prefs.edit()
            .putString(dbKey(nickname), name)
            .putStringSet(KEY_ACCOUNTS, accounts().toMutableSet().apply { add(nickname) })
            .putString(KEY_LAST, nickname)
            .putBoolean(KEY_LEGACY_CLAIMED, claimed || adoptLegacy)
            .apply()
        return name
    }

    /** True when [nickname] reuses the pre-accounts database (progress carried over). */
    fun adoptedLegacy(nickname: String): Boolean =
        prefs.getString(dbKey(nickname), null) == LEGACY_DATABASE

    fun forget(nickname: String) {
        val remaining = accounts().toMutableSet().apply { remove(nickname) }
        prefs.edit()
            .remove(dbKey(nickname))
            .putStringSet(KEY_ACCOUNTS, remaining)
            .apply()
    }

    private fun dbKey(nickname: String) = "db:$nickname"

    private fun hash(nickname: String): String {
        val digest = MessageDigest.getInstance("SHA-1").digest(nickname.toByteArray(Charsets.UTF_8))
        return digest.take(6).joinToString("") { "%02x".format(it) }
    }

    private companion object {
        const val PREFS = "photo_hunter_accounts"
        const val KEY_LAST = "last_nickname"
        const val KEY_ACCOUNTS = "accounts"
        const val KEY_LEGACY_CLAIMED = "legacy_claimed"
        const val LEGACY_DATABASE = "photo_hunter.db"
        const val DATABASE_PREFIX = "photo_hunter_"
    }
}
