package id.smartagro.app

import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant
import java.time.LocalDate

class GardenWorkflowsTest {
    private fun id(n: Int)="00000000-0000-4000-8000-"+n.toString().padStart(12,'0')
    private val at=Instant.parse("2026-11-16T00:00:00Z")
    private val window=HistoryWindow(at.minusSeconds(86400),at.plusSeconds(86400))
    private fun rejects(block: ()->Unit) {
        try { block(); fail("Expected validation failure") }
        catch(_: IllegalArgumentException) { }
        catch(_: org.json.JSONException) { }
    }
    private fun cycle()=JSONObject().put("id",id(1)).put("slot_id",id(2)).put("species_id",1).put("plant_no",2).put("code",1000002)
        .put("nickname","Cabai 2").put("planted_on","2026-11-15").put("ended_on",JSONObject.NULL).put("outcome",JSONObject.NULL)
    private fun measurement(n: Int=1)=JSONObject().put("id",id(n)).put("unit_id",id(2)).put("device_id",id(3)).put("packet_id",id(4))
        .put("sensor_id","moisture").put("source","device").put("quality_status","ok").put("value_nullable",0)
        .put("error_message",JSONObject.NULL).put("measured_at",at.toString()).put("received_at",at.toString())
        .put("clock_status","synced").put("sequence",0).put("boot_id",id(5))
    private fun history(row: JSONObject=measurement())=JSONObject().put("ok",true).put("unit_id",id(2)).put("from",window.from.toString()).put("to",window.to.toString())
        .put("snapshot_as_of",at.toString()).put("readings",JSONArray().put(row)).put("next_cursor",JSONObject.NULL)
    @Test fun gardenRequestsKeepCallerIdentityAndRejectInvalidZones() {
        val site=NewGardenSite("  Kebun   rumah ","garden","outdoor",listOf("Timur","Barat"),-6.9,107.6)
        val body=gardenSiteBody(id(1),site)
        assertEquals(id(1),body.getString("p_request_id")); assertEquals("Kebun rumah",body.getString("p_name"))
        assertEquals(2,body.getJSONArray("p_zones").length())
        rejects { gardenSiteBody(id(1),site.copy(zones=listOf("Timur"," timur "))) }
        rejects { gardenSiteBody("bad",site) }; rejects { gardenSiteBody(id(1),site.copy(latitude=Double.NaN)) }
        val pot=gardenSiteBody(id(1),NewGardenSite("Pot","pot","indoor",latitude=1.0,longitude=2.0))
        assertTrue(pot.isNull("p_latitude"));assertTrue(pot.isNull("p_zones"))
        val plant=gardenPlantBody(id(1),id(2),1,LocalDate.parse("2026-11-16"),null,"berhasil")
        assertEquals("2026-11-16",plant.getString("p_on"));assertFalse(plant.has("p_planted_on"))
        rejects { gardenPlantBody(id(1),id(2),0,LocalDate.now(),null) }
    }
    @Test fun unicodeLimitsCountDatabaseCharactersAndKeepUtf8ByteCeiling() {
        val emoji="\uD83C\uDF31"
        val name=emoji.repeat(60)
        val site=NewGardenSite(name,"pot","indoor")
        assertEquals(name,gardenSiteBody(id(1),site).getString("p_name"))
        assertEquals(name,parseGardenCycle(cycle().put("nickname",name)).nickname)
        rejects { gardenSiteBody(id(1),site.copy(name=name+emoji)) }
        rejects { parseGardenCycle(cycle().put("nickname",name+emoji)) }
        val notes=emoji.repeat(2000)
        assertEquals(8000,notes.toByteArray(Charsets.UTF_8).size)
        val request=careJournalBody(id(2),id(1),"note",at,null,notes)
        assertEquals(notes,request.getString("p_notes"))
        val entry=JSONObject().put("id",id(1)).put("unit_id",id(2)).put("kind","note").put("amount_ml",JSONObject.NULL)
            .put("notes",notes).put("observed_at",at.toString()).put("created_at",at.toString())
        assertEquals(notes,parseCareEntry(entry,id(2)).notes)
        rejects { careJournalBody(id(2),id(1),"note",at,null,notes+emoji) }
        rejects { parseCareEntry(entry.put("notes",notes+emoji),id(2)) }
    }
    @Test fun cycleHistoryPreservesOutcomesAndRejectsImpossibleCodes() {
        val old=cycle().put("ended_on","2026-11-16").put("outcome","berhasil")
        val json=JSONObject().put("ok",true).put("slots",JSONArray().put(JSONObject().put("id",id(2)))).put("cycles",JSONArray().put(old))
        assertEquals("berhasil",parseGardenCycleHistory(json,id(2)).single().outcome)
        rejects { parseGardenCycle(old.put("code",1000003)) }
        rejects { parseGardenCycle(cycle().put("outcome","gagal")) }
        rejects { parseGardenCycleHistory(json,id(9)) }
    }
    @Test fun careJournalSeparatesReportsFromSensorDataAndValidatesAmount() {
        val body=careJournalBody(id(2),id(1),"watering",at,150.0,"  Disiram manual  ")
        assertEquals("Disiram manual",body.getString("p_notes"));assertEquals(id(1),body.getString("p_request_id"))
        rejects { careJournalBody(id(2),id(1),"note",at,null," ") }
        rejects { careJournalBody(id(2),id(1),"inspection",at,1.0,"") }
        rejects { careJournalBody(id(2),id(1),"watering",at,Double.NaN,"") }
        val entry=JSONObject().put("id",id(1)).put("unit_id",id(2)).put("kind","inspection").put("amount_ml",JSONObject.NULL)
            .put("notes","").put("observed_at",at.toString()).put("created_at",at.toString())
        val page=JSONObject().put("ok",true).put("entries",JSONArray().put(entry)).put("snapshot_as_of",at.toString()).put("next_cursor",JSONObject.NULL)
        assertEquals("",parseCareJournalPage(page,id(2)).entries.single().notes)
        rejects { parseCareJournalPage(page,id(3)) }
        page.put("next_cursor",JSONObject().put("id",id(9)).put("observed_at",at.toString()));rejects { parseCareJournalPage(page,id(2)) }
    }
    @Test fun historyWindowsNormalizeDatabasePrecisionBeforeRequestAndEchoValidation() {
        val nanos=at.plusNanos(123456789)
        val effective=HistoryWindow(nanos,nanos.plusSeconds(1))
        assertEquals(123456000,effective.from.nano)
        assertEquals(effective.from.plusSeconds(1),effective.to)
        val response=history().put("from",effective.from.toString()).put("to",effective.to.toString()).put("readings",JSONArray())
        assertTrue(parseMeasurementHistoryPage(response,id(2),effective).readings.isEmpty())
        rejects { HistoryWindow(at,at.plusNanos(1)) }
    }
    @Test fun historyKeepsIdsAtEqualTimestampsAndReachesOwnershipStart() {
        val first = parseMeasurementHistoryPage(
            history(measurement().put("id", id(9))).put("next_cursor",
                JSONObject().put("measured_at", at.toString()).put("id", id(9))),
            id(2), window,
        )
        val second = parseMeasurementHistoryPage(history(measurement().put("id", id(8))), id(2), window)
        assertEquals(HistoryCursor(at, id(9)), first.next)
        assertEquals(listOf(id(9), id(8)), (first.readings + second.readings).map { it.reading.id })
        assertEquals(first.readings.single().reading.at, second.readings.single().reading.at)

        val ownershipStart = at.minusSeconds(45 * 86400L)
        val recent = requireNotNull(historyWindowEndingAt(at, ownershipStart))
        val previous = requireNotNull(historyWindowEndingAt(recent.from, ownershipStart))
        assertEquals(at.minusSeconds(31 * 86400L), recent.from)
        assertEquals(recent.from, previous.to)
        assertEquals(ownershipStart, previous.from)
        assertNull(historyWindowEndingAt(previous.from, ownershipStart))
    }
    @Test fun chartLoadsEveryPageInItsSelectedRangeWithTheSameSnapshot() = runBlocking {
        val day = HistoryRange.Day.window(at)
        val week = HistoryRange.Week.window(at)
        assertEquals(at.minusSeconds(86_400), day.from)
        assertEquals(at.minusSeconds(7 * 86_400L), week.from)
        assertEquals(day.to, week.to)

        val row = parseMeasurementHistoryPage(history(), id(2), window).readings.single()
        val cursor = HistoryCursor(row.reading.at, row.id)
        val older = row.reading.copy(id = id(1))
        val requests = mutableListOf<Pair<Instant?, HistoryCursor?>>()
        val (readings, snapshot) = collectHistoryReadings { cutoff, before ->
            requests += cutoff to before
            if (before == null) MeasurementHistoryPage(listOf(row), at, cursor)
            else MeasurementHistoryPage(listOf(row.copy(id = id(1), reading = older)), at, null)
        }
        assertEquals(listOf(null to null, at to cursor), requests)
        assertEquals(at, snapshot)
        assertEquals(listOf(row.reading, older), readings)
    }
    @Test fun measurementHistoryRejectsIdentityInvalidDataAndUnrelatedCursor() {
        assertEquals(0.0,parseMeasurementHistoryPage(history(),id(2),window).readings.single().reading.value!!,0.0)
        rejects { parseMeasurementHistoryPage(history(),id(3),window) }
        rejects { parseMeasurementHistoryPage(history(measurement().put("quality_status","error")),id(2),window) }
        rejects { parseMeasurementHistoryPage(history(measurement().put("clock_status","unknown")),id(2),window) }
        rejects { parseMeasurementHistoryPage(history().put("next_cursor",JSONObject().put("id",id(9)).put("measured_at",at.toString())),id(2),window) }
        rejects { HistoryWindow(at,at.plusSeconds(32*86400)) }
    }
    @Test fun comparisonsKeepMissingEvidenceNullAndValidateCounts() {
        fun stats()=JSONObject().put("total_count",0).put("ok_count",0).put("error_count",0).put("not_measured_count",0)
            .put("unsynced_count",0).put("eligible_count",0).put("min",JSONObject.NULL).put("max",JSONObject.NULL).put("avg",JSONObject.NULL)
        val second=HistoryWindow(window.to,window.to.plusSeconds(86400))
        val sensors=JSONArray();Sensor.entries.forEach { sensors.put(JSONObject().put("sensor_id",it.key).put("first",stats()).put("second",stats()).put("avg_delta",JSONObject.NULL)) }
        val json=JSONObject().put("ok",true).put("unit_id",id(2)).put("snapshot_as_of",at.toString()).put("first_from",window.from.toString())
            .put("first_to",window.to.toString()).put("second_from",second.from.toString()).put("second_to",second.to.toString()).put("sensors",sensors)
        assertNull(parseMeasurementComparison(json,id(2),window,second).sensors.first().avgDelta)
        sensors.getJSONObject(0).getJSONObject("first").put("avg",0);rejects { parseMeasurementComparison(json,id(2),window,second) }
    }
    @Test fun cancelledExportDoesNotReturnPartialContent() = runBlocking {
        var entered=false
        try {
            kotlinx.coroutines.withTimeout(100) {
                buildMeasurementHistoryCsv { _,_ -> entered=true;kotlinx.coroutines.awaitCancellation() }
            }
            fail("Cancelled export returned content")
        } catch(_: kotlinx.coroutines.TimeoutCancellationException) { assertTrue(entered) }
    }
    @Test fun csvEscapesFormulasQuotesControlsAndKeepsZero() {
        assertEquals("\"' =SUM(A1)\"",historyCsvCell(" =SUM(A1)"))
        assertEquals("\"'\ttext\"",historyCsvCell("\ttext"))
        assertEquals("\"a\"\"b\nc\"",historyCsvCell("a\"b\nc"))
        assertEquals("\"\"",historyCsvCell(null));assertEquals("\"0\"",historyCsvCell(0))
        assertEquals("\"-2\"",historyCsvCell(-2));assertEquals("\"'-2\"",historyCsvCell("-2"))
    }
    @Test fun exportPreservesSnapshotAndRejectsRepeatedOrChangingPagesWithoutPartialResult() = runBlocking {
        val parsed=parseMeasurementHistoryPage(history(),id(2),window)
        val row=parsed.readings.single()
        val cursor=HistoryCursor(row.reading.at,row.id)
        var calls=0
        val csv=buildMeasurementHistoryCsv { snap,before ->
            calls++
            if(calls==1) { assertNull(snap);assertNull(before);parsed.copy(next=cursor) }
            else { assertEquals(at,snap);assertEquals(cursor,before);parsed.copy(readings=emptyList()) }
        }
        assertEquals(1,csv.rows);assertTrue(csv.content.startsWith("\uFEFFid,unit_id,"));assertTrue(csv.content.endsWith("\r\n"))
        try { buildMeasurementHistoryCsv { _,_ -> parsed.copy(next=cursor) };fail("Repeated page accepted") } catch(_: IllegalArgumentException) { }
        calls=0
        try { buildMeasurementHistoryCsv { _,_ -> calls++;if(calls==1) parsed.copy(next=cursor) else parsed.copy(snapshot=at.plusSeconds(1)) };fail("Changed snapshot accepted") } catch(_: IllegalArgumentException) { }
        val many=(1..500).map { row.copy(id=id(it)) }
        calls=0
        try { buildMeasurementHistoryCsv { _,_ -> calls++; parsed.copy(readings=many.map { it.copy(id=id(it.id.takeLast(12).toInt()+calls*1000)) },next=HistoryCursor(at,id(calls+100))) };fail("Unbounded export accepted") } catch(_: IllegalArgumentException) { }
        assertTrue(calls<=10)
        try { buildMeasurementHistoryCsv { _,_ -> parsed.copy(readings=listOf(row.copy(error="x".repeat(4*1024*1024)))) };fail("Oversized CSV accepted") } catch(_: IllegalArgumentException) { }
        try { buildMeasurementHistoryCsv { _,_ -> throw IllegalStateException("Upstream unavailable") };fail("Failed pagination returned a partial result") } catch(_: IllegalStateException) { }
    }
}


