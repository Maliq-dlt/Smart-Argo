package id.smartagro.app

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.time.Instant

private fun invalid(): Nothing = throw IllegalArgumentException("Respons server tidak valid. Coba muat ulang.")
private val uuid = Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}")
internal fun JSONObject.id(key: String): String = text(key, 36).also { if (!uuid.matches(it)) invalid() }
internal fun JSONObject.text(key: String, max: Int = 240): String = (opt(key) as? String)
    ?.takeIf { it.isNotBlank() && it.length <= max } ?: invalid()
// Postgres sends +00:00, which Instant.parse rejects before Java 12 (Android 8-11). OffsetDateTime reads both forms.
internal fun JSONObject.instant(key: String): Instant = try { java.time.OffsetDateTime.parse(text(key, 64)).toInstant() } catch (_: Exception) { invalid() }
internal fun JSONArray.objects(max: Int = 1000): List<JSONObject> {
    if (length() > max) invalid()
    return (0 until length()).map { opt(it) as? JSONObject ?: invalid() }
}
internal fun JSONObject.array(key: String): JSONArray = optJSONArray(key) ?: invalid()
internal fun JSONObject.nullableNumber(key: String): Double? {
    if (!has(key)) invalid()
    if (isNull(key)) return null
    return (opt(key) as? Number)?.toDouble()?.takeIf { it.isFinite() } ?: invalid()
}

/** [allowEmulatorHost] is true only in debug builds: plain http to 10.0.2.2, the emulator's alias for the laptop running the
 * local backend. A release build passes false, so it accepts https alone. */
data class BackendConfig(val url: String, val anonKey: String, val allowEmulatorHost: Boolean = false) {
    val valid: Boolean get() = runCatching {
        val uri = URI(url)
        (uri.scheme == "https" || allowEmulatorHost && uri.scheme == "http" && uri.host == "10.0.2.2") && !uri.host.isNullOrBlank() && uri.userInfo == null &&
            uri.rawQuery == null && uri.rawFragment == null && uri.path.orEmpty().trim('/').isEmpty() &&
            anonKey.length in 10..8192 && anonKey.none { it.isWhitespace() } &&
            !anonKey.startsWith("sb_secret_") && !serviceRoleKey(anonKey)
    }.getOrDefault(false)
}
private fun serviceRoleKey(key: String): Boolean = runCatching {
    val payload = String(java.util.Base64.getUrlDecoder().decode(key.split('.')[1]))
    JSONObject(payload).optString("role") == "service_role"
}.getOrDefault(false)

