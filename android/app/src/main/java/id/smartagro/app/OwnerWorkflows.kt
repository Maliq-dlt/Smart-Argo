package id.smartagro.app

import org.json.JSONArray
import org.json.JSONObject
import java.net.URI
import java.net.URLDecoder
import java.time.Instant
import java.util.Locale

private fun ownerId(value: String) = JSONObject().put("id", value).id("id")
private fun ownerBoolean(json: JSONObject, key: String): Boolean = json.opt(key) as? Boolean ?: throw IllegalArgumentException("Respons tidak valid.")
private fun ownerStatus(json: JSONObject, key: String, values: Set<String>) = json.text(key).also { require(it in values) { "Status tidak dikenal." } }
private fun ownerNumber(json: JSONObject, key: String, min: Double, max: Double) =
    (json.nullableNumber(key) ?: throw IllegalArgumentException("Angka tidak tersedia.")).also { require(it in min..max) }
private fun ownerOk(json: JSONObject): JSONObject = json.also { require(it.opt("ok") == true) { "Respons server gagal." } }
private fun ownerSerial(raw: String): String = raw.trim().also { require(Regex("[A-Za-z0-9][A-Za-z0-9._-]{0,119}").matches(it)) { "Nomor seri tidak valid." } }.uppercase(Locale.ROOT)
private fun ownerText(raw: String, min: Int, max: Int) = raw.trim().also {
    require(it.codePointCount(0, it.length) in min..max && it.none { c -> c.isISOControl() && c != '\n' && c != '\t' }) { "Panjang atau isi teks tidak valid." }
}

data class ProductScan(val serial: String, val hasExtraParameters: Boolean)
/** Extracts only the public serial; sealed codes and device signatures are never imported from QR links. */
fun parseProductScan(raw: String): ProductScan {
    val text = raw.trim()
    require(text.length in 1..2048) { "QR kosong atau terlalu panjang." }
    if (Regex("[A-Za-z0-9][A-Za-z0-9._-]{0,119}").matches(text)) return ProductScan(ownerSerial(text), false)
    val uri = runCatching { URI(text) }.getOrElse { throw IllegalArgumentException("Tautan QR tidak valid.") }
    require(uri.scheme?.lowercase(Locale.ROOT) in setOf("https", "http") && !uri.host.isNullOrBlank() && uri.userInfo == null) { "Tautan QR tidak valid." }
    val params = uri.rawQuery.orEmpty().split('&').filter(String::isNotEmpty).map {
        val pair = it.split('=', limit = 2)
        URLDecoder.decode(pair[0], "UTF-8") to URLDecoder.decode(pair.getOrElse(1) { "" }, "UTF-8")
    }
    require(params.count { it.first == "serial" } == 1) { "QR harus memuat satu nomor seri." }
    return ProductScan(ownerSerial(params.first { it.first == "serial" }.second), params.any { it.first != "serial" })
}

/** Challenge and one-time transfer codes deliberately omit their secret values from toString. */
class ActivationChallenge(val nonceId: String, val challenge: String, val expiresAt: Instant) {
    override fun toString() = "ActivationChallenge(expiresAt=$expiresAt)"
}
fun parseActivationChallenge(json: JSONObject, now: Instant = Instant.now()): ActivationChallenge {
    val expires = json.instant("expires_at")
    require(expires.isAfter(now) && !expires.isAfter(now.plusSeconds(600))) { "Challenge kedaluwarsa atau tidak valid." }
    return ActivationChallenge(json.id("nonce_id"), json.text("challenge", 2048), expires)
}
class TransferOffer(val transferId: String, val code: String, val expiresAt: Instant) {
    override fun toString() = "TransferOffer(expiresAt=$expiresAt)"
}
fun parseTransferOffer(json: JSONObject): TransferOffer {
    ownerOk(json)
    val code = json.text("code", 32)
    require(Regex("[0-9A-F]{32}").matches(code))
    return TransferOffer(json.id("transfer_id"), code, json.instant("expires_at"))
}
data class OwnershipReceipt(val productId: String, val ownershipId: String?, val idempotent: Boolean)
private fun parseOwnershipReceipt(json: JSONObject): OwnershipReceipt {
    ownerOk(json)
    val retry = ownerBoolean(json, "idempotent")
    val ownership = if (retry && !json.has("ownership_id")) null else json.id("ownership_id")
    return OwnershipReceipt(json.id("product_id"), ownership, retry)
}
suspend fun AgroApi.activationChallenge(serial: String) =
    parseActivationChallenge(rpc("issue_activation_nonce", JSONObject().put("p_serial", ownerSerial(serial))))
