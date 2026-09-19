package com.photohunter.game.data

import android.content.Context
import org.json.JSONObject

/**
 * Reads the chapter definitions bundled in the assets levels folder.
 *
 * These files are produced by the annotation pipeline and mirrored by
 * tools/sync_levels.py; the web app seeds MySQL from the very same JSON, so both
 * builds always contain the identical ten objects and hit boxes.
 */
object LevelCatalog {

    fun load(context: Context): List<LevelDefinition> {
        val names = context.assets.list("levels")
            ?.filter { it.endsWith(".json") }
            ?.sorted()
            ?: emptyList()
        return names
            .map { name ->
                context.assets.open("levels/$name").bufferedReader().use { it.readText() }
            }
            .map { parse(it) }
            .sortedBy { it.id }
    }

    private fun parse(text: String): LevelDefinition {
        val json = JSONObject(text)
        val objectsJson = json.getJSONArray("objects")
        val objects = ArrayList<LevelObject>(objectsJson.length())
        for (i in 0 until objectsJson.length()) {
            val o = objectsJson.getJSONObject(i)
            val bbox = o.getJSONArray("bbox")
            objects += LevelObject(
                id = o.getInt("id"),
                name = o.getString("name"),
                nameEn = o.optString("nameEn", ""),
                reason = o.optString("reason", ""),
                hint = o.optString("hint", ""),
                bbox = floatArrayOf(
                    bbox.getDouble(0).toFloat(),
                    bbox.getDouble(1).toFloat(),
                    bbox.getDouble(2).toFloat(),
                    bbox.getDouble(3).toFloat(),
                ),
                confidence = o.optString("confidence", "high"),
            )
        }
        return LevelDefinition(
            id = json.getInt("id"),
            slug = json.optString("slug", "chapter-${json.getInt("id")}"),
            title = json.getString("title"),
            subtitle = json.optString("subtitle", ""),
            era = json.optString("era", ""),
            image = json.getString("image"),
            imageWidth = json.optInt("imageWidth", 1440),
            imageHeight = json.optInt("imageHeight", 1920),
            objectCount = objects.size,
            objects = objects,
        )
    }
}