data class Session(val accessToken: String, val refreshToken: String, val expiresAt: Long, val email: String, val displayName: String = "") {
    fun toJson() = JSONObject().put("access_token", accessToken).put("refresh_token", refreshToken)
        .put("expires_at", expiresAt).put("email", email).put("display_name", displayName)
    companion object {
        fun parse(json: JSONObject, now: Long = Instant.now().epochSecond): Session {
            val access = json.text("access_token", 8192)
            val refresh = json.text("refresh_token", 8192)
            if (access.any { it.isWhitespace() } || refresh.any { it.isWhitespace() }) invalid()
            val expiry = if (json.has("expires_at")) json.optLong("expires_at", 0)
                else now + json.optLong("expires_in", 0)
            if (expiry <= 0 || expiry > now + 7 * 86400) invalid()
            val email = json.optJSONObject("user")?.optString("email") ?: json.optString("email")
            val metadata = json.optJSONObject("user")?.optJSONObject("user_metadata")
            val name = listOf(metadata?.optString("display_name"), metadata?.optString("full_name"), metadata?.optString("name"), json.optString("display_name"))
                .filterNotNull().map(String::trim).firstOrNull { it.isNotBlank() && it.length <= 120 && it.none(Char::isISOControl) }.orEmpty()
            return Session(access, refresh, expiry, email.take(320), name)
        }
    }
}
data class Product(val id: String, val serial: String, val variant: String, val ownershipStart: Instant? = null) {
    val label get() = when(variant) { "garden" -> "Kebun"; "single_pot" -> "Pot tunggal"; else -> "Produk lainnya" }
}
data class PlantUnit(val id: String, val productId: String, val name: String, val crop: String)
enum class Sensor(val key: String, val label: String, val unit: String, val min: Double, val max: Double) {
    Moisture("moisture", "Indeks lembap", "poin", 0.0, 100.0),
    Temperature("soil_temperature", "Suhu tanah", "\u00b0C", -20.0, 60.0),
    Ph("soil_ph", "pH tanah", "pH", 0.0, 14.0);
    companion object { fun parse(key: String) = entries.find { it.key == key } ?: invalid() }
}
data class Reading(val sensor: Sensor, val quality: String, val value: Double?, val at: Instant, val synced: Boolean = true, val id: String? = null, val receivedAt: Instant? = null,
                   val error: String? = null) {
    companion object {
        fun parse(json: JSONObject): Reading {
            val sensor = Sensor.parse(json.text("sensor_id"))
            val quality = json.text("quality_status")
            // Future quality states must never look like a valid measurement.
            val value = json.nullableNumber("value_nullable")
            val clock = json.optString("clock_status", "synced")
            if (clock.length > 40) invalid()
            if (quality == "ok") { if (value == null || value !in sensor.min..sensor.max) invalid() }
            else if (quality in listOf("error", "not_measured") && value != null) invalid()
            val receivedAt = if (json.isNull("received_at")) null else json.instant("received_at")
            val error = if (quality == "error" && !json.isNull("error_message")) (json.opt("error_message") as? String)?.take(240) else null
            return Reading(sensor, quality, if (quality == "ok") value else null, json.instant("measured_at"),
                synced = clock == "synced", receivedAt = receivedAt, error = error)
        }
    }
}

/** The ESP32 firmware's probe errors (firmware/smart_agro) as steps the owner can take; other text is shown as the device sent it. */
internal fun probeErrorHint(error: String?): String? = when {
    error == null -> null
    error.startsWith("Expected one DS18B20") -> "Probe suhu tidak terdeteksi atau lebih dari satu. Periksa kabel DS18B20 dan resistor 4,7 kΩ."
    "DS18B20" in error -> "Probe suhu terputus atau di luar −20 sampai 60 °C. Periksa sambungan probe."
    error.startsWith("Moisture ADC") -> "Sinyal sensor lembap di luar rentang. Periksa kabel HW-390 dan kalibrasi kering/basah."
    error.startsWith("pH ADC") -> "Sinyal pH di luar rentang. Periksa keluaran modul DMS dan kalibrasi buffer 4,01/6,86."
    else -> "Pesan perangkat: $error"
}
// my_unit_overview allows 75 minutes for a device that reports every 30.
internal const val READING_FRESH_SECONDS = 75L * 60
// The future margin matches telemetry ingest (measured_at up to +5 minutes), so a phone clock slightly behind the server
// does not mark a packet that just arrived as old.
internal fun fresh(at: Instant, now: Instant) = !at.isBefore(now.minusSeconds(READING_FRESH_SECONDS)) && !at.isAfter(now.plusSeconds(300))
/** Cell voltage from the latest packet (firmware battery object, my_unit_overview since 20261121010000). */
data class Battery(val volts: Double, val at: Instant)
data class Overview(val id: String, val at: Instant?, val alerts: List<String>, val readings: List<Reading>, val state: String?,
    val battery: Battery? = null) {
    fun stale(now: Instant) = at == null || !fresh(at, now) || "stale" in alerts
}
val alertLabels = mapOf("no_data" to "Belum ada data", "stale" to "Data usang", "sensor_error" to "Sensor galat",
    "device_revoked" to "Perangkat dicabut", "energy_deficit" to "Beban melebihi panen energi", "battery_low" to "Baterai lemah")