suspend fun AgroApi.claimProduct(nonceId: String, sealedCode: String, signature: String): OwnershipReceipt {
    ownerId(nonceId)
    require(sealedCode.isNotBlank() && sealedCode.length <= 256) { "Kode tersegel tidak valid." }
    require(Regex("[A-Za-z0-9+/]{86}==").matches(signature) &&
        runCatching { java.util.Base64.getDecoder().decode(signature).size == 64 }.getOrDefault(false)) { "Tanda tangan Ed25519 tidak valid." }
    return parseOwnershipReceipt(authenticatedRequest("/functions/v1/product-claim",
        JSONObject().put("nonce_id", nonceId).put("sealed_code", sealedCode).put("signature", signature)))
}
suspend fun AgroApi.createTransferOffer(productId: String) =
    parseTransferOffer(rpc("create_transfer_offer", JSONObject().put("p_product_id", ownerId(productId))))
suspend fun AgroApi.cancelTransferOffer(productId: String): Boolean =
    ownerBoolean(ownerOk(rpc("cancel_transfer_offer", JSONObject().put("p_product_id", ownerId(productId)))), "cancelled")
suspend fun AgroApi.acceptTransfer(serial: String, code: String): OwnershipReceipt {
    val clean = code.trim().uppercase(Locale.ROOT)
    require(clean.length <= 64 && Regex("[0-9A-F -]+").matches(clean)) { "Kode transfer tidak valid." }
    val normalized = clean.replace(Regex("[ -]"), "")
    require(normalized.length == 32)
    return parseOwnershipReceipt(rpc("accept_transfer", JSONObject().put("p_serial", ownerSerial(serial)).put("p_code", normalized)))
}

class RecoveryEvidence(val kind: String, val reference: String, val sha256: String? = null) {
    fun toJson(): JSONObject {
        require(kind in setOf("receipt", "photo", "serial_label", "activation_card", "other"))
        val json = JSONObject().put("kind", kind).put("reference", ownerText(reference, 1, 240))
        sha256?.let { require(Regex("[0-9a-f]{64}").matches(it)); json.put("sha256", it) }
        return json
    }
    override fun toString() = "RecoveryEvidence(kind=$kind)"
}
data class CaseReceipt(val id: String, val status: String, val idempotent: Boolean)
private val recoveryStates = setOf("open", "in_review", "approved", "rejected", "withdrawn")
private val rewardStates = setOf("open", "in_review", "upheld", "rejected")
private fun parseCaseReceipt(json: JSONObject, states: Set<String>) = ownerOk(json).let {
    CaseReceipt(it.id("case_id"), ownerStatus(it, "status", states), ownerBoolean(it, "idempotent"))
}
class OwnershipRecovery(val id: String, val serial: String, val statement: String, val evidence: List<RecoveryEvidence>,
    val status: String, val decisionReason: String?, val createdAt: Instant, val closedAt: Instant?) {
    override fun toString() = "OwnershipRecovery(status=$status)"
}
fun parseOwnershipRecoveries(json: JSONObject): List<OwnershipRecovery> = ownerOk(json).array("cases").objects(20).map { row ->
    val status = ownerStatus(row, "status", recoveryStates)
    val reason = row.optionalText("decision_reason", 1000)
    val closed = row.optionalInstant("closed_at")
    require((status in setOf("approved", "rejected")) == (reason != null) &&
        (status in setOf("approved", "rejected", "withdrawn")) == (closed != null))
    val evidence = row.array("evidence").objects(10).map {
        require(it.keys().asSequence().all { key -> key in setOf("kind", "reference", "sha256") })
        RecoveryEvidence(it.text("kind"), ownerText(it.text("reference", 480), 1, 240), if (it.has("sha256")) it.text("sha256", 64) else null).also { e -> e.toJson() }
    }
    OwnershipRecovery(row.id("id"), ownerSerial(row.text("serial_public", 120)), ownerText(row.text("statement", 4000), 20, 2000),
        evidence, status, reason, row.instant("created_at"), closed)
}
/** Persist requestId with the payload before submitting; reuse it after an uncertain network result. */
suspend fun AgroApi.openOwnershipRecovery(requestId: String, serial: String, statement: String, evidence: List<RecoveryEvidence>): CaseReceipt {
    require(evidence.size <= 10)
    val body = JSONObject().put("p_request_id", ownerId(requestId)).put("p_serial", ownerSerial(serial))
        .put("p_statement", ownerText(statement, 20, 2000)).put("p_evidence", JSONArray(evidence.map { it.toJson() }))
    return parseCaseReceipt(rpc("open_ownership_recovery", body), recoveryStates)
}
suspend fun AgroApi.ownershipRecoveries() = parseOwnershipRecoveries(rpc("my_ownership_recoveries"))
suspend fun AgroApi.withdrawOwnershipRecovery(caseId: String) =
    parseCaseReceipt(rpc("withdraw_ownership_recovery", JSONObject().put("p_case_id", ownerId(caseId))), recoveryStates)

