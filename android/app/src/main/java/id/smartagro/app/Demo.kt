package id.smartagro.app

import android.content.Context
import org.json.JSONArray
import java.time.Instant

private val epoch = Instant.parse("2026-11-15T00:00:00Z")
private fun scenarios(context: Context) = context.assets.open("demo-scenarios.json").bufferedReader().use { JSONArray(it.readText()).objects(30) }
private fun samples(json: org.json.JSONObject): List<Reading> = json.array("samples").objects(200).flatMap { sample ->
    val valid = sample.getBoolean("valid")
    val at = epoch.plusSeconds((sample.getDouble("t_h")*3600).toLong())
    listOf(Sensor.Moisture to "moisture", Sensor.Temperature to "temp_c", Sensor.Ph to "ph").map { (sensor, key) ->
        val value = sample.nullableNumber(key)
        Reading(sensor, if (!valid) "error" else if (value == null) "not_measured" else "ok", if (valid) value else null, at)
    }
}
fun readDemo(context: Context): AppState {
    val json = scenarios(context)
    val crops = json.map { it.getJSONObject("profile").text("crop") }.distinct()
    val products = crops.mapIndexed { i, _ -> Product("demo-$i", "LATIHAN-${i+1}", "single_pot") }
    val units = json.mapIndexed { i, item ->
        val crop = item.getJSONObject("profile").text("crop")
        PlantUnit("case-$i", products[crops.indexOf(crop)].id, item.text("name"), crop)
    }
    val overviews = json.mapIndexed { i, item ->
        val latest = samples(item).takeLast(3)
        Overview("case-$i", latest.first().at, emptyList(), latest, null)
    }
    val advice = json.mapIndexed { i, item -> val result = item.getJSONObject("result"); "case-$i" to (result.text("action") to result.text("reason", 2000)) }.toMap()
    return AppState(screen = Screen.Products, products = products, units = units, overviews = overviews,
        catalogLoaded = true, demo = true, demoAdvice = advice, email = "Mode latihan tanpa akun")
}
fun demoHistory(context: Context, unitId: String): List<Reading> {
    val index = unitId.removePrefix("case-").toInt()
    return samples(scenarios(context)[index]).sortedByDescending { it.at }
}