val stateLabels = mapOf("bingung_menunggu" to "Menunggu data", "tenang_senang" to "Rutin",
    "sedih_perhatian" to "Perlu perhatian", "waspada_marah" to "Prioritas periksa")

fun parseProducts(json: JSONObject): List<Product> = json.array("products").objects().map {
    val variant = it.text("variant")
    // Unknown variants remain readable; server ownership and identifiers are still validated.
    val serial = it.text("serial_public", 120)
    if (!Regex("[A-Za-z0-9][A-Za-z0-9._-]{0,119}").matches(serial)) invalid()
    Product(it.id("product_id"), serial, variant, if (it.isNull("start_at")) null else it.instant("start_at"))
}
fun parseUnits(json: JSONObject): List<PlantUnit> = json.array("units").objects().filter { it.isNull("archived_at") }.map {
    PlantUnit(it.id("unit_id"), it.id("product_id"), it.text("location_label", 120), it.text("species_variety"))
}
fun parseOverviews(json: JSONObject): List<Overview> = json.array("units").objects().map {
    val alerts = it.array("alerts")
    if (alerts.length() > 32) invalid()
    val labels = (0 until alerts.length()).map { i -> (alerts.opt(i) as? String)?.takeIf { it.isNotBlank() && it.length<=80 && it.none(Char::isISOControl) } ?: invalid() }
    Overview(it.id("unit_id"), if (it.isNull("last_packet_at")) null else it.instant("last_packet_at"),
        labels, it.array("sensors").objects(32).filter { row -> Sensor.entries.any { sensor -> sensor.key==row.text("sensor_id") } }.map(Reading::parse), it.optJSONObject("assessment")?.optString("state"),
        // A malformed battery object never hides the soil readings.
        it.optJSONObject("battery")?.let { b -> runCatching { Battery(b.getDouble("voltage").takeIf { v -> v in 2.5..4.5 }!!, b.instant("measured_at")) }.getOrNull() })
}
/** Break lines at invalid readings, untrusted clocks and gaps; missing pH is never zero. */
fun chartSegments(readings: List<Reading>, sensor: Sensor): List<List<Reading>> {
    val segments = mutableListOf<MutableList<Reading>>()
    var current: MutableList<Reading>? = null
    readings.filter { it.sensor == sensor }.sortedBy { it.at }.forEach { r ->
        if (r.value == null || r.quality != "ok" || !r.synced) current = null
        else {
            val previous = current?.lastOrNull()
            if (previous == null || r.at.epochSecond - previous.at.epochSecond > 3600) {
                current = mutableListOf(); segments.add(current!!)
            }
            current!!.add(r)
        }
    }
    return segments
}

fun parseHistory(json: JSONObject): List<Reading> = json.array("readings").objects(120).mapNotNull { row ->
    row.id("id"); row.id("boot_id"); row.instant("received_at")
    // Only device readings are charted. A 'simulation' row (the server stores those too) or a clock status this version does
    // not know is left out rather than failing the page; a malformed row still fails it.
    if (row.text("source") != "device" || row.text("clock_status") !in listOf("synced", "unsynced")) return@mapNotNull null
    val sequence = row.opt("sequence") as? Number ?: invalid()
    if (sequence.toDouble() != sequence.toInt().toDouble() || sequence.toLong() < 0) invalid()
    if (row.optString("quality_status") == "error") row.text("error_message")
    if (Sensor.entries.none { it.key==row.text("sensor_id") }) null else Reading.parse(row).copy(id=row.id("id"))
}