@org.junit.runner.RunWith(org.robolectric.RobolectricTestRunner::class)
@org.robolectric.annotation.Config(sdk=[34],shadows=[WindowsAtomicFileShadow::class])
class GardenWorkflowApiTest {
    @Test fun journalNanosecondsAreNormalizedBeforeWriteAndReceiptComparison() = runBlocking {
        val id="00000000-0000-4000-8000-000000000001"
        val observed=Instant.parse("2026-11-16T00:00:00.123456789Z")
        val micros=observed.truncatedTo(java.time.temporal.ChronoUnit.MICROS)
        val context=androidx.test.core.app.ApplicationProvider.getApplicationContext<android.content.Context>()
        val key=javax.crypto.KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val endpoint="https://garden-contract.test"
        val store=SessionStore(context,endpoint+java.util.UUID.randomUUID()) { key }
        var journalRequests=0
        lateinit var api: AgroApi
        api=AgroApi(BackendConfig(endpoint,"sb_publishable_contract_test"),store) { uri ->
            object: java.net.HttpURLConnection(uri.toURL()) {
                private val output=java.io.ByteArrayOutputStream()
                override fun connect() { }
                override fun disconnect() { }
                override fun usingProxy()=false
                override fun getOutputStream()=output
                override fun getResponseCode(): Int = 200
                override fun getInputStream(): java.io.InputStream {
                    val response=if(uri.path=="/auth/v1/user") JSONObject().put("email","garden@example.test").put("factors",JSONArray())
                    else if(uri.path=="/rest/v1/rpc/read_my_measurement_history") {
                        runBlocking { api.clear() }
                        JSONObject().put("ok",true).put("unit_id",id).put("from",micros.toString()).put("to",micros.plusSeconds(1).toString())
                            .put("snapshot_as_of",micros.plusSeconds(2).toString()).put("readings",JSONArray()).put("next_cursor",JSONObject.NULL)
                    } else {
                        assertEquals("/rest/v1/rpc/append_my_care_journal",uri.path)
                        val sent=JSONObject(output.toString("UTF-8"));journalRequests++
                        assertEquals(micros.toString(),sent.getString("p_observed_at"))
                        JSONObject().put("ok",true).put("idempotent",false).put("entry",JSONObject()
                            .put("id",id).put("unit_id",id).put("kind","inspection").put("notes","").put("amount_ml",JSONObject.NULL)
                            .put("observed_at",micros.toString()).put("created_at",micros.plusSeconds(1).toString()))
                    }
                    return java.io.ByteArrayInputStream(response.toString().toByteArray(Charsets.UTF_8))
                }
            }
        }
        store.save(Session("garden-access","garden-refresh",Instant.now().epochSecond+3600,"garden@example.test"))
        try {
            assertTrue(api.restore())
            assertEquals(micros,api.appendCareJournal(id,id,"inspection",observed).observedAt)
            assertEquals(1,journalRequests)
            try {
                api.exportMeasurementHistoryCsv(id,HistoryWindow(micros,micros.plusSeconds(1)))
                fail("Export returned after its account session was cleared")
            } catch(_: IllegalStateException) { assertNull(api.session) }
        } finally { store.clear() }
    }
}
