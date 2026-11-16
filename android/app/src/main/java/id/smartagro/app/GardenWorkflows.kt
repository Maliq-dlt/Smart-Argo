package id.smartagro.app

import org.json.JSONArray
import org.json.JSONObject
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.temporal.ChronoUnit
import kotlinx.coroutines.withTimeout
import java.util.Locale

private fun checkedId(value: String) = JSONObject().put("id",value).id("id")
private fun cleanName(raw: String): String = raw.trim().replace(Regex("\\s+")," ").also {
    require(it.codePointCount(0,it.length) in 1..60 && it.none(Char::isISOControl)) { "Nama harus 1–60 karakter." }
}
private fun JSONObject.success(): JSONObject = also { require(opt("ok")==true) { "Respons layanan tidak berhasil." } }
private fun JSONObject.flag(key: String): Boolean = (opt(key) as? Boolean) ?: throw IllegalArgumentException("Status layanan tidak valid.")
private fun nullableText(row: JSONObject,key: String,max: Int): String? {
    require(row.has(key))
    if(row.isNull(key)) return null
    return (row.opt(key) as? String)?.also { require(it.codePointCount(0,it.length)<=max) }
        ?: throw IllegalArgumentException("Teks layanan tidak valid.")
}

data class NewGardenSite(val name: String,val kind: String,val placement: String,val zones: List<String> = emptyList(),
    val latitude: Double? = null,val longitude: Double? = null)
data class CreatedGardenSite(val id: String,val slotIds: List<String>,val idempotent: Boolean)
data class GardenCycle(val id: String,val slotId: String,val speciesId: Int,val plantNo: Int,val code: Long,val nickname: String,
    val plantedOn: LocalDate,val endedOn: LocalDate?,val outcome: String?)
data class CycleChange(val cycle: GardenCycle,val closed: GardenCycle?,val unchanged: Boolean,val idempotent: Boolean)