/** A stable readable suffix; extend when another unit in the account shares it. */
fun unitCode(unit: PlantUnit, units: List<PlantUnit>): String {
    fun compact(id: String) = id.replace("-", "").uppercase(java.util.Locale.ROOT)
    val raw = compact(unit.id)
    var length = minOf(6, raw.length)
    while (length < raw.length && units.any { it.id != unit.id && compact(it.id).takeLast(length) == raw.takeLast(length) }) length++
    return "T-${raw.takeLast(length)}"
}
data class RewardBalance(val confirmed: Long, val reserved: Long, val available: Long, val active: Boolean)
fun parseRewardBalance(json: JSONObject): RewardBalance {
    if (json.opt("ok") != true) invalid()
    val balance = json.optJSONObject("balance") ?: invalid()
    fun points(key: String): Long {
        val value = (balance.opt(key) as? Number)?.toDouble() ?: invalid()
        if (!value.isFinite() || value < 0 || value > 9_007_199_254_740_991.0 || value != kotlin.math.floor(value)) invalid()
        return value.toLong()
    }
    val confirmed=points("confirmed_points"); val reserved=points("reserved_points"); val available=points("available_points")
    if (reserved > confirmed || confirmed-reserved != available) invalid()
    if (!json.has("policy") || (!json.isNull("policy") && json.optJSONObject("policy") == null)) invalid()
    return RewardBalance(confirmed,reserved,available,!json.isNull("policy"))
}
data class MoistureRise(val from: Reading, val to: Reading)
// ponytail: 5 points over continuous rising readings illustrates events; calibrate with the physical sensor before relying on it.
fun moistureRises(readings: List<Reading>): List<MoistureRise> = chartSegments(readings,Sensor.Moisture).flatMap { segment ->
    val result=mutableListOf<MoistureRise>()
    var start=0
    for (end in 1..segment.size) {
        if (end<segment.size && segment[end].value!! > segment[end-1].value!!) continue
        if (end-start>1 && segment[end-1].value!!-segment[start].value!! >= 5.0) result.add(MoistureRise(segment[start],segment[end-1]))
        start=end
    }
    result
}


