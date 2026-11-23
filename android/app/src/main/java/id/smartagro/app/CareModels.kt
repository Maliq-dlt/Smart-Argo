package id.smartagro.app

import org.json.JSONObject
import java.time.Instant

data class CarePlant(val slotId: String, val unitId: String?, val name: String, val state: String, val bandSource: String?, val moisture: Double?, val measuredAt: Instant? = null)
data class WateringOutlook(val state: String, val from: Instant?, val to: Instant?, val bandSource: String?)
data class WateringRise(val from: Instant, val to: Instant, val delta: Double)
data class UnitHealth(val deviceId: String?, val volts: Double?, val daysLeft: Double?, val gaps: Int, val moistureAt: Instant?, val phAt: Instant?)
data class AlertPreferences(val emailEnabled: Boolean, val kinds: Set<String>)
internal val careKinds = linkedMapOf("soil_dry" to "Tanah kering", "battery_low" to "Baterai lemah", "device_silent" to "Perangkat tidak mengirim", "soil_hot" to "Tanah terlalu panas")
internal fun careOk(json: JSONObject): JSONObject = json.also { require(it.optBoolean("ok")) { "Data perawatan belum tersedia. Coba lagi." } }
/** The app can be newer than the server it talks to (cloud before a release): PostgREST answers 404 for a function
 *  it does not have yet, which means "not here", not "broken". Every other failure still reaches the caller. */
internal suspend fun <T> missingRpcAsNull(fetch: suspend () -> T): T? = try { fetch() }
    catch (error: ApiFailure) { if (error.status == 404 && !error.expired) null else throw error }
/** The server accepts IANA names only (pg_timezone_names); a phone set to a bare offset ("GMT+07:00") sends WIB. */
internal fun careZone(id: String = java.time.ZoneId.systemDefault().id) = if ('/' in id) id else "Asia/Jakarta"
private fun JSONObject.optionalTime(key: String) = if (isNull(key)) null else instant(key)
private fun JSONObject.optionalText(key: String) = if (isNull(key)) null else text(key)
fun parseCarePlants(json: JSONObject): List<CarePlant> = careOk(json).array("plants").objects().map {
    val state = it.text("state")
    require(state in setOf("below", "ok", "above", "learning", "no_device", "no_reading"))
    val source = it.optionalText("band_source")
    require(source == null || source in setOf("own_pattern", "profile"))
    CarePlant(it.id("slot_id"), if(it.isNull("unit_id")) null else it.id("unit_id"), it.text("name"), state, source, it.nullableNumber("moisture"), it.optionalTime("measured_at"))
}
fun parseOutlook(json: JSONObject): WateringOutlook = careOk(json).getJSONObject("outlook").let {
    val state = it.text("state"); require(state in setOf("below", "window", "waiting", "learning", "no_reading"))
    val from = it.optionalTime("from"); val to = it.optionalTime("to")
    require(state != "window" || from != null && to != null && !to.isBefore(from))
    WateringOutlook(state, from, to, it.optionalText("band_source"))
}
fun parseRises(json: JSONObject): List<WateringRise> = careOk(json).array("rises").objects().map {
    val from=it.instant("from");val to=it.instant("to");val delta=it.nullableNumber("delta")
    require(!to.isBefore(from) && delta != null && delta >= 5)
    WateringRise(from,to,delta)
}
fun parseUnitHealth(json: JSONObject): UnitHealth = careOk(json).let {
    val battery=it.array("battery").objects().maxByOrNull { row -> row.instant("at") }
    val calibration=it.optJSONObject("calibration")
    UnitHealth(if(it.isNull("device_id")) null else it.id("device_id"),battery?.nullableNumber("volts"),it.nullableNumber("battery_days_left"),it.array("upload_gaps").length(),calibration?.optionalTime("moisture_at"),calibration?.optionalTime("ph_at"))
}
fun parseAlertPreferences(json: JSONObject): AlertPreferences = careOk(json).let {
    require(it.opt("email_enabled") is Boolean)
    val kinds=it.array("kinds");val values=(0 until kinds.length()).map { i -> kinds.getString(i) }.toSet()
    require(values.all { kind -> kind in careKinds })
    AlertPreferences(it.getBoolean("email_enabled"),values)
}
internal fun bandSourceLabel(source: String?) = when(source) { "own_pattern" -> "Berdasarkan pola pot Anda"; "profile" -> "Profil kurasi untuk pot ini"; else -> "Pita perawatan belum tersedia" }
internal fun careStateLabel(state: String) = when(state) { "below" -> "Perlu disiram"; "ok" -> "Dalam pita pot"; "above" -> "Di atas pita pot"; "learning" -> "Sedang mempelajari pola pot"; "no_device" -> "Belum terhubung ke perangkat"; else -> "Menunggu bacaan sensor yang valid" }

internal fun careState(plant: CarePlant, now: Instant): String = if (plant.state in setOf("below", "ok", "above") && (plant.measuredAt == null || !fresh(plant.measuredAt, now))) "no_reading" else plant.state