internal fun gardenSiteBody(requestId: String,site: NewGardenSite): JSONObject {
    checkedId(requestId)
    val name=cleanName(site.name)
    require(site.kind in listOf("pot","garden") && site.placement in listOf("indoor","outdoor","rooftop"))
    require((site.latitude==null)==(site.longitude==null))
    site.latitude?.let { require(it.isFinite() && it in -90.0..90.0) }
    site.longitude?.let { require(it.isFinite() && it in -180.0..180.0) }
    val zones=site.zones.map(::cleanName)
    require(if(site.kind=="pot") zones.isEmpty() else zones.size in 1..12 && zones.map { it.lowercase(Locale.ROOT) }.distinct().size==zones.size)
    return JSONObject().put("p_request_id",requestId).put("p_name",name).put("p_kind",site.kind).put("p_placement",site.placement)
        .put("p_latitude",if(site.placement=="indoor") JSONObject.NULL else site.latitude ?: JSONObject.NULL)
        .put("p_longitude",if(site.placement=="indoor") JSONObject.NULL else site.longitude ?: JSONObject.NULL)
        .put("p_zones",if(site.kind=="pot") JSONObject.NULL else JSONArray(zones))
}
suspend fun AgroApi.createGardenSite(requestId: String,site: NewGardenSite): CreatedGardenSite {
    val json=rpc("add_my_site",gardenSiteBody(requestId,site)).success()
    val ids=json.array("slot_ids")
    require(ids.length()==if(site.kind=="pot") 1 else site.zones.size)
    val slots=(0 until ids.length()).map { checkedId(ids.getString(it)) }
    require(slots.distinct().size==slots.size)
    return CreatedGardenSite(json.id("site_id"),slots,json.flag("idempotent"))
}
internal fun parseGardenCycle(row: JSONObject): GardenCycle {
    val species=row.whole("species_id",1,2146).toInt()
    val no=row.whole("plant_no",1,999999).toInt()
    val code=row.whole("code",1,Int.MAX_VALUE.toLong())
    require(code==species*1000000L+no)
    val planted=LocalDate.parse(row.text("planted_on",10))
    require(row.has("ended_on") && row.has("outcome"))
    val ended=if(row.isNull("ended_on")) null else LocalDate.parse(row.text("ended_on",10))
    val outcome=nullableText(row,"outcome",20)
    require((ended==null)==(outcome==null) && (ended==null || !ended.isBefore(planted)))
    require(outcome==null || outcome in listOf("berhasil","gagal","dihentikan"))
    return GardenCycle(row.id("id"),row.id("slot_id"),species,no,code,cleanName(nullableText(row,"nickname",60) ?: throw IllegalArgumentException("Nama tanaman tidak valid.")),planted,ended,outcome)
}
/** my_garden is the history endpoint too; preserve closed cycles and their outcomes. */
internal fun parseGardenCycleHistory(json: JSONObject,slotId: String? = null): List<GardenCycle> {
    slotId?.let(::checkedId)
    json.success()
    val slots=json.array("slots").objects(60).map { it.id("id") }
    require(slots.distinct().size==slots.size && (slotId==null || slotId in slots))
    val cycles=json.array("cycles").objects(300).map(::parseGardenCycle)
    require(cycles.map { it.id }.distinct().size==cycles.size && cycles.map { it.code }.distinct().size==cycles.size)
    require(cycles.all { it.slotId in slots } && cycles.groupBy { it.slotId }.all { (_,v) -> v.size<=100 && v.count { it.endedOn==null }<=1 })
    return cycles.filter { slotId==null || it.slotId==slotId }.sortedWith(compareByDescending<GardenCycle> { it.plantedOn }.thenByDescending { it.id })
}
suspend fun AgroApi.gardenCycleHistory(slotId: String? = null) = parseGardenCycleHistory(rpc("my_garden"),slotId)
internal fun gardenPlantBody(requestId: String,slotId: String,speciesId: Int,on: LocalDate,nickname: String?,outcome: String? = null): JSONObject {
    checkedId(requestId);checkedId(slotId)
    require(speciesId in 1..2146)
    val nick=nickname?.trim()?.takeIf { it.isNotEmpty() }?.let(::cleanName)
    outcome?.let { require(it in listOf("berhasil","gagal","dihentikan")) }
    // Server owns its current-date window, known-species catalog, ownership and quota decisions.
    return JSONObject().put("p_request_id",requestId).put("p_slot_id",slotId).put("p_species_id",speciesId)
        .put(if(outcome==null) "p_planted_on" else "p_on",on.toString()).put("p_nickname",nick ?: JSONObject.NULL)
        .also { if(outcome!=null) it.put("p_outcome",outcome) }
}
private fun parseCycleChange(json: JSONObject,slotId: String,speciesId: Int,on: LocalDate): CycleChange {
    json.success()
    val cycle=parseGardenCycle(json.getJSONObject("cycle"))
    val closed=if(!json.has("closed") || json.isNull("closed")) null else parseGardenCycle(json.getJSONObject("closed"))
    require(cycle.slotId==slotId && cycle.speciesId==speciesId && cycle.plantedOn==on && (closed==null || closed.slotId==slotId && closed.endedOn==on && closed.id!=cycle.id))
    return CycleChange(cycle,closed,if(json.has("unchanged")) json.flag("unchanged") else false,json.flag("idempotent"))
}
suspend fun AgroApi.plantGardenSlot(requestId: String,slotId: String,speciesId: Int,on: LocalDate,nickname: String? = null): CycleChange =
    parseCycleChange(rpc("plant_in_my_slot",gardenPlantBody(requestId,slotId,speciesId,on,nickname)),slotId,speciesId,on)
suspend fun AgroApi.switchGardenPlant(requestId: String,slotId: String,speciesId: Int,on: LocalDate,outcome: String,nickname: String? = null): CycleChange =
    parseCycleChange(rpc("switch_my_plant",gardenPlantBody(requestId,slotId,speciesId,on,nickname,outcome)),slotId,speciesId,on)