class RewardCase(val id: String, val kind: String, val energyWindowId: String?, val redemptionId: String?,
    val statement: String?, val status: String, val decisionReason: String?, val creditedPoints: Long?, val createdAt: Instant, val decidedAt: Instant?) {
    override fun toString() = "RewardCase(kind=$kind,status=$status)"
}
private fun ownerNullableId(json: JSONObject, key: String) = if (json.has(key) && json.isNull(key)) null else json.id(key)
fun parseRewardCases(json: JSONObject): List<RewardCase> = ownerOk(json).array("cases").objects(50).map { row ->
    val energy = ownerNullableId(row, "energy_window_id")
    val redemption = ownerNullableId(row, "redemption_id")
    require((energy == null) != (redemption == null))
    val kind = ownerStatus(row, "kind", setOf("appeal", "anomaly"))
    val status = ownerStatus(row, "status", rewardStates)
    val reason = row.optionalText("decision_reason", 1000)
    val decided = row.optionalInstant("decided_at")
    require((status in setOf("upheld", "rejected")) == (reason != null) &&
        (status in setOf("upheld", "rejected")) == (decided != null))
    val statement = row.optionalText("statement", 4000)?.let { ownerText(it, 1, 2000) }
    require((kind == "appeal") == (statement != null))
    RewardCase(row.id("id"), kind, energy, redemption, statement, status, reason,
        if (row.has("credited_points") && row.isNull("credited_points")) null else row.whole("credited_points"),
        row.instant("created_at"), decided)
}
/** Exactly one subject; requestId is caller-owned and must survive retries. */
suspend fun AgroApi.openRewardAppeal(requestId: String, statement: String, energyWindowId: String? = null, redemptionId: String? = null): CaseReceipt {
    require((energyWindowId == null) != (redemptionId == null)) { "Pilih tepat satu bukti energi atau penukaran." }
    val body = JSONObject().put("p_request_id", ownerId(requestId)).put("p_statement", ownerText(statement, 1, 2000))
        .put("p_energy_window_id", energyWindowId?.let(::ownerId) ?: JSONObject.NULL)
        .put("p_redemption_id", redemptionId?.let(::ownerId) ?: JSONObject.NULL)
    return parseCaseReceipt(rpc("open_reward_appeal", body), rewardStates)
}
suspend fun AgroApi.rewardCases() = parseRewardCases(rpc("my_reward_cases"))

data class EnergyMeterEvidence(val id: String, val deviceId: String, val status: String, val calibrationReference: String,
    val eligibleLoadReference: String, val validFrom: Instant, val validUntil: Instant, val maxPowerW: Double, val createdAt: Instant, val revokedReason: String?)
data class EnergyWindowEvidence(val id: String, val deviceId: String, val meterId: String, val startAt: Instant, val endAt: Instant,
    val receivedAt: Instant, val solarHarvestWh: Double, val loadWh: Double, val batterySocPct: Double?, val creditedPoints: Long, val rewardReason: String?)
data class EnergyEvidence(val roles: List<String>, val meters: List<EnergyMeterEvidence>, val windows: List<EnergyWindowEvidence>)
fun parseEnergyEvidence(json: JSONObject): EnergyEvidence {
    ownerOk(json)
    val roles = json.array("roles")
    require(roles.length() <= 4)
    val parsedRoles = (0 until roles.length()).map { roles.opt(it) as? String ?: throw IllegalArgumentException("Peran tidak valid.") }
    require(parsedRoles.all { it in setOf("owner", "contributor", "curator", "operator") })
    val meters = json.array("meters").objects(100).map {
        val from = it.instant("valid_from"); val until = it.instant("valid_until")
        require(until.isAfter(from))
        EnergyMeterEvidence(it.id("id"), it.id("device_id"), ownerStatus(it, "status", setOf("active", "revoked")),
            it.text("calibration_ref", 1000), it.text("eligible_load_ref", 1000), from, until,
            ownerNumber(it, "max_power_w", 0.001, 100000.0), it.instant("created_at"), it.optionalText("revoked_reason", 1000))
    }
    val windows = json.array("windows").objects(100).map {
        val from = it.instant("start_at"); val until = it.instant("end_at")
        require(from.epochSecond % 900 == 0L && from.nano == 0 && until == from.plusSeconds(900) && it.text("evidence_quality") == "verified_meter")
        val battery = it.nullableNumber("battery_soc_pct")?.also { n -> require(n in 0.0..100.0) }
        val reason = it.optionalText("reward_reason", 80)?.also { r -> require(r in setOf("held_for_review", "credited", "policy_disabled", "below_threshold", "daily_cap")) }
        EnergyWindowEvidence(it.id("id"), it.id("device_id"), it.id("meter_id"), from, until, it.instant("received_at"),
            ownerNumber(it, "solar_harvest_wh", 0.0, 25000.0), ownerNumber(it, "load_wh", 0.0, 25000.0), battery, it.whole("credited_points"), reason)
    }
    return EnergyEvidence(parsedRoles, meters, windows)
}
suspend fun AgroApi.energyEvidence() = parseEnergyEvidence(rpc("energy_workspace"))

