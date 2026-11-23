package id.smartagro.app

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class CareModelsTest {
    private val unit="11111111-1111-4111-8111-111111111111"
    @Test fun parsesOverviewIncludingIncompleteReadingsAndBandSources() {
        for(state in listOf("below","ok","above","learning","no_device","no_reading")) {
            val response=JSONObject("""{"ok":true,"plants":[{"slot_id":"$unit","unit_id":null,"name":"Cabai 1","state":"$state","band_source":"own_pattern","moisture":null}]}""")
            val plant=parseCarePlants(response).single()
            assertEquals(state,plant.state)
            assertEquals("Berdasarkan pola pot Anda",bandSourceLabel(plant.bandSource))
        }
        assertEquals("Profil kurasi untuk pot ini",bandSourceLabel("profile"))
    }
    @Test fun parsesOutlookRiseAndDeviceHealthFromRpcContracts() {
        val outlook=parseOutlook(JSONObject("""{"ok":true,"outlook":{"state":"window","from":"2026-11-23T14:00:00+07:00","to":"2026-11-23T16:00:00+07:00","band_source":"profile"}}"""))
        assertEquals("window",outlook.state)
        assertEquals("profile",outlook.bandSource)
        val rise=parseRises(JSONObject("""{"ok":true,"rises":[{"from":"2026-11-23T06:00:00Z","to":"2026-11-23T07:00:00Z","delta":8}]}""")).single()
        assertEquals(8.0,rise.delta,0.0)
        val health=parseUnitHealth(JSONObject("""{"ok":true,"device_id":"$unit","battery":[{"at":"2026-11-23T07:00:00Z","volts":3.5}],"battery_days_left":null,"upload_gaps":[{}],"calibration":{"moisture_at":"2026-11-22T07:00:00Z","ph_at":null}}"""))
        assertEquals(3.5,health.volts!!,0.0)
        assertEquals(1,health.gaps)
        assertNull(health.phAt)
        assertNotNull(health.moistureAt)
    }
    @Test fun cachedStatusesExpireByObservationTime() {
        val now=java.time.Instant.parse("2026-11-23T07:00:00Z")
        val plant=CarePlant(unit,unit,"Cabai 1","ok","own_pattern",50.0,now.minusSeconds(75*60))
        assertEquals("ok",careState(plant,now))
        assertEquals("no_reading",careState(plant.copy(measuredAt=now.minusSeconds(75*60+1)),now))
        assertEquals("no_reading",careState(plant.copy(measuredAt=null),now))
        assertEquals("no_reading",careState(plant.copy(measuredAt=now.plusSeconds(301)),now))
    }
    @Test fun emailAndKindsRoundTripAndUnknownKindsAreRejected() {
        val prefs=parseAlertPreferences(JSONObject("""{"ok":true,"email_enabled":false,"kinds":["soil_dry","soil_hot"]}"""))
        assertFalse(prefs.emailEnabled)
        assertEquals(setOf("soil_dry","soil_hot"),prefs.kinds)
        assertThrows(IllegalArgumentException::class.java) { parseAlertPreferences(JSONObject("""{"ok":true,"email_enabled":true,"kinds":["unknown"]}""")) }
        assertThrows(IllegalArgumentException::class.java) { parseRises(JSONObject("""{"ok":false,"rises":[]}""")) }
    }
    // The cloud may run an older schema than the app: a missing function (PostgREST 404) is "not on this server yet".
    @Test fun aMissingCareFunctionIsAbsentButOtherFailuresStillSurface() = kotlinx.coroutines.runBlocking {
        assertNull(missingRpcAsNull<JSONObject> { throw ApiFailure("Permintaan gagal.", status = 404) })
        val down = ApiFailure("Server belum dapat dihubungi.", status = 503)
        assertSame(down, assertThrows(ApiFailure::class.java) { kotlinx.coroutines.runBlocking { missingRpcAsNull<JSONObject> { throw down } } })
        val expired = ApiFailure("Sesi berakhir", expired = true, status = 404)
        assertSame(expired, assertThrows(ApiFailure::class.java) { kotlinx.coroutines.runBlocking { missingRpcAsNull<JSONObject> { throw expired } } })
        assertEquals(7, missingRpcAsNull { 7 })
    }
    @Test fun careRefusalsReadAsTheirCauseNotAsALostConnection() {
        fun refusal(code: String) = friendlyError(200, JSONObject().put("ok", false).put("code", code).put("message", "English text."))
        assertEquals("Unit ini sudah terhubung ke tanaman lain. Lepaskan dari tanaman lama dahulu.", refusal("unit_already_assigned"))
        for (code in listOf("slot_unavailable", "unit_unavailable", "device_unavailable", "rise_unavailable", "invalid_request"))
            assertNotEquals(code, "Permintaan gagal. Periksa koneksi dan coba lagi.", refusal(code))
    }
    @Test fun theServerReceivesANamedTimeZone() {
        assertEquals("Asia/Makassar", careZone("Asia/Makassar"))
        assertEquals("Asia/Jakarta", careZone("GMT+07:00"))
    }
}