class HistoryWindow(from: Instant,to: Instant) {
    val from: Instant=from.truncatedTo(ChronoUnit.MICROS)
    val to: Instant=to.truncatedTo(ChronoUnit.MICROS)
    init { require(this.from<this.to && Duration.between(this.from,this.to)<=Duration.ofDays(31)) { "Rentang harus berurutan, maksimal 31 hari." } }
}
data class HistoryCursor(val at: Instant,val id: String) { init { checkedId(id) } }
data class CareEntry(val id: String,val unitId: String,val kind: String,val observedAt: Instant,val createdAt: Instant,val amountMl: Double?,val notes: String)
data class CareJournalPage(val entries: List<CareEntry>,val snapshot: Instant,val next: HistoryCursor?)
internal fun careJournalBody(unitId: String,requestId: String,kind: String,observedAt: Instant,amountMl: Double?,notes: String): JSONObject {
    checkedId(unitId);checkedId(requestId)
    val clean=notes.trim()
    require(kind in listOf("watering","fertilizing","inspection","note"))
    require(clean.codePointCount(0,clean.length)<=2000 && clean.toByteArray(Charsets.UTF_8).size<=8000 && (kind!="note" || clean.isNotEmpty()))
    require(if(kind=="watering") amountMl!=null && amountMl.isFinite() && amountMl>0 && amountMl<=100000 else amountMl==null)
    return JSONObject().put("p_unit_id",unitId).put("p_request_id",requestId).put("p_kind",kind).put("p_observed_at",observedAt.truncatedTo(ChronoUnit.MICROS).toString())
        .put("p_amount_ml",amountMl ?: JSONObject.NULL).put("p_notes",clean)
}
internal fun parseCareEntry(row: JSONObject,unitId: String): CareEntry {
    require(row.id("unit_id")==unitId)
    val kind=row.text("kind",20)
    val amount=row.nullableNumber("amount_ml")
    val notes=nullableText(row,"notes",2000) ?: throw IllegalArgumentException("Catatan tidak valid.")
    careJournalBody(unitId,row.id("id"),kind,row.instant("observed_at"),amount,notes)
    require(notes==notes.trim())
    return CareEntry(row.id("id"),unitId,kind,row.instant("observed_at"),row.instant("created_at"),amount,notes)
}
suspend fun AgroApi.appendCareJournal(unitId: String,requestId: String,kind: String,observedAt: Instant,amountMl: Double? = null,notes: String = ""): CareEntry {
    val body=careJournalBody(unitId,requestId,kind,observedAt,amountMl,notes)
    val entry=parseCareEntry(rpc("append_my_care_journal",body).success().getJSONObject("entry"),unitId)
    require(entry.kind==kind && entry.observedAt==observedAt.truncatedTo(ChronoUnit.MICROS) && entry.amountMl==amountMl && entry.notes==body.getString("p_notes"))
    return entry
}
private fun older(a: HistoryCursor,b: HistoryCursor) = a.at<b.at || a.at==b.at && a.id<b.id
private fun parseCursor(json: JSONObject,key: String): HistoryCursor? {
    require(json.has("next_cursor"))
    return if(json.isNull("next_cursor")) null else json.getJSONObject("next_cursor").let { HistoryCursor(it.instant(key),it.id("id")) }
}
private fun pageBody(unitId: String,window: HistoryWindow?,snapshot: Instant?,cursor: HistoryCursor?,limit: Int,journal: Boolean): JSONObject {
    checkedId(unitId);require(limit in 1..(if(journal) 100 else 500));require(cursor==null || snapshot!=null)
    return JSONObject().put("p_unit_id",unitId).put("p_limit",limit).also { body ->
        window?.let { body.put("p_from",it.from.toString()).put("p_to",it.to.toString()) }
        snapshot?.let { body.put("p_snapshot_as_of",it.truncatedTo(ChronoUnit.MICROS).toString()) }
        cursor?.let { body.put(if(journal) "p_before_observed_at" else "p_cursor_at",it.at.toString()).put(if(journal) "p_before_id" else "p_cursor_id",it.id) }
    }
}
internal fun parseCareJournalPage(json: JSONObject,unitId: String): CareJournalPage {
    json.success();val snapshot=json.instant("snapshot_as_of")
    val entries=json.array("entries").objects(100).map { parseCareEntry(it,unitId) }
    require(entries.map { it.id }.distinct().size==entries.size && entries.all { it.createdAt<=snapshot })
    require(entries.zipWithNext().all { (a,b) -> older(HistoryCursor(b.observedAt,b.id),HistoryCursor(a.observedAt,a.id)) })
    val next=parseCursor(json,"observed_at")
    require(next==null || entries.lastOrNull()?.let { it.id==next.id && it.observedAt==next.at }==true)
    return CareJournalPage(entries,snapshot,next)
}
suspend fun AgroApi.readCareJournal(unitId: String,window: HistoryWindow? = null,snapshot: Instant? = null,cursor: HistoryCursor? = null,limit: Int = 50): CareJournalPage {
    val page=parseCareJournalPage(rpc("read_my_care_journal",pageBody(unitId,window,snapshot,cursor,limit,true)),unitId)
    require(snapshot==null || snapshot.truncatedTo(ChronoUnit.MICROS)==page.snapshot)
    require(page.entries.size<=limit && (page.next==null || page.next!=cursor))
    cursor?.let { require(page.entries.all { entry -> older(HistoryCursor(entry.observedAt,entry.id),it) }) }
    window?.let { require(page.entries.all { e -> e.observedAt>=it.from && e.observedAt<it.to }) }
    return page
}

