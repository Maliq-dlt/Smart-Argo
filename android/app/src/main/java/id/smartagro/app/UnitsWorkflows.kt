package id.smartagro.app

import org.json.JSONObject
import java.time.Instant

data class OwnedDevice(val id: String, val productId: String, val unitId: String?, val status: String, val placedAt: Instant?)

data class OwnedUnitsWorkspace(val active: List<PlantUnit>, val archived: List<PlantUnit>, val devices: List<OwnedDevice>)

data class UnitLifecycleEvent(val action: String, val createdAt: Instant)

data class ProductPublicStatus(
    val serial: String,
    val variant: String,
    val registryStatus: String,
    val claimed: Boolean,
    val issuerVerified: Boolean,
)

internal fun parseOwnedUnitsWorkspace(json: JSONObject): OwnedUnitsWorkspace {
    require(json.opt("ok") == true) { "Daftar unit belum dapat dimuat." }
    val allUnits = json.array("units").objects(200).map { row ->
        val archived = !row.isNull("archived_at")
        val unit = PlantUnit(row.id("unit_id"), row.id("product_id"), row.text("location_label", 120), row.text("species_variety"))
        unit to archived
    }
    val devices = if (json.has("devices")) json.array("devices").objects(200).map { row ->
        OwnedDevice(
            id = row.id("device_id"),
            productId = row.id("product_id"),
            unitId = if (row.isNull("unit_id")) null else row.id("unit_id"),
            status = row.text("status", 40),
            placedAt = if (row.has("placed_at") && !row.isNull("placed_at")) row.instant("placed_at") else null,
        )
    } else emptyList()
    return OwnedUnitsWorkspace(
        active = allUnits.filter { !it.second }.map { it.first },
        archived = allUnits.filter { it.second }.map { it.first },
        devices = devices,
    )
}

internal fun parseUnitHistory(json: JSONObject): List<UnitLifecycleEvent> {
    require(json.opt("ok") == true) { "Riwayat unit tidak dapat dimuat." }
    return json.array("events").objects(100).map { row ->
        UnitLifecycleEvent(row.text("action", 60), row.instant("created_at"))
    }
}

internal fun parseProductPublicStatus(json: JSONObject): ProductPublicStatus {
    require(json.opt("ok") == true) {
        if (json.optString("code") == "not_registered") "Nomor seri tidak terdaftar di registri Smart Agro."
        else "Status produk tidak dapat dibaca."
    }
    val variant = json.text("variant", 40)
    val registryStatus = json.text("registry_status", 40)
    val claimed = json.opt("claimed") as? Boolean ?: throw IllegalArgumentException("Status klaim tidak valid.")
    return ProductPublicStatus(
        serial = json.text("serial_public", 120),
        variant = variant,
        registryStatus = registryStatus,
        claimed = claimed,
        issuerVerified = json.opt("issuer_verified") == true,
    )
}

suspend fun AgroApi.ownedUnitsWorkspace(): OwnedUnitsWorkspace = parseOwnedUnitsWorkspace(rpc("my_units"))

// archive_my_unit ends the unit's placements itself (unit_event 'archived' records devices_removed).
suspend fun AgroApi.archiveUnit(unitId: String) {
    val cleanId = JSONObject().put("id", unitId).id("id")
    require(rpc("archive_my_unit", JSONObject().put("p_unit_id", cleanId)).opt("ok") == true) { "Unit tidak dapat diarsipkan." }
}

suspend fun AgroApi.restoreUnit(unitId: String) {
    val cleanId = JSONObject().put("id", unitId).id("id")
    require(rpc("restore_my_unit", JSONObject().put("p_unit_id", cleanId)).opt("ok") == true) { "Unit tidak dapat dipulihkan." }
}

/**
 * Places the device in [unitId]. Returns false when no fresh synced reading shows the device reporting yet: a warning
 * for the owner, not a refusal, because a device is often switched off while it is being moved.
 */
suspend fun AgroApi.placeDevice(deviceId: String, unitId: String): Boolean {
    val dId = JSONObject().put("id", deviceId).id("id")
    val uId = JSONObject().put("id", unitId).id("id")
    val owned = ownedUnitsWorkspace()
    val device = owned.devices.find { it.id == dId }
    require(device != null && device.status == "active" && owned.active.any { it.id == uId && it.productId == device.productId }) {
        "Perangkat atau unit tujuan sudah tidak tersedia."
    }
    if (device.unitId == uId) return true

    // Since 20261121000000 the server files packets under the current placement, or under the unit the device was
    // flashed with while unplaced, so moving needs no reflash. Look for a fresh synced reading in every active unit of
    // the product, the current placement first.
    val now = Instant.now()
    val window = HistoryWindow(now.minusSeconds(READING_FRESH_SECONDS), now.plusSeconds(300))
    var evidenceAt: Instant? = null
    for (unit in owned.active.filter { it.productId == device.productId }.sortedByDescending { it.id == device.unitId }) {
        var snapshot: Instant? = null
        var cursor: HistoryCursor? = null
        do {
            val page = readMeasurementHistory(unit.id, window, snapshot, cursor, limit = 500)
            evidenceAt = page.readings.firstOrNull { it.deviceId == dId && it.reading.synced }?.reading?.at
            snapshot = page.snapshot
            cursor = page.next
        } while (evidenceAt == null && cursor != null)
        if (evidenceAt != null) break
    }
    val reporting = evidenceAt?.let { fresh(it, Instant.now()) } == true
    require(rpc("place_my_device", JSONObject().put("p_device_id", dId).put("p_unit_id", uId)).opt("ok") == true) {
        "Penempatan perangkat tidak dapat disimpan."
    }
    return reporting
}

suspend fun AgroApi.unitHistory(unitId: String): List<UnitLifecycleEvent> {
    val cleanId = JSONObject().put("id", unitId).id("id")
    return parseUnitHistory(rpc("my_unit_history", JSONObject().put("p_unit_id", cleanId)))
}

suspend fun AgroApi.productPublicStatus(serial: String): ProductPublicStatus {
    val clean = serial.trim().uppercase()
    require(Regex("[A-Za-z0-9][A-Za-z0-9._-]{0,119}").matches(clean)) { "Nomor seri tidak valid." }
    return parseProductPublicStatus(rpc("product_public_status", JSONObject().put("p_serial", clean)))
}