data class CommunityZone(val zone: String, val cycles: Long, val owners: Long, val wateringLowDays: Double,
    val wateringMedianDays: Double, val wateringHighDays: Double, val moistureLow: Long, val moistureHigh: Long)
data class CommunityKnowledge(val speciesId: Int, val zones: List<CommunityZone>, val label: String = "belum dikurasi", val source: String = "komunitas")
fun parseCommunityKnowledge(json: JSONObject): CommunityKnowledge {
    ownerOk(json)
    require(json.text("label") == "belum dikurasi" && json.text("source") == "komunitas")
    val zones = json.array("zones").objects(6).map {
        val zone = ownerStatus(it, "zone", setOf("dalam_ruangan", "tanpa_lokasi", "tropis", "subtropis", "sedang", "dingin"))
        val owners = it.whole("owners", 3); val cycles = it.whole("cycles", 5)
        require(owners <= cycles && cycles <= owners * 2)
        val watering = it.getJSONObject("watering_interval_days")
        val low = ownerNumber(watering, "low", 0.5, 60.0); val median = ownerNumber(watering, "median", 0.5, 60.0); val high = ownerNumber(watering, "high", 0.5, 60.0)
        require(low <= median && median <= high && listOf(low, median, high).all { n -> n * 2 == kotlin.math.floor(n * 2) })
        val moisture = it.getJSONObject("moisture")
        val lo = moisture.whole("low", 0, 100); val hi = moisture.whole("high", 0, 100)
        require(lo <= hi && lo % 5 == 0L && hi % 5 == 0L)
        CommunityZone(zone, cycles, owners, low, median, high, lo, hi)
    }
    require(zones.map { it.zone }.distinct().size == zones.size)
    return CommunityKnowledge(json.whole("species_id", 1, Int.MAX_VALUE.toLong()).toInt(), zones)
}
suspend fun AgroApi.communityKnowledge(speciesId: Int): CommunityKnowledge {
    require(speciesId > 0)
    return parseCommunityKnowledge(rpc("community_knowledge", JSONObject().put("p_species_id", speciesId))).also { require(it.speciesId == speciesId) }
}
suspend fun AgroApi.setSlotSharing(slotId: String, share: Boolean): Long {
    val response = ownerOk(rpc("set_slot_sharing", JSONObject().put("p_slot_id", ownerId(slotId)).put("p_share", share)))
    require(response.id("slot_id").equals(slotId, ignoreCase = true) && ownerBoolean(response, "share") == share)
    return response.whole("withdrawn")
}
/** Share only after explicit opt-in; server independently checks age, ownership and successful outcome. */
suspend fun AgroApi.shareCycle(requestId: String, cycleId: String, wateringIntervalDays: Double, moistureLow: Double, moistureHigh: Double): String {
    require(wateringIntervalDays.isFinite() && wateringIntervalDays in 0.5..60.0 &&
        moistureLow.isFinite() && moistureHigh.isFinite() && moistureLow in 0.0..100.0 && moistureHigh in 0.0..100.0 && moistureLow < moistureHigh)
    val result = ownerOk(rpc("share_my_cycle", JSONObject().put("p_request_id", ownerId(requestId)).put("p_cycle_id", ownerId(cycleId))
        .put("p_watering_interval_days", wateringIntervalDays).put("p_moisture_low", moistureLow).put("p_moisture_high", moistureHigh)))
    ownerBoolean(result, "idempotent")
    ownerStatus(result, "zone", setOf("dalam_ruangan", "tanpa_lokasi", "tropis", "subtropis", "sedang", "dingin"))
    return result.id("contribution_id")
}
suspend fun AgroApi.unshareCycle(cycleId: String): Long =
    ownerOk(rpc("unshare_my_cycle", JSONObject().put("p_cycle_id", ownerId(cycleId)))).whole("withdrawn", 0, 1)