data class HistoryMeasurement(val id: String,val unitId: String,val deviceId: String,val packetId: String,val reading: Reading,val error: String?,
    val receivedAt: Instant,val clockStatus: String,val sequence: Long,val bootId: String)
data class MeasurementHistoryPage(val readings: List<HistoryMeasurement>,val snapshot: Instant,val next: HistoryCursor?)
internal fun parseMeasurementHistoryPage(json: JSONObject,unitId: String,window: HistoryWindow): MeasurementHistoryPage {
    json.success();require(json.id("unit_id")==unitId && json.instant("from")==window.from && json.instant("to")==window.to)
    val snapshot=json.instant("snapshot_as_of")
    val readings=json.array("readings").objects(500).map { row ->
        require(row.id("unit_id")==unitId && row.text("source",20)=="device")
        val quality=row.text("quality_status",20);require(quality in listOf("ok","error","not_measured"))
        val clock=row.text("clock_status",20);require(clock in listOf("synced","unsynced"))
        val error=nullableText(row,"error_message",240)
        require(quality!="error" || !error.isNullOrBlank())
        val reading=Reading.parse(row)
        val received=row.instant("received_at")
        require(reading.at>=window.from && reading.at<window.to && received<=snapshot)
        HistoryMeasurement(row.id("id"),unitId,row.id("device_id"),row.id("packet_id"),reading,error,received,clock,row.whole("sequence",0,Int.MAX_VALUE.toLong()),row.id("boot_id"))
    }
    require(readings.map { it.id }.distinct().size==readings.size)
    require(readings.zipWithNext().all { (a,b) -> older(HistoryCursor(b.reading.at,b.id),HistoryCursor(a.reading.at,a.id)) })
    val next=parseCursor(json,"measured_at")
    require(next==null || readings.lastOrNull()?.let { it.id==next.id && it.reading.at==next.at }==true)
    return MeasurementHistoryPage(readings,snapshot,next)
}
suspend fun AgroApi.readMeasurementHistory(unitId: String,window: HistoryWindow,snapshot: Instant? = null,cursor: HistoryCursor? = null,limit: Int = 100): MeasurementHistoryPage {
    val page=parseMeasurementHistoryPage(rpc("read_my_measurement_history",pageBody(unitId,window,snapshot,cursor,limit,false)),unitId,window)
    require((snapshot==null || snapshot.truncatedTo(ChronoUnit.MICROS)==page.snapshot) && page.readings.size<=limit && (page.next==null || page.next!=cursor))
    cursor?.let { require(page.readings.all { row -> older(HistoryCursor(row.reading.at,row.id),it) }) }
    return page
}

data class MeasurementStats(val total: Long,val ok: Long,val error: Long,val notMeasured: Long,val unsynced: Long,val eligible: Long,val min: Double?,val max: Double?,val avg: Double?)
data class SensorComparison(val sensor: Sensor,val first: MeasurementStats,val second: MeasurementStats,val avgDelta: Double?)
data class MeasurementComparison(val unitId: String,val snapshot: Instant,val first: HistoryWindow,val second: HistoryWindow,val sensors: List<SensorComparison>)
internal fun parseMeasurementComparison(json: JSONObject,unitId: String,first: HistoryWindow,second: HistoryWindow): MeasurementComparison {
    json.success();require(json.id("unit_id")==unitId)
    require(json.instant("first_from")==first.from && json.instant("first_to")==first.to && json.instant("second_from")==second.from && json.instant("second_to")==second.to)
    fun stats(row: JSONObject,sensor: Sensor): MeasurementStats {
        fun count(key: String)=row.whole(key,0,20000)
        val total=count("total_count");val ok=count("ok_count");val error=count("error_count");val missing=count("not_measured_count")
        val unsynced=count("unsynced_count");val eligible=count("eligible_count")
        val min=row.nullableNumber("min");val max=row.nullableNumber("max");val avg=row.nullableNumber("avg")
        require(total==ok+error+missing && unsynced<=total && eligible<=ok && eligible<=total-unsynced)
        require(if(eligible==0L) min==null && max==null && avg==null else min!=null && max!=null && avg!=null && min in sensor.min..sensor.max && max in min..sensor.max && avg in min..max)
        return MeasurementStats(total,ok,error,missing,unsynced,eligible,min,max,avg)
    }
    val sensors=json.array("sensors").objects(3).map { row ->
        val sensor=Sensor.parse(row.text("sensor_id"));val a=stats(row.getJSONObject("first"),sensor);val b=stats(row.getJSONObject("second"),sensor)
        val delta=row.nullableNumber("avg_delta")
        require(if(a.avg==null || b.avg==null) delta==null else delta!=null && kotlin.math.abs(delta-(b.avg-a.avg))<=1e-8)
        SensorComparison(sensor,a,b,delta)
    }
    require(sensors.map { it.sensor }.toSet()==Sensor.entries.toSet())
    return MeasurementComparison(unitId,json.instant("snapshot_as_of"),first,second,sensors)
}
suspend fun AgroApi.compareMeasurementHistory(unitId: String,first: HistoryWindow,second: HistoryWindow,snapshot: Instant? = null): MeasurementComparison {
    checkedId(unitId);require(first.to<=second.from || second.to<=first.from)
    val body=JSONObject().put("p_unit_id",unitId).put("p_first_from",first.from.toString()).put("p_first_to",first.to.toString())
        .put("p_second_from",second.from.toString()).put("p_second_to",second.to.toString())
    snapshot?.let { body.put("p_snapshot_as_of",it.truncatedTo(ChronoUnit.MICROS).toString()) }
    val result=parseMeasurementComparison(rpc("compare_my_measurement_history",body),unitId,first,second)
    require(snapshot==null || result.snapshot==snapshot.truncatedTo(ChronoUnit.MICROS))
    return result
}

