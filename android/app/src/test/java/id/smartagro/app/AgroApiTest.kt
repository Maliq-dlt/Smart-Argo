package id.smartagro.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.sun.net.httpserver.HttpServer
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.net.InetSocketAddress
import java.net.HttpURLConnection
import java.net.URI
import java.time.Instant
import java.util.concurrent.ConcurrentLinkedQueue
import javax.crypto.KeyGenerator

/** Runs real HTTP/JSON against an isolated contract server, not a live Supabase account. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],shadows=[WindowsAtomicFileShadow::class])
class AgroApiTest {
    private data class Reply(val path: String, val method: String, val status: Int, val json: JSONObject, val body: (JSONObject)->Unit = {})
    private val replies=ConcurrentLinkedQueue<Reply>()
    private val failures=ConcurrentLinkedQueue<Throwable>()
    private lateinit var server: HttpServer
    private lateinit var store: SessionStore
    private lateinit var api: AgroApi
    private val config=BackendConfig("https://android-contract.invalid","sb_publishable_contract_test")
    private val unitId="00000000-0000-4000-8000-000000000001"
    private val factor="00000000-0000-4000-8000-000000000002"
    private val challenge="00000000-0000-4000-8000-000000000003"
    private fun user(mfa: Boolean=false,name: String="Petani") = JSONObject().put("email","grower@example.test").put("user_metadata",JSONObject().put("display_name",name))
        .put("factors",JSONArray().apply { if(mfa) put(JSONObject().put("id",factor).put("factor_type","totp").put("status","verified")) })
    private fun token(access: String="access-contract",expiry: Long=Instant.now().epochSecond+3600,mfa: Boolean=false)=JSONObject().put("access_token",access).put("refresh_token","refresh-contract").put("expires_at",expiry).put("user",user(mfa))
    private fun reply(path: String,json: JSONObject=JSONObject(),method: String="POST",status: Int=200,body: (JSONObject)->Unit={}) { replies.add(Reply(path,method,status,json,body)) }
    @Before fun start() {
        server=HttpServer.create(InetSocketAddress("127.0.0.1",0),0)
        server.createContext("/") { exchange ->
            try {
                val expected=requireNotNull(replies.poll()) { "Unexpected request: ${exchange.requestURI}" }
                assertEquals(expected.path,exchange.requestURI.toString());assertEquals(expected.method,exchange.requestMethod)
                assertEquals(config.anonKey,exchange.requestHeaders.getFirst("apikey"))
                val body=exchange.requestBody.bufferedReader().use { it.readText() }
                expected.body(if(body.isEmpty()) JSONObject() else JSONObject(body))
                val bytes=expected.json.toString().toByteArray(Charsets.UTF_8)
                exchange.responseHeaders.add("Content-Type","application/json")
                exchange.sendResponseHeaders(expected.status,if(expected.status==204) -1 else bytes.size.toLong())
                if(expected.status!=204) exchange.responseBody.write(bytes)
            } catch(error: Throwable) {
                failures.add(error)
                runCatching { exchange.sendResponseHeaders(500,-1) }
            } finally { exchange.close() }
        }
        server.start()
        val context=ApplicationProvider.getApplicationContext<Context>()
        val key=KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        store=SessionStore(context,config.url+java.util.UUID.randomUUID()) { key }
        api=AgroApi(config,store) { uri -> URI("http://127.0.0.1:${server.address.port}${uri.rawPath}${uri.rawQuery?.let { "?$it" }.orEmpty()}").toURL().openConnection() as HttpURLConnection }
    }
    @After fun stop() {
        server.stop(0);store.clear()
        failures.poll()?.let { throw AssertionError("Contract request failed",it) }
        assertTrue("Expected requests left: ${replies.map { it.path }}",replies.isEmpty())
    }
    @Test fun loginRenameTelemetryAndLogoutUseNativeHttpContracts() = runBlocking {
        reply("/auth/v1/token?grant_type=password",token()) { assertEquals("grower@example.test",it.getString("email")) }
        reply("/auth/v1/user",user(),"GET")
        assertTrue(api.login("grower@example.test","test-password"))
        assertEquals("Petani",store.read()!!.displayName)
        reply("/auth/v1/user",user(name="Petani Teras"),"PUT") { assertEquals("Petani Teras",it.getJSONObject("data").getString("display_name")) }
        assertEquals("Petani Teras",api.updateName("  Petani   Teras  "))
        assertEquals("Petani Teras",store.read()!!.displayName)
        reply("/rest/v1/rpc/unit_measurements",JSONObject().put("readings",JSONArray())) { assertEquals(unitId,it.getString("p_unit_id")) }
        assertTrue(parseHistory(api.rpc("unit_measurements",JSONObject().put("p_unit_id",unitId))).isEmpty())
        reply("/rest/v1/rpc/cancel_my_redemption",JSONObject().put("ok",true).put("redemption_id",unitId).put("status","cancelled")) { assertEquals(unitId,it.getString("p_id")) }
        api.cancelReward(unitId)
        reply("/auth/v1/logout?scope=local",status=204)
        api.logout();assertNull(api.session);assertNull(store.read())
    }
    @Test fun placementWarnsWithoutFreshEvidenceAndMovesOrArchivesWithoutOperator() = runBlocking {
        reply("/auth/v1/token?grant_type=password", token())
        reply("/auth/v1/user", user(), "GET")
        assertTrue(api.login("grower@example.test", "test-password"))
        val deviceId = "00000000-0000-4000-8000-000000000004"
        val productId = "00000000-0000-4000-8000-000000000005"
        val otherUnit = "00000000-0000-4000-8000-000000000006"
        val sampleAt = Instant.now().minusSeconds(30).truncatedTo(java.time.temporal.ChronoUnit.MICROS).toString()

        fun history(unit: String = unitId, reportedDevice: String = deviceId, clock: String = "synced") {
            val row = JSONObject().put("id", factor).put("unit_id", unit).put("device_id", reportedDevice)
                .put("packet_id", challenge).put("boot_id", challenge).put("sequence", 1)
                .put("source", "device").put("sensor_id", "moisture").put("quality_status", "ok")
                .put("value_nullable", 42).put("error_message", JSONObject.NULL)
                .put("measured_at", sampleAt).put("received_at", sampleAt).put("clock_status", clock)
            val page = JSONObject().put("ok", true).put("unit_id", unit).put("snapshot_as_of", sampleAt)
                .put("readings", JSONArray().put(row)).put("next_cursor", JSONObject.NULL)
            reply("/rest/v1/rpc/read_my_measurement_history", page) { body ->
                assertEquals(unit, body.getString("p_unit_id"))
                page.put("from", body.getString("p_from")).put("to", body.getString("p_to"))
            }
        }
        fun workspace(assigned: String?) {
            fun unit(id: String, label: String) = JSONObject().put("unit_id", id).put("product_id", productId)
                .put("location_label", label).put("species_variety", "Cabai").put("archived_at", JSONObject.NULL)
            val device = JSONObject().put("device_id", deviceId).put("product_id", productId)
                .put("status", "active").put("unit_id", assigned ?: JSONObject.NULL)
            reply("/rest/v1/rpc/my_units", JSONObject().put("ok", true)
                .put("units", JSONArray().put(unit(unitId, "Teras")).put(unit(otherUnit, "Kebun"))).put("devices", JSONArray().put(device)))
        }
        fun expectPlacement() = reply("/rest/v1/rpc/place_my_device", JSONObject().put("ok", true)) {
            assertEquals(deviceId, it.getString("p_device_id"))
            assertEquals(unitId, it.getString("p_unit_id"))
        }

        // Unplaced: every unit of the product is searched. Another device or an unsynced clock is no evidence, which is a
        // warning (false), not a refusal: the placement is still saved.
        workspace(assigned = null); history(reportedDevice = factor); history(unit = otherUnit, reportedDevice = factor); expectPlacement()
        assertFalse(api.placeDevice(deviceId, unitId))
        workspace(assigned = null); history(clock = "unsynced"); history(unit = otherUnit, clock = "unsynced"); expectPlacement()
        assertFalse(api.placeDevice(deviceId, unitId))
        // Already there: nothing to read or write.
        workspace(assigned = unitId)
        assertTrue(api.placeDevice(deviceId, unitId))
        // Moving: the evidence is in the current unit, searched first, and no reflash or operator is needed.
        workspace(assigned = otherUnit); history(unit = otherUnit); expectPlacement()
        assertTrue(api.placeDevice(deviceId, unitId))
        // First placement with the packets still under the flashed unit.
        workspace(assigned = null); history(reportedDevice = factor); history(unit = otherUnit); expectPlacement()
        assertTrue(api.placeDevice(deviceId, unitId))
        // Archiving releases the device on the server.
        reply("/rest/v1/rpc/archive_my_unit", JSONObject().put("ok", true).put("changed", true)) { assertEquals(unitId, it.getString("p_unit_id")) }
        api.archiveUnit(unitId)
        assertTrue(replies.isEmpty())
    }
    @Test fun serverWeatherUsesAuthenticatedEdgeAndPreservesSessionOnOutage() = runBlocking {
        reply("/auth/v1/token?grant_type=password",token());reply("/auth/v1/user",user(),"GET")
        assertTrue(api.login("grower@example.test","test-password"))
        val weather=JSONObject().put("at","2026-11-16T14:00").put("condition","hujan").put("tempC",24)
            .put("humidity",90).put("cloud",100).put("windMs",5).put("rainMm",4).put("forecast",JSONArray())
        reply("/functions/v1/weather-forecast",JSONObject().put("ok",true).put("weather",weather)) {
            assertEquals(-6.91,it.getDouble("lat"),0.0);assertEquals(107.61,it.getDouble("lon"),0.0)
        }
        assertEquals("hujan",api.weather(-6.91,107.61).condition)
        reply("/functions/v1/weather-forecast",JSONObject().put("ok",false).put("code","weather_unavailable"),status=503)
        try { api.weather(-6.91,107.61);fail("Expected temporary outage") } catch(error: ApiFailure) { assertFalse(error.expired) }
        assertNotNull(api.session);assertNotNull(store.read())
        try { api.weather(Double.NaN,0.0);fail("Invalid location accepted") } catch(_: IllegalArgumentException) { }
    }
    @Test fun explanationRetryUsesSameRequestAndRejectsMismatchedEvidence() = runBlocking {
        reply("/auth/v1/token?grant_type=password",token());reply("/auth/v1/user",user(),"GET")
        assertTrue(api.login("grower@example.test","test-password"))
        val request="00000000-0000-4000-8000-000000000009"
        repeat(2) {
            reply("/functions/v1/unit-explanation",JSONObject().put("ok",false).put("code","service_unavailable"),status=503) {
                assertEquals(request,it.getString("request_id"));assertEquals(unitId,it.getString("unit_id"))
                assertEquals(factor,it.getString("device_id"));assertEquals("Media tampak kering",it.getString("question"))
            }
            try { api.explain(unitId,factor,request,"Media tampak kering");fail("Expected outage") } catch(error: ApiFailure) { assertFalse(error.expired) }
        }
        val evidence=JSONObject().put("ok",true).put("unit_id",unitId).put("device_id",challenge).put("ownership_id",unitId)
            .put("profile_version_id",unitId).put("evaluated_at","2026-11-16T07:00:00Z").put("question","")
            .put("device_status","active").put("registry_status","active").put("packets",JSONArray())
        val decision=JSONObject().put("decision","DATA_BELUM_ADA").put("action","Tunggu bacaan perangkat").put("reason","Belum ada paket")
            .put("explanation","Penjelasan aturan.").put("mascot_state","bingung_menunggu").put("rule_version","agronomy-v1.telemetry-v1")
            .put("source_mode","rule_fallback").put("ai_status","not_configured")
        val snapshot=JSONObject().put("id",unitId).put("created_at","2026-11-16T07:00:01Z").put("profile_version_id",unitId)
            .put("context_sha256","a".repeat(64)).put("evidence_ref",evidence).put("decision_payload",decision)
        reply("/functions/v1/unit-explanation",JSONObject().put("ok",true).put("snapshot",snapshot))
        try { api.explain(unitId,factor,request,"");fail("Other device evidence accepted") } catch(_: IllegalArgumentException) { }
    }
    @Test fun secondFactorIsNotPersistedBeforeVerification() = runBlocking {
        reply("/auth/v1/token?grant_type=password",token(mfa=true))
        reply("/auth/v1/user",user(true),"GET")
        assertFalse(api.login("grower@example.test","test-password"));assertNull(api.session);assertNull(store.read())
        reply("/auth/v1/factors/$factor/challenge",JSONObject().put("id",challenge))
        reply("/auth/v1/factors/$factor/verify",token("verified-contract")) { assertEquals("123456",it.getString("code"));assertEquals(challenge,it.getString("challenge_id")) }
        api.verifyMfa("123456");assertEquals("verified-contract",store.read()!!.accessToken)
    }
    @Test fun expiredOrDifferentAccountLoginCannotBePersisted() = runBlocking {
        reply("/auth/v1/token?grant_type=password",token(expiry=Instant.now().epochSecond-1))
        try { api.login("grower@example.test","test-password");fail("Expired login accepted") } catch(_: IllegalArgumentException) { }
        assertNull(api.session);assertNull(store.read())
        val different=token().put("user",user().put("email","other@example.test"))
        reply("/auth/v1/token?grant_type=password",different);reply("/auth/v1/user",user(),"GET")
        try { api.login("grower@example.test","test-password");fail("Mismatched account accepted") } catch(_: IllegalArgumentException) { }
        assertNull(api.session);assertNull(store.read())
    }
    @Test fun mfaCancellationOrDifferentAccountCannotPublishSession() = runBlocking {
        reply("/auth/v1/token?grant_type=password",token(mfa=true));reply("/auth/v1/user",user(true),"GET")
        assertFalse(api.login("grower@example.test","test-password"))
        reply("/auth/v1/factors/$factor/challenge",JSONObject().put("id",challenge))
        reply("/auth/v1/factors/$factor/verify",token()) { api.cancelMfa() }
        try { api.verifyMfa("123456");fail("Cancelled MFA restored a session") } catch(_: IllegalStateException) { }
        assertNull(api.session);assertNull(store.read())
        reply("/auth/v1/token?grant_type=password",token(mfa=true));reply("/auth/v1/user",user(true),"GET")
        assertFalse(api.login("grower@example.test","test-password"))
        reply("/auth/v1/factors/$factor/challenge",JSONObject().put("id",challenge))
        reply("/auth/v1/factors/$factor/verify",token().put("user",user().put("email","other@example.test")))
        try { api.verifyMfa("123456");fail("MFA changed account") } catch(_: IllegalArgumentException) { }
        assertNull(api.session);assertNull(store.read())
    }
    @Test fun explanationIdentitySurvivesStoreRecreationWithoutPersistingQuestion() {
        val scope=config.url+java.util.UUID.randomUUID()
        val context=ApplicationProvider.getApplicationContext<Context>()
        val key=KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val first=SessionStore(context,scope) { key }
        val question="Pengamatan pribadi yang tidak disimpan"
        val request=first.explanationRequest("grower@example.test",unitId,factor,question)
        val recreated=SessionStore(context,scope) { key }
        assertEquals(request,recreated.explanationRequest("grower@example.test",unitId,factor,question))
        assertNotEquals(request,recreated.explanationRequest("other@example.test",unitId,factor,question))
        assertNotEquals(request,recreated.explanationRequest("grower@example.test",unitId,challenge,question))
        assertNotEquals(request,recreated.explanationRequest("grower@example.test",unitId,factor,"Pertanyaan baru"))
        val identityFiles=context.noBackupFilesDir.listFiles().orEmpty().filter { it.name.startsWith("explanation-") }
        assertTrue(identityFiles.isNotEmpty())
        assertTrue(identityFiles.none { it.readText().contains(question) || it.name.contains(question) })
        recreated.finishExplanationRequest("grower@example.test",unitId,factor,question)
        assertNotEquals(request,recreated.explanationRequest("grower@example.test",unitId,factor,question))
    }
    @Test fun rewardRetrySurvivesNetworkFailureAndStepUpKeepsRequestIdentity() = runBlocking {
        store.save(Session("access-contract","refresh-contract",Instant.now().epochSecond+3600,"grower@example.test","Petani"))
        reply("/auth/v1/user",user(),"GET");assertTrue(api.restore())
        var identity=""
        reply("/rest/v1/rpc/reserve_my_reward",JSONObject().put("code","busy"),status=503) { identity=it.getString("p_request_id") }
        try { api.reserveReward(unitId,"");fail("Expected server failure") } catch (_: ApiFailure) { }
        assertEquals(identity,store.rewardRequest("grower@example.test",unitId))
        reply("/rest/v1/rpc/reserve_my_reward",JSONObject().put("ok",true).put("redemption_id",unitId))
        try { api.reserveReward(unitId,"");fail("Do not acknowledge malformed receipts") } catch (_: IllegalArgumentException) { }
        assertEquals(identity,store.rewardRequest("grower@example.test",unitId))
        reply("/rest/v1/rpc/reserve_my_reward",JSONObject().put("ok",false).put("code","step_up_required")) { assertEquals(identity,it.getString("p_request_id")) }
        reply("/auth/v1/user",user(true),"GET")
        reply("/auth/v1/factors/$factor/challenge",JSONObject().put("id",challenge))
        reply("/auth/v1/factors/$factor/verify",token("step-up-contract"))
        reply("/rest/v1/rpc/reserve_my_reward",JSONObject().put("ok",true).put("redemption_id",unitId).put("status","reserved").put("reserved_points",80)) { assertEquals(identity,it.getString("p_request_id"));assertEquals(unitId,it.getString("p_item_id")) }
        assertEquals("reserved",api.reserveReward(unitId,"123456"))
        assertNotEquals(identity,store.rewardRequest("grower@example.test",unitId))
        store.finishRewardRequest("grower@example.test",unitId)
    }
    @Test fun offlineRefreshPreservesEncryptedSessionAndExplicitRejectionExpiresIt() = runBlocking {
        store.save(Session("old-contract","refresh-contract",Instant.now().epochSecond-1,"grower@example.test"))
        reply("/auth/v1/token?grant_type=refresh_token",status=503)
        try { api.restore();fail("Expected temporary failure") } catch(error: ApiFailure) { assertFalse(error.expired) }
        assertNotNull(store.read())
        // Rate limiting is temporary too: the session stays.
        reply("/auth/v1/token?grant_type=refresh_token",JSONObject().put("code",429).put("msg","Too many requests"),status=429)
        try { api.restore();fail("Expected temporary failure") } catch(error: ApiFailure) { assertFalse(error.expired) }
        assertNotNull(store.read())
        // What hosted Auth really answers for a rejected refresh token (checked 2026-11-16): 400, no "refresh_token" text.
        reply("/auth/v1/token?grant_type=refresh_token",JSONObject().put("code",400).put("error_code","validation_failed").put("msg","Refresh token is not valid"),status=400)
        try { api.rpc("my_products");fail("Expected expired session") } catch(error: ApiFailure) { assertTrue(error.expired);assertEquals("Sesi berakhir. Silakan masuk kembali.",error.message) }
    }
    @Test fun backgroundWorkerAndAppShareARotatedRefreshTokenInsteadOfReplayingIt() = runBlocking {
        // Auth rotates the refresh token on every use and may end the whole session when an old one comes back.
        store.save(Session("old-access","refresh-1",Instant.now().epochSecond-1,"grower@example.test"))
        val worker=AgroApi(config,store) { uri -> URI("http://127.0.0.1:${server.address.port}${uri.rawPath}${uri.rawQuery?.let { "?$it" }.orEmpty()}").toURL().openConnection() as HttpURLConnection }
        assertTrue(api.resume());assertTrue(worker.resume())
        reply("/auth/v1/token?grant_type=refresh_token",token("access-2").put("refresh_token","refresh-2")) { assertEquals("refresh-1",it.getString("refresh_token")) }
        reply("/rest/v1/rpc/my_overview",JSONObject().put("ok",true).put("plants",JSONArray()))
        worker.rpc("my_overview")
        // The app still holds refresh-1 in memory. It must take refresh-2 from the store, not send refresh-1 again.
        reply("/rest/v1/rpc/my_products",JSONObject().put("ok",true))
        api.rpc("my_products")
        assertEquals("access-2",api.session?.accessToken)
        assertEquals("refresh-2",store.read()?.refreshToken)
    }
    @Test fun refreshAndLoginResponsesCannotUndoLogoutOrCancelledLogin() = runBlocking {
        store.save(Session("old-contract","refresh-contract",Instant.now().epochSecond-1,"grower@example.test"))
        reply("/auth/v1/token?grant_type=refresh_token",token("late-refresh")) { runBlocking { api.clear() } }
        try { api.restore();fail("Late refresh restored a logged-out session") } catch(_: IllegalStateException) { }
        assertNull(api.session);assertNull(store.read())
        reply("/auth/v1/token?grant_type=password",token())
        reply("/auth/v1/user",user(),"GET") { api.cancelMfa() }
        try { api.login("grower@example.test","test-password");fail("Cancelled login published a session") } catch(_: IllegalStateException) { }
        assertNull(api.session);assertNull(store.read())
    }
    @Test fun refreshRejectsDifferentAccountAndStaleDiskWriteIsCleared() = runBlocking {
        store.save(Session("old-contract","refresh-contract",Instant.now().epochSecond-1,"grower@example.test"))
        reply("/auth/v1/token?grant_type=refresh_token",token().put("user",user().put("email","other@example.test")))
        try { api.restore();fail("Refresh changed account") } catch(_: IllegalArgumentException) { }
        assertEquals("grower@example.test",store.read()!!.email)
        api.clear()
        val version=api.authenticationVersion()
        api.clear()
        try { api.save(Session.parse(token()),version);fail("Stale operation wrote credentials") } catch(_: IllegalStateException) { }
        assertNull(api.session);assertNull(store.read())
    }
    @Test fun logoutSerializesWithCredentialPersistence() = runBlocking {
        val entered=java.util.concurrent.CountDownLatch(1)
        val release=java.util.concurrent.CountDownLatch(1)
        val context=ApplicationProvider.getApplicationContext<Context>()
        val key=KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val slowStore=SessionStore(context,config.url+java.util.UUID.randomUUID()) {
            entered.countDown()
            check(release.await(5,java.util.concurrent.TimeUnit.SECONDS))
            key
        }
        val isolated=AgroApi(config,slowStore)
        val executor=java.util.concurrent.Executors.newFixedThreadPool(2)
        try {
            val saving=executor.submit { runBlocking { isolated.save(Session.parse(token())) } }
            assertTrue(entered.await(5,java.util.concurrent.TimeUnit.SECONDS))
            val clearing=executor.submit { runBlocking { isolated.clear() } }
            release.countDown()
            saving.get(5,java.util.concurrent.TimeUnit.SECONDS)
            clearing.get(5,java.util.concurrent.TimeUnit.SECONDS)
            assertNull(isolated.session);assertNull(slowStore.read())
        } finally { release.countDown();executor.shutdownNow();slowStore.clear() }
    }
    @Test fun googleIdTokenUsesNonceAndRequiresMfaBeforePersistence() = runBlocking {
        val nonce="n".repeat(43)
        reply("/auth/v1/token?grant_type=id_token",token(mfa=true)) {
            assertEquals("google",it.getString("provider"));assertEquals("google-signed-token",it.getString("id_token"));assertEquals(nonce,it.getString("nonce"))
        }
        reply("/auth/v1/user",user(true),"GET")
        assertFalse(api.loginIdToken("google-signed-token",nonce));assertNull(store.read())
        reply("/auth/v1/factors/$factor/challenge",JSONObject().put("id",challenge))
        reply("/auth/v1/factors/$factor/verify",token("google-aal2"))
        api.verifyMfa("123456");assertEquals("google-aal2",store.read()!!.accessToken)
    }
    @Test fun googleRejectionDoesNotCreateSession() = runBlocking {
        reply("/auth/v1/token?grant_type=id_token",JSONObject().put("error_code","bad_jwt"),status=400)
        try { api.loginIdToken("rejected-google-token","n".repeat(43));fail("Rejected token") } catch(_: ApiFailure) { }
        assertNull(api.session);assertNull(store.read())
    }
    @Test fun damagedRewardIdentityRecoversTheSameIdAndNeverSilentlyCreatesAnother() {
        val email="grower@example.test";val item=java.util.UUID.randomUUID().toString()
        val id=store.rewardRequest(email,item)
        val context=ApplicationProvider.getApplicationContext<Context>()
        val hash=java.security.MessageDigest.getInstance("SHA-256").digest("$email:$item".toByteArray()).joinToString("") { "%02x".format(it) }
        val file=context.noBackupFilesDir.listFiles()!!.single { it.name.endsWith("-$hash.id") }
        file.writeText("broken")
        assertEquals(id,store.rewardRequest(email,item))
        file.writeText("broken");java.io.File(file.path+".copy").writeText("broken too")
        try { store.rewardRequest(email,item);fail("Never retry an ambiguous reservation with a new identity") }
        catch(error: ApiFailure) { assertEquals("request_identity_corrupt",error.code) }
        assertEquals("broken",file.readText())
        store.archiveRewardRequest(email,item)
        assertTrue(context.noBackupFilesDir.listFiles()!!.any { it.name.startsWith(file.name+".damaged-") })
        assertNotEquals(id,store.rewardRequest(email,item))
        store.finishRewardRequest(email,item)
    }
    @Test fun historyPaginationAndGardenUseTheExistingServerContracts() = runBlocking {
        reply("/auth/v1/token?grant_type=password",token());reply("/auth/v1/user",user(),"GET")
        assertTrue(api.login("grower@example.test","test-password"))
        reply("/rest/v1/rpc/my_garden",JSONObject().put("ok",true).put("sites",JSONArray()).put("slots",JSONArray()).put("cycles",JSONArray()))
        assertTrue(parseGarden(api.rpc("my_garden")).sites.isEmpty())
        reply("/rest/v1/rpc/unit_measurements",JSONObject().put("readings",JSONArray())) {
            assertEquals(unitId,it.getString("p_unit_id"));assertEquals("2026-11-15T00:00:00Z",it.getString("p_before"))
        }
        assertTrue(parseHistory(api.rpc("unit_measurements",JSONObject().put("p_unit_id",unitId).put("p_before","2026-11-15T00:00:00Z"))).isEmpty())
    }

}

/** Windows File.renameTo does not replace an existing target; Android's rename does.
 * Match that OS primitive in the test host, while running the real AtomicFile write protocol. */
@org.robolectric.annotation.Implements(android.util.AtomicFile::class)
class WindowsAtomicFileShadow {
    companion object {
        @JvmStatic
        @org.robolectric.annotation.Implementation
        fun rename(source: java.io.File, target: java.io.File) {
            java.nio.file.Files.move(source.toPath(),target.toPath(),java.nio.file.StandardCopyOption.REPLACE_EXISTING)
        }
    }
}
