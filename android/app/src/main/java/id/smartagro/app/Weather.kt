package id.smartagro.app

import org.json.JSONObject
import java.time.LocalDateTime

/** Server forecast uses the location's local time, without an offset; never reinterpret it as UTC. */
data class ForecastHour(val inHours: Int, val condition: String, val rainMm: Double, val tempC: Double)
data class WeatherSnapshot(val at: String, val condition: String, val tempC: Double, val humidity: Double,
    val cloud: Double, val windMs: Double, val rainMm: Double, val forecast: List<ForecastHour>) {
    val label get() = when(condition) { "cerah" -> "Cerah"; "berawan" -> "Berawan"; "mendung" -> "Mendung"; "hujan" -> "Hujan"; else -> "Badai" }
}

internal fun parseWeatherSnapshot(json: JSONObject): WeatherSnapshot {
    fun condition(row: JSONObject) = row.text("condition",10).also {
        require(it in listOf("cerah","berawan","mendung","hujan","badai")) { "Kondisi cuaca tidak valid." }
    }
    fun value(row: JSONObject, key: String, range: ClosedFloatingPointRange<Double>) =
        requireNotNull(row.nullableNumber(key)).also { require(it in range) { "Nilai cuaca tidak valid." } }
    val at=json.text("at",32)
    LocalDateTime.parse(at)
    val forecast=json.array("forecast").objects(6).map { row ->
        ForecastHour(row.whole("inHours",1,6).toInt(),condition(row),value(row,"rainMm",0.0..1000.0),value(row,"tempC",-100.0..70.0))
    }
    require(forecast.zipWithNext().all { (a,b) -> a.inHours<b.inHours }) { "Urutan prakiraan tidak valid." }
    return WeatherSnapshot(at,condition(json),value(json,"tempC",-100.0..70.0),value(json,"humidity",0.0..100.0),
        value(json,"cloud",0.0..100.0),value(json,"windMs",0.0..150.0),value(json,"rainMm",0.0..1000.0),forecast)
}

/** Weather affects inspection and timing outdoors, never sensor readings or a watering amount. */
internal fun weatherNote(weather: WeatherSnapshot, placement: String): String? {
    if (placement=="indoor") return null
    if (weather.condition in listOf("hujan","badai")) return "Sedang hujan: pertimbangkan menunda siram."
    weather.forecast.firstOrNull { it.rainMm>=1.0 }?.let { return "Hujan sekitar ${it.inHours} jam lagi: pertimbangkan menunda siram." }
    return if(weather.tempC>=33.0) "Suhu tinggi: periksa media lebih sering." else null
}