private val historyColumns=listOf("id","unit_id","device_id","packet_id","sensor_id","source","quality_status","value_nullable","error_message","measured_at","received_at","clock_status","sequence","boot_id")
internal fun historyCsvCell(value: Any?): String {
    if(value==null) return "\"\""
    var text=value.toString()
    if(value is String && (text.startsWith('\t') || text.startsWith('\r') || text.startsWith('\n') || text.dropWhile { it.isWhitespace() || it.code<32 }.firstOrNull() in listOf('=','+','-','@'))) text="'"+text
    return "\""+text.replace("\"","\"\"")+"\""
}
internal fun measurementCsvLine(row: HistoryMeasurement): String = listOf(row.id,row.unitId,row.deviceId,row.packetId,row.reading.sensor.key,"device",row.reading.quality,
    row.reading.value,row.error,row.reading.at.toString(),row.receivedAt.toString(),row.clockStatus,row.sequence,row.bootId).joinToString(",",transform=::historyCsvCell)+"\r\n"
data class HistoryCsv(val content: String,val rows: Int,val snapshot: Instant)
/** Same columns, escaping and limits as history-export, assembled locally without writing a partial file. */
suspend fun AgroApi.exportMeasurementHistoryCsv(unitId: String,window: HistoryWindow): HistoryCsv {
    refresh()
    val account=requireNotNull(session).email
    return buildMeasurementHistoryCsv { snapshot,cursor ->
        check(session?.email==account) { "Akun berubah saat ekspor. Mulai ulang ekspor." }
        val page=readMeasurementHistory(unitId,window,snapshot,cursor,500)
        check(session?.email==account) { "Akun berubah saat ekspor. Mulai ulang ekspor." }
        page
    }
}
internal suspend fun buildMeasurementHistoryCsv(loadPage: suspend (Instant?,HistoryCursor?)->MeasurementHistoryPage): HistoryCsv = withTimeout(15000) {
    val output=StringBuilder("\uFEFF"+historyColumns.joinToString(",")+"\r\n")
    var bytes=output.toString().toByteArray(Charsets.UTF_8).size;var count=0;var snapshot: Instant?=null;var cursor: HistoryCursor?=null
    val seen=HashSet<String>()
    // ponytail: bounded synchronous export matches server 5,000 rows/4 MiB; larger exports need an authenticated job.
    repeat(10) {
        val page=loadPage(snapshot,cursor)
        require(snapshot==null || page.snapshot==snapshot) { "Snapshot histori berubah." }
        require(page.readings.size<=500 && (page.next==null || page.next!=cursor)) { "Cursor histori tidak maju." }
        snapshot=page.snapshot
        page.readings.forEach { row ->
            require(seen.add(row.id)) { "Halaman histori berulang." }
            val line=measurementCsvLine(row);bytes+=line.toByteArray(Charsets.UTF_8).size;count++
            require(count<=5000 && bytes<=4*1024*1024) { "Ekspor terlalu besar. Pilih rentang lebih kecil." }
            output.append(line)
        }
        if(page.next==null) return@withTimeout HistoryCsv(output.toString(),count,page.snapshot)
        cursor=page.next
    }
    throw IllegalArgumentException("Ekspor terlalu besar. Pilih rentang lebih kecil.")
}
