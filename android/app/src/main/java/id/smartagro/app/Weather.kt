package id.smartagro.app

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder
import java.time.Instant

/** External city-level weather; never a substitute for the plant's physical sensors. */
data class WeatherPlace(val id: Long, val name: String, val region: String, val latitude: Double, val longitude: Double) {
    val label get() = listOf(name,region).filter { it.isNotBlank() }.distinct().joinToString(", ")
    fun json() = JSONObject().put("id",id).put("name",name).put("region",region).put("latitude",latitude).put("longitude",longitude)
}
fun parsePlace(row: JSONObject): WeatherPlace {
    val latitude = row.nullableNumber("latitude") ?: throw IllegalArgumentException("Lokasi tidak valid.")
    val longitude = row.nullableNumber("longitude") ?: throw IllegalArgumentException("Lokasi tidak valid.")
    require(latitude in -90.0..90.0 && longitude in -180.0..180.0) { "Koordinat lokasi tidak valid." }
    val region = if (row.has("region")) row.optString("region") else listOf(row.optString("admin1"),row.optString("country")).filter { it.isNotBlank() }.joinToString(", ")
    require(region.length<=240 && region.none(Char::isISOControl)) { "Lokasi tidak valid." }
    return WeatherPlace(row.whole("id",1),row.text("name",120),region,latitude,longitude)
}
fun parsePlaces(json: JSONObject): List<WeatherPlace> {
    if (!json.has("results")) return emptyList()
    return json.array("results").objects(10).map(::parsePlace)
}
data class Weather(val at: Instant, val temperature: Double, val humidity: Double, val wind: Double, val radiation: Double, val code: Int, val daylight: Boolean) {
    fun stale(now: Instant) = at.isBefore(now.minusSeconds(7200)) || at.isAfter(now.plusSeconds(900))
    val label get() = when(code) {
        0 -> "Cerah"; 1,2 -> "Cerah berawan"; 3 -> "Berawan"; 45,48 -> "Berkabut"
        51,53,55,56,57 -> "Gerimis"; 61,63,65,66,67,80,81,82 -> "Hujan"
        71,73,75,77,85,86 -> "Salju"; 95,96,99 -> "Badai petir"; else -> "Cuaca berubah"
    }
}
fun parseWeather(json: JSONObject): Weather {
    val units = json.getJSONObject("current_units")
    require(units.optString("temperature_2m")=="°C" && units.optString("wind_speed_10m")=="km/h" && units.optString("shortwave_radiation")=="W/m²" && units.optString("relative_humidity_2m")=="%" && units.optString("time")=="unixtime") { "Satuan cuaca tidak sesuai." }
    val row = json.getJSONObject("current")
    fun value(key: String, min: Double, max: Double) = requireNotNull(row.nullableNumber(key)).also { require(it in min..max) { "Nilai cuaca tidak valid." } }
    return Weather(Instant.ofEpochSecond(row.whole("time",1,32_503_680_000L)),value("temperature_2m",-100.0,70.0),value("relative_humidity_2m",0.0,100.0),
        value("wind_speed_10m",0.0,500.0),value("shortwave_radiation",0.0,2000.0),row.whole("weather_code",0,99).toInt(),row.whole("is_day",0,1)==1L)
}
internal suspend fun publicWeatherJson(url: String): JSONObject = withContext(Dispatchers.IO) {
    val uri = URI(url)
    require(uri.scheme=="https" && uri.host in listOf("api.open-meteo.com","geocoding-api.open-meteo.com") && uri.userInfo==null)
    val connection = uri.toURL().openConnection() as HttpURLConnection
    try {
        connection.connectTimeout=10000; connection.readTimeout=15000; connection.instanceFollowRedirects=false
        require(connection.responseCode==200) { "Cuaca belum dapat dimuat. Coba lagi nanti." }
        val bytes = connection.inputStream.use { input ->
            val output=java.io.ByteArrayOutputStream();val buffer=ByteArray(8192)
            while(output.size()<=262144) { val count=input.read(buffer);if(count<0) break;output.write(buffer,0,count) }
            output.toByteArray()
        }
        require(bytes.size<=262144) { "Respons cuaca terlalu besar." }
        JSONObject(String(bytes,Charsets.UTF_8))
    } finally { connection.disconnect() }
}
suspend fun searchWeatherPlaces(raw: String): List<WeatherPlace> {
    val query=raw.trim()
    require(query.length in 2..80 && query.none(Char::isISOControl)) { "Isi nama kota, 2-80 karakter." }
    return parsePlaces(publicWeatherJson("https://geocoding-api.open-meteo.com/v1/search?name=${URLEncoder.encode(query,"UTF-8")}&count=6&language=id&format=json"))
}
suspend fun fetchWeather(place: WeatherPlace): Weather = parseWeather(publicWeatherJson("https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,relative_humidity_2m,weather_code,is_day,wind_speed_10m,shortwave_radiation&timeformat=unixtime&timezone=UTC"))
