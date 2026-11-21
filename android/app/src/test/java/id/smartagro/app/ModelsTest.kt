package id.smartagro.app

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class ModelsTest {
    private val now = Instant.parse("2026-11-15T00:00:00Z")
    private fun reading(sensor: Sensor = Sensor.Moisture, seconds: Long = 0, value: Double? = 50.0, quality: String = "ok", synced: Boolean = true) =
        Reading(sensor, quality, value, now.plusSeconds(seconds), synced)
    private fun rejects(block: () -> Unit) {
        try { block(); fail("Expected validation failure") } catch (_: IllegalArgumentException) { }
    }
    @Test fun chartDoesNotInventContinuityAcrossMissingInvalidOrUnsyncedData() {
        val values = listOf(reading(seconds=0),reading(seconds=60),reading(seconds=120,value=null,quality="error"),
            reading(seconds=180),reading(seconds=240,synced=false),reading(seconds=300),reading(seconds=4000))
        assertEquals(listOf(2,1,1,1),chartSegments(values,Sensor.Moisture).map { it.size })
        assertTrue(chartSegments(values,Sensor.Ph).isEmpty())
    }
    @Test fun missingPhIsNotZeroAndRangesAreValidated() {
        val absent = JSONObject("""{"sensor_id":"soil_ph","quality_status":"not_measured","value_nullable":null,"measured_at":"2026-11-15T00:00:00Z"}""")
        assertNull(Reading.parse(absent).value)
        rejects { Reading.parse(JSONObject(absent.toString()).put("quality_status","ok")) }
        rejects { Reading.parse(JSONObject(absent.toString()).put("quality_status","ok").put("value_nullable",15)) }
        rejects { Reading.parse(JSONObject(absent.toString()).put("value_nullable",0)) }
    }
    @Test fun firmwareProbeErrorsBecomeActionableHints() {
        val row = JSONObject("""{"sensor_id":"soil_temperature","quality_status":"error","value_nullable":null,"error_message":"Expected one DS18B20 probe","measured_at":"2026-11-15T00:00:00Z"}""")
        val reading = Reading.parse(row)
        assertEquals("Expected one DS18B20 probe", reading.error)
        assertTrue(probeErrorHint(reading.error)!!.contains("DS18B20"))
        assertTrue(probeErrorHint("Moisture ADC outside usable range")!!.contains("HW-390"))
        assertTrue(probeErrorHint("pH ADC or calibrated result outside usable range")!!.contains("DMS"))
        assertEquals("Pesan perangkat: kabel longgar", probeErrorHint("kabel longgar"))
        // A good reading carries no error text, even if a row has one.
        assertNull(Reading.parse(JSONObject(row.toString()).put("quality_status","ok").put("value_nullable",24.5)).error)
        assertNull(probeErrorHint(null))
    }
    @Test fun postgresTimestampsWithOffsetsAreRead() {
        // Postgres writes timestamptz inside jsonb as +00:00, never Z, and Instant.parse rejects an offset
        // before Java 12 (Android 8-11). This JVM accepts both, so only an API 30 device shows the old failure.
        val row = JSONObject("""{"sensor_id":"moisture","quality_status":"ok","value_nullable":50,"measured_at":"2026-11-15T07:00:00.123456+07:00"}""")
        assertEquals(Instant.parse("2026-11-15T00:00:00.123456Z"),Reading.parse(row).at)
        assertEquals(now,Reading.parse(row.put("measured_at","2026-11-15T00:00:00+00:00")).at)
        assertEquals(now,Reading.parse(row.put("measured_at","2026-11-15T00:00:00Z")).at)
        rejects { Reading.parse(row.put("measured_at","2026-11-15 00:00:00")) }
    }
    @Test fun staleAndFuturePacketsCannotLookCurrent() {
        assertFalse(Overview("id",now,emptyList(),emptyList(),null).stale(now))
        // A device reports every 30 minutes; the server calls a unit stale after 75 (my_unit_overview).
        assertFalse(Overview("id",now.minusSeconds(31*60),emptyList(),emptyList(),null).stale(now))
        assertTrue(Overview("id",now.minusSeconds(75*60+1),emptyList(),emptyList(),null).stale(now))
        // Each sensor reading uses the same window as the unit.
        assertTrue(fresh(now.minusSeconds(31*60),now));assertFalse(fresh(now.minusSeconds(75*60+1),now));assertFalse(fresh(now.plusSeconds(301),now))
        // A phone clock a little behind the server must not turn a just-received packet into "old data" (ingest allows +5 min).
        assertTrue(fresh(now.plusSeconds(120),now))
        assertTrue(Overview("id",now.plusSeconds(301),emptyList(),emptyList(),null).stale(now))
        assertTrue(Overview("id",null,emptyList(),emptyList(),null).stale(now))
        assertTrue(Overview("id",now,listOf("stale"),emptyList(),null).stale(now))
    }
    @Test fun backendConfigurationRejectsInsecureUrlsAndPrivilegedKeys() {
        val publicKey="sb_publishable_example123"
        assertTrue(BackendConfig("https://project.supabase.co",publicKey).valid)
        listOf("http://project.supabase.co","https://user:pass@project.supabase.co","https://project.supabase.co?key=a","https://project.supabase.co/auth").forEach {
            assertFalse(BackendConfig(it,publicKey).valid)
        }
        assertFalse(BackendConfig("https://project.supabase.co","sb_secret_never_ship_this").valid)
        val payload=java.util.Base64.getUrlEncoder().withoutPadding().encodeToString("""{"role":"service_role"}""".toByteArray())
        assertFalse(BackendConfig("https://project.supabase.co","header.$payload.signature").valid)
    }
    @Test fun plainHttpOnlyToTheEmulatorHostAndOnlyWhenAllowed() {
        val key="sb_publishable_example123"
        assertFalse("release builds never allow http", BackendConfig("http://10.0.2.2:54321",key).valid)
        assertTrue(BackendConfig("http://10.0.2.2:54321",key,allowEmulatorHost=true).valid)
        listOf("http://project.supabase.co","http://127.0.0.1:54321","http://10.0.2.2.evil.test","http://10.0.2.22:54321").forEach {
            assertFalse(it, BackendConfig(it,key,allowEmulatorHost=true).valid)
        }
    }
    @Test fun parserRejectsBrokenOwnershipRatherThanShowingAnotherProduct() {
        rejects { parseProducts(JSONObject("""{"products":[{"product_id":"bad-id","serial_public":"ABC","variant":"single_pot"}]}""")) }
        rejects { parseProducts(JSONObject("""{"products":null}""")) }
        assertEquals("Produk lainnya",parseProducts(JSONObject("""{"products":[{"product_id":"00000000-0000-4000-8000-000000000001","serial_public":"ABC","variant":"unknown"}]}""")).single().label)
    }
    @Test fun authErrorsDoNotLeakRawServerDetails() {
        assertEquals("Email atau kata sandi salah. Coba periksa kembali.",friendlyError(400,JSONObject().put("msg","Invalid login credentials")))
        assertFalse(friendlyError(500,JSONObject().put("message","private database detail")).contains("private"))
        // An RPC that answers "no session" is a sign-in problem, not a connection problem.
        assertEquals("Sesi berakhir. Silakan masuk kembali.",friendlyError(200,JSONObject().put("ok",false).put("code","unauthorized").put("message","Active session required.")))
    }
    @Test fun historyShowsOnlyDeviceReadingsAndSkipsValuesItDoesNotKnow() {
        val row = JSONObject("""{"id":"00000000-0000-4000-8000-000000000001","boot_id":"00000000-0000-4000-8000-000000000002","received_at":"2026-11-15T00:00:00Z","measured_at":"2026-11-15T00:00:00Z","sensor_id":"moisture","quality_status":"ok","value_nullable":50,"source":"device","clock_status":"synced","sequence":1,"error_message":null}""")
        fun page(vararg items: JSONObject) = JSONObject().put("readings", org.json.JSONArray().apply { items.forEach { put(it) } })
        fun other(id: Int, key: String, value: Any) = JSONObject(row.toString()).put("id","00000000-0000-4000-8000-00000000000$id").put(key,value)
        assertEquals(50.0,parseHistory(page(row)).single().value!!,0.0)
        // The server also stores 'simulation' readings, and may add a clock status later: those rows are left out of the
        // chart (never shown as device data), and the device readings on the same page still show.
        assertEquals(listOf(row.getString("id")), parseHistory(page(row, other(2,"source","simulation"), other(3,"clock_status","drifting"))).map { it.id })
        rejects { parseHistory(page(JSONObject(row.toString()).put("sequence",1.5))) }
        rejects { parseHistory(page(JSONObject(row.toString()).put("source",7))) }
    }


    @org.junit.Test fun codesAndSensorEvents() {
        val first=PlantUnit("11111111-1111-4111-8111-111111abcdef","p","Bawang","bawang")
        val other=first.copy(id="22222222-2222-4222-8222-222222abcdef")
        org.junit.Assert.assertNotEquals(unitCode(first,listOf(first,other)),unitCode(other,listOf(first,other)))
        org.junit.Assert.assertEquals(unitCode(first,listOf(first,other)),unitCode(first.copy(name="Dapur"),listOf(first,other)))
        val at=java.time.Instant.parse("2026-11-15T00:00:00Z")
        fun readings(values:List<Double?>)=values.mapIndexed { i,v->Reading(Sensor.Moisture,if(v==null) "error" else "ok",v,at.plusSeconds(i*300L)) }
        val rises=moistureRises(readings(listOf(62.0,60.0,59.0,64.0,76.0,73.0)))
        org.junit.Assert.assertEquals(1,rises.size)
        org.junit.Assert.assertEquals(59.0,rises[0].from.value!!,0.0)
        org.junit.Assert.assertEquals(76.0,rises[0].to.value!!,0.0)
        org.junit.Assert.assertTrue(moistureRises(readings(listOf(60.0,62.0,61.0,63.0))).isEmpty())
        org.junit.Assert.assertTrue(moistureRises(readings(listOf(50.0,null,65.0))).isEmpty())
        org.junit.Assert.assertTrue(moistureRises(listOf(Reading(Sensor.Moisture,"ok",50.0,at),Reading(Sensor.Moisture,"ok",70.0,at.plusSeconds(7200)))).isEmpty())
    }
    @org.junit.Test fun rewardBalanceRejectsInconsistentOrInventedValues() {
        fun balance(confirmed:Any,reserved:Any,available:Any)=org.json.JSONObject().put("ok",true).put("policy",org.json.JSONObject.NULL).put("balance",org.json.JSONObject().put("confirmed_points",confirmed).put("reserved_points",reserved).put("available_points",available))
        org.junit.Assert.assertEquals(240L,parseRewardBalance(balance(300,60,240)).available)
        for (json in listOf(balance(300,60,300),balance(-1,0,-1),balance(2.5,0,2.5),balance("300",0,300))) {
            org.junit.Assert.assertThrows(IllegalArgumentException::class.java) { parseRewardBalance(json) }
        }
    }
    @Test fun rewardsAndProofsRejectMalformedOrMisleadingResponses() {
        val id="00000000-0000-4000-8000-000000000001"
        val workspace=JSONObject("""{"ok":true,"policy":null,"balance":{"confirmed_points":300,"reserved_points":60,"available_points":240},"catalog":[],"redemptions":[],"ledger":[]}""")
        val item=JSONObject().put("id",id).put("title","Bibit").put("point_cost",80).put("stock_total",2).put("stock_reserved",1).put("availability","available")
        workspace.getJSONArray("catalog").put(item)
        assertTrue(parseRewards(workspace).catalog.single().canReserve(parseRewards(workspace).balance))
        item.put("stock_reserved",3); rejects { parseRewards(workspace) }
        item.put("stock_reserved",1).put("point_cost",-1); rejects { parseRewards(workspace) }
        val proof=JSONObject().put("event_key","claim:$id").put("kind","ownership_claim").put("serial_public","SA-1").put("status","pending")
            .put("artifact_sha256","a".repeat(64)).put("chain_id",JSONObject.NULL).put("tx_hash",JSONObject.NULL).put("block_number",JSONObject.NULL)
            .put("confirmed_at",JSONObject.NULL).put("created_at",now.toString())
        val page=JSONObject().put("ok",true).put("proofs",org.json.JSONArray().put(proof))
        assertNull(parseProofs(page).single().explorer)
        // A proof kind this version does not know (the event key already allows recovery) is left out, not fatal.
        val newer=JSONObject(proof.toString()).put("event_key","recovery:00000000-0000-4000-8000-000000000009").put("kind","ownership_recovery")
        assertEquals(listOf("claim:$id"), parseProofs(JSONObject().put("ok",true).put("proofs",org.json.JSONArray().put(proof).put(newer))).map { it.event })
        proof.put("status","confirmed"); rejects { parseProofs(page) }
        proof.put("tx_hash","0x"+"b".repeat(64)).put("chain_id","84532").put("block_number",12).put("confirmed_at",now.toString())
        assertTrue(parseProofs(page).single().explorer!!.startsWith("https://sepolia.basescan.org/tx/0x"))
        proof.put("tx_hash","javascript:alert(1)"); rejects { parseProofs(page) }
    }
    @Test fun profileNamesAndRewardGateMessagesMatchAccountRules() {
        assertEquals("Maliq Agro",displayName("  Maliq   Agro  "))
        rejects { displayName(" ") }; rejects { displayName("a".repeat(41)) }; rejects { displayName("nama\u202e") }
        assertEquals("Masukkan kode autentikator terbaru, lalu konfirmasi kembali.",friendlyError(200,JSONObject().put("code","step_up_required")))
        assertFalse(friendlyError(200,JSONObject().put("code","insufficient_points")).contains("gagal"))
    }
    @Test fun authErrorsFromGoTrueReadAsTheirCauseNotAsAConnectionProblem() {
        fun gotrue(status: Int, name: String, msg: String) = friendlyError(status, JSONObject().put("code", status).put("error_code", name).put("msg", msg))
        assertEquals("Email ini sudah terdaftar. Silakan masuk.", gotrue(422, "user_already_exists", "User already registered"))
        assertEquals("Kata sandi minimal 10 karakter.", gotrue(422, "weak_password", "Password should be at least 10 characters."))
        // An expired email code is not an authenticator problem.
        assertTrue(gotrue(403, "otp_expired", "Token has expired or is invalid").contains("email"))
        assertTrue(gotrue(429, "over_email_send_rate_limit", "email rate limit exceeded").contains("Tunggu"))
    }

    @Test fun newAlertsAndSensorsDoNotHideKnownReadings() {
        val sensor = JSONObject().put("sensor_id","moisture").put("quality_status","ok").put("value_nullable",50).put("measured_at","2026-11-15T00:00:00Z")
        val unit = JSONObject().put("unit_id","00000000-0000-4000-8000-000000000001").put("last_packet_at","2026-11-15T00:00:00Z")
            .put("alerts",org.json.JSONArray().put("stale").put("future_alert"))
            .put("sensors",org.json.JSONArray().put(sensor).put(JSONObject(sensor.toString()).put("sensor_id","future_sensor")))
        val overview=parseOverviews(JSONObject().put("units",org.json.JSONArray().put(unit))).single()
        assertEquals(1,overview.readings.size)
        assertTrue("Unknown alerts must not look healthy",overview.alerts.contains("future_alert"))
    }

    @Test fun chartZoomPreservesSmallChangesAndSafeLimits() {
        val range=chartRange(listOf(reading(Sensor.Ph,value=6.0),reading(Sensor.Ph,seconds=60,value=6.2)),Sensor.Ph)
        assertTrue(range.start<6.0 && range.endInclusive>6.2)
        assertTrue(range.endInclusive-range.start<2.0)
        val flat=chartRange(listOf(reading(Sensor.Moisture,value=0.0)),Sensor.Moisture)
        assertEquals(0.0,flat.start,0.0);assertTrue(flat.endInclusive>0)
        assertEquals(-20.0..60.0,chartRange(emptyList(),Sensor.Temperature))
    }
    @Test fun unknownQualityNeverInventsGoodSensorValues() {
        val row=JSONObject().put("sensor_id","moisture").put("quality_status","calibrating").put("value_nullable",80).put("measured_at","2026-11-15T00:00:00Z")
        val reading=Reading.parse(row)
        assertNull(reading.value);assertTrue(chartSegments(listOf(reading),Sensor.Moisture).isEmpty())
    }

}
