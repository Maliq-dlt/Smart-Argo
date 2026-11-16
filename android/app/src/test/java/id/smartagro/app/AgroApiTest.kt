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
    @Test fun secondFactorIsNotPersistedBeforeVerification() = runBlocking {
        reply("/auth/v1/token?grant_type=password",token(mfa=true))
        reply("/auth/v1/user",user(true),"GET")
        assertFalse(api.login("grower@example.test","test-password"));assertNull(api.session);assertNull(store.read())
        reply("/auth/v1/factors/$factor/challenge",JSONObject().put("id",challenge))
        reply("/auth/v1/factors/$factor/verify",token("verified-contract")) { assertEquals("123456",it.getString("code"));assertEquals(challenge,it.getString("challenge_id")) }
        api.verifyMfa("123456");assertEquals("verified-contract",store.read()!!.accessToken)
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