internal fun JSONObject.whole(key: String, min: Long = 0, max: Long = 9_007_199_254_740_991L): Long {
    val value = nullableNumber(key) ?: invalid()
    if (value < min || value > max || value != kotlin.math.floor(value)) invalid()
    return value.toLong()
}
internal fun JSONObject.optionalText(key: String, max: Int): String? = if (has(key) && isNull(key)) null else text(key, max)
internal fun JSONObject.optionalInstant(key: String): Instant? = if (has(key) && isNull(key)) null else instant(key)
fun displayName(raw: String): String {
    require(raw.length <= 320 && raw.none { it.isISOControl() || it in '\u202a'..'\u202e' || it in '\u2066'..'\u2069' }) { "Nama harus 1-40 karakter tanpa karakter kontrol." }
    val clean = raw.trim().replace(Regex("\\s+"), " ")
    require(clean.codePointCount(0, clean.length) in 1..40) { "Nama harus 1-40 karakter." }
    return clean
}
data class RewardItem(val id: String, val title: String, val cost: Long, val stock: Long, val reserved: Long, val availability: String) {
    fun canReserve(balance: RewardBalance) = availability == "available" && stock > reserved && balance.available >= cost
}
data class Redemption(val id: String, val title: String, val points: Long, val status: String, val at: Instant, val reference: String?, val reason: String?, val catalogItemId: String = "")
data class LedgerEntry(val id: String, val points: Long, val note: String, val at: Instant)
data class RewardWorkspace(val balance: RewardBalance, val policy: String?, val catalog: List<RewardItem>, val redemptions: List<Redemption>, val ledger: List<LedgerEntry>)
fun parseRewards(json: JSONObject): RewardWorkspace {
    val balance = parseRewardBalance(json)
    val policy = json.optJSONObject("policy")?.let { p ->
        p.id("id"); p.whole("daily_point_cap", 1, 100000)
        if ((p.nullableNumber("wh_per_point") ?: invalid()) !in 0.001..1000000.0) invalid()
        p.text("version", 120)
    }
    val catalog = json.array("catalog").objects(100).map { row ->
        val stock = row.whole("stock_total", 0, 1000000)
        val availability = row.text("availability",80)
        RewardItem(row.id("id"), row.text("title", 120), row.whole("point_cost", 1, 100000), stock, row.whole("stock_reserved", 0, stock), availability)
    }
    val redemptions = json.array("redemptions").objects(100).map { row ->
        row.id("catalog_item_id")
        val status = row.text("status",80)
        Redemption(row.id("id"), row.text("title",120), row.whole("reserved_points",1,100000), status, row.instant("created_at"), row.optionalText("fulfillment_reference",240), row.optionalText("compensation_reason",1000),row.id("catalog_item_id"))
    }
    val ledger = json.array("ledger").objects(100).map { row ->
        val points = row.whole("signed_points", -100000, 100000).also { if (it == 0L) invalid() }
        LedgerEntry(row.id("id"),points,row.text("note",1000),row.instant("created_at"))
    }
    if (catalog.map { it.id }.distinct().size != catalog.size || redemptions.map { it.id }.distinct().size != redemptions.size || ledger.map { it.id }.distinct().size != ledger.size) invalid()
    return RewardWorkspace(balance,policy,catalog,redemptions,ledger)
}
val redemptionLabels = mapOf("reserved" to "Direservasi", "fulfilled" to "Realisasi dicatat operator", "cancelled" to "Dibatalkan", "compensated" to "Poin dikompensasi")
val proofLabels = mapOf("pending" to "Menunggu dikirim", "sent" to "Menunggu konfirmasi jaringan", "confirmed" to "Terkonfirmasi oleh layanan", "failed" to "Pengiriman gagal", "mismatch" to "Tidak cocok, bukan bukti sah")
data class ChainProof(val event: String, val kind: String, val serial: String, val status: String, val hash: String, val chain: String?, val transaction: String?, val block: Long?, val at: Instant, val confirmedAt: Instant?) {
    val explorer: String? get() = if (transaction == null || status !in proofLabels) null else when (chain) {
        "84532" -> "https://sepolia.basescan.org/tx/$transaction"
        "11155111" -> "https://sepolia.etherscan.io/tx/$transaction"
        else -> null
    }
}
fun parseProofs(json: JSONObject): List<ChainProof> {
    if (json.opt("ok") != true) invalid()
    return json.array("proofs").objects(1000).mapNotNull { row ->
        val event = row.text("event_key",80).also { if (!Regex("(claim|transfer|recovery):[0-9a-fA-F-]{36}").matches(it) || !uuid.matches(it.substringAfter(':'))) invalid() }
        // A kind this version does not know is left out; the rest of the list still shows.
        val kind = row.text("kind").takeIf { it in listOf("ownership_claim", "ownership_transfer") } ?: return@mapNotNull null
        val status = row.text("status",80)
        val hash = row.text("artifact_sha256",64).also { if (!Regex("[a-fA-F0-9]{64}").matches(it)) invalid() }
        val chain = row.optionalText("chain_id",20)?.also { if (!Regex("[0-9]{1,20}").matches(it)) invalid() }
        val tx = row.optionalText("tx_hash",66)?.also { if (!Regex("0x[a-fA-F0-9]{64}").matches(it)) invalid() }
        val block = if (row.has("block_number") && row.isNull("block_number")) null else row.whole("block_number")
        val confirmed = row.optionalInstant("confirmed_at")
        if (status == "confirmed" && (tx == null || chain == null || block == null || confirmed == null)) invalid()
        ChainProof(event,kind,row.text("serial_public",120),status,hash,chain,tx,block,row.instant("created_at"),confirmed)
    }.also { if (it.map(ChainProof::event).distinct().size != it.size) invalid() }
}

/** Zoom to observed values while keeping room for a flat series and staying inside physical sensor bounds. */
internal fun chartRange(readings: List<Reading>, sensor: Sensor): ClosedFloatingPointRange<Double> {
    val values=chartSegments(readings,sensor).flatten().mapNotNull { it.value }
    if(values.isEmpty()) return sensor.min..sensor.max
    val low=values.min(); val high=values.max()
    val padding=maxOf((high-low)*.15,(sensor.max-sensor.min)*.025)
    return maxOf(sensor.min,low-padding)..minOf(sensor.max,high+padding)
}
