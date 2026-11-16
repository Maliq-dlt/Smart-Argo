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
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.URI
import java.time.Instant
import java.util.concurrent.ConcurrentLinkedQueue
import javax.crypto.KeyGenerator

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],shadows=[WindowsAtomicFileShadow::class])
class AccountWorkflowsTest {
    private data class Reply(val path: String,val method: String,val status: Int,val json: JSONObject,val check: (JSONObject,String?)->Unit)
    private val replies=ConcurrentLinkedQueue<Reply>()
    private val failures=ConcurrentLinkedQueue<Throwable>()
    private lateinit var server: HttpServer
    private lateinit var api: AgroApi
    private lateinit var store: SessionStore
    private lateinit var account: AccountWorkflows
    private val factor="00000000-0000-4000-8000-000000000002"
    private val challenge="00000000-0000-4000-8000-000000000003"
    private fun user(mfa: Boolean=false)=JSONObject().put("email","grower@example.test").put("factors",JSONArray().apply {
        if(mfa) put(JSONObject().put("id",factor).put("factor_type","totp").put("status","verified"))
    })
    private fun token(access: String="account-access",mfa: Boolean=false)=JSONObject().put("access_token",access).put("refresh_token","account-refresh")
        .put("expires_at",Instant.now().epochSecond+3600).put("user",user(mfa))
    private fun reply(path: String,json: JSONObject=JSONObject(),method: String="POST",status: Int=200,check: (JSONObject,String?)->Unit={_,_->}) {
        replies.add(Reply(path,method,status,json,check))
    }
    @Before fun start() {
        val config=BackendConfig("https://account-contract.invalid","sb_publishable_contract_test")
        server=HttpServer.create(InetSocketAddress("127.0.0.1",0),0)
        server.createContext("/") { exchange ->
            try {
                val expected=requireNotNull(replies.poll()) { "Unexpected request ${exchange.requestURI}" }
                assertEquals(expected.path,exchange.requestURI.toString());assertEquals(expected.method,exchange.requestMethod)
                val text=exchange.requestBody.bufferedReader().use { it.readText() }
                expected.check(if(text.isEmpty()) JSONObject() else JSONObject(text),exchange.requestHeaders.getFirst("Authorization"))
                val bytes=expected.json.toString().toByteArray(Charsets.UTF_8)
                exchange.responseHeaders.add("Content-Type","application/json")
                exchange.sendResponseHeaders(expected.status,if(expected.status==204) -1 else bytes.size.toLong())
                if(expected.status!=204) exchange.responseBody.write(bytes)
            } catch(error: Throwable) { failures.add(error);runCatching { exchange.sendResponseHeaders(500,-1) } }
            finally { exchange.close() }
        }
        server.start()
        val context=ApplicationProvider.getApplicationContext<Context>()
        val key=KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        store=SessionStore(context,config.url+java.util.UUID.randomUUID()) { key }
        api=AgroApi(config,store) { uri->URI("http://127.0.0.1:${server.address.port}${uri.rawPath}${uri.rawQuery?.let { "?$it" }.orEmpty()}").toURL().openConnection() as HttpURLConnection }
        account=AccountWorkflows(api)
    }
    @After fun stop() { server.stop(0);store.clear();failures.poll()?.let { throw AssertionError("HTTP contract failed",it) };assertTrue("Pending requests ${replies.map { it.path }}",replies.isEmpty()) }
    private suspend fun login(mfa: Boolean=false) {
        reply("/auth/v1/token?grant_type=password",token(mfa=mfa));reply("/auth/v1/user",user(mfa),"GET")
        assertEquals(!mfa,api.login("grower@example.test","existing-password"))
    }
    @Test fun signupResendAndEmailCodeKeepMfaPendingOutOfStorage() = runBlocking {
        reply("/auth/v1/signup",JSONObject().put("id",factor).put("identities",JSONArray().put(JSONObject()))) { body,auth->
            assertNull(auth);assertEquals("grower@example.test",body.getString("email"));assertEquals("s256",body.getString("code_challenge_method"))
            assertTrue(Regex("[A-Za-z0-9_-]{43}").matches(body.getString("code_challenge")));assertEquals("Petani",body.getJSONObject("data").getString("display_name"))
        }
        assertEquals(SignupResult.ConfirmEmail,account.signup(" grower@example.test ","a-long-password","Petani"))
        reply("/auth/v1/resend") { body,_->assertEquals("signup",body.getString("type")) };account.resendSignupCode("grower@example.test")
        reply("/auth/v1/verify",token(mfa=true)) { body,_->assertEquals("signup",body.getString("type"));assertEquals("123456",body.getString("token")) }
        reply("/auth/v1/user",user(true),"GET")
        assertFalse(account.verifySignupCode("grower@example.test","123456"));assertNull(api.session);assertNull(store.read());assertNotNull(api.pendingSession)
    }
    @Test fun resetPkceNeverPublishesRecoverySessionAndRetriesPasswordWrite() = runBlocking {
        reply("/auth/v1/recover?redirect_to=https%3A%2F%2Fexample.test%2Freset") { body,_->assertEquals("s256",body.getString("code_challenge_method")) }
        account.requestPasswordReset("grower@example.test","https://example.test/reset")
        reply("/auth/v1/token?grant_type=pkce",token("recovery-only")) { body,_->assertEquals("returned-code",body.getString("auth_code"));assertEquals(43,body.getString("code_verifier").length) }
        account.beginPasswordReset("returned-code");assertTrue(account.resetting);assertNull(api.session);assertNull(store.read())
        reply("/auth/v1/user",method="PUT",status=503) { _,auth->assertEquals("Bearer recovery-only",auth) }
        try { account.setRecoveredPassword("new-password-123");fail("Expected outage") } catch (_: ApiFailure) { }
        assertTrue(account.resetting);assertNull(store.read())
        reply("/auth/v1/user",user(),"PUT") { body,auth->assertEquals("new-password-123",body.getString("password"));assertEquals("Bearer recovery-only",auth) }
        reply("/auth/v1/logout?scope=local",status=204)
        assertEquals(PasswordResetResult.PasswordChanged,account.setRecoveredPassword("new-password-123"));assertFalse(account.resetting);assertNull(api.session);assertNull(store.read())
    }
    @Test fun passwordChangedRemainsSuccessfulWhenRecoveryLogoutIsUnconfirmed() = runBlocking {
        reply("/auth/v1/recover?redirect_to=https%3A%2F%2Fexample.test%2Freset")
        account.requestPasswordReset("grower@example.test","https://example.test/reset")
        reply("/auth/v1/token?grant_type=pkce",token("recovery-only"))
        account.beginPasswordReset("returned-code")
        reply("/auth/v1/user",user(),"PUT") { body,auth->
            assertEquals("new-password-123",body.getString("password"));assertEquals("Bearer recovery-only",auth)
        }
        reply("/auth/v1/logout?scope=local",status=503)
        assertEquals(PasswordResetResult.PasswordChangedLogoutUnconfirmed,account.setRecoveredPassword("new-password-123"))
        assertFalse(account.resetting);assertNull(api.session);assertNull(store.read())
        try { account.setRecoveredPassword("new-password-123");fail("Recovery must be cleared") } catch (_: ApiFailure) { }
        try { account.beginPasswordReset("returned-code");fail("Verifier must be cleared") } catch (_: ApiFailure) { }
    }
    @Test fun enrollmentAndVerificationRejectCrossAccountResponse() = runBlocking {
        login()
        reply("/auth/v1/user",user(),"GET")
        reply("/auth/v1/factors",JSONObject().put("id",factor).put("totp",JSONObject().put("secret","ABCDEFGHIJKLMNOP").put("uri","otpauth://totp/SmartAgro?secret=ABCDEFGHIJKLMNOP")))
        val enrollment=account.enrollMfa();assertEquals(factor,enrollment.id)
        val unverified=user().put("factors",JSONArray().put(JSONObject().put("id",factor).put("factor_type","totp").put("status","unverified")))
        reply("/auth/v1/user",unverified,"GET")
        reply("/auth/v1/factors/$factor/challenge",JSONObject().put("id",challenge))
        reply("/auth/v1/factors/$factor/verify",token("wrong-account").put("user",user().put("email","other@example.test")))
        try { account.confirmMfa(factor,"123456");fail("Must reject wrong account") } catch (_: IllegalArgumentException) { }
        assertEquals("account-access",store.read()!!.accessToken)
    }
    @Test fun recoveryChecksFactorsAgainBeforeStoringRefreshedLogin() = runBlocking {
        login(true);assertNull(store.read())
        reply("/functions/v1/mfa-recovery",JSONObject().put("ok",true).put("removed",1)) { body,auth->assertEquals("ABCD-1234-5678",body.getString("code"));assertEquals("Bearer account-access",auth) }
        reply("/auth/v1/token?grant_type=refresh_token",token("recovered",mfa=true));reply("/auth/v1/user",user(true),"GET")
        assertFalse(account.recoverMfa("abcd-1234-5678"));assertNull(store.read());assertNull(api.session)
    }
    @Test fun malformedCodesAreRejectedWithoutNetworkAndUnknownSecurityKindsRemainReadable() = runBlocking {
        try { account.verifySignupCode("grower@example.test","12");fail("Invalid OTP") } catch (_: IllegalArgumentException) { }
        try { account.recoverMfa("1234");fail("Invalid recovery code") } catch (_: IllegalArgumentException) { }
        val json=JSONObject().put("mfa_enabled",false).put("hold_until",JSONObject.NULL).put("events",JSONArray().put(JSONObject().put("kind","future_event").put("detail",JSONObject.NULL).put("created_at","2026-11-16T01:00:00+00:00")))
        assertEquals("future_event",parseAccountSecurity(json).events.single().kind)
        assertNull(store.read())
    }
    @Test fun oneTimeRecoveryCodesRequireMfaAndSecurityStatusUsesOwnerRpc() = runBlocking {
        login(true)
        reply("/auth/v1/factors/$factor/challenge",JSONObject().put("id",challenge))
        reply("/auth/v1/factors/$factor/verify",token("verified"))
        val codes=JSONArray().apply { repeat(10) { put("ABCD-1234-"+it.toString(16).uppercase().padStart(4,'0')) } }
        reply("/rest/v1/rpc/create_my_recovery_codes",JSONObject().put("ok",true).put("codes",codes)) { _,auth->assertEquals("Bearer verified",auth) }
        assertEquals(10,account.createRecoveryCodes("123456").size)
        reply("/rest/v1/rpc/my_recovery_codes_status",JSONObject().put("total",10).put("remaining",9).put("created_at","2026-11-16T01:00:00Z"))
        assertEquals(9,account.recoveryCodeStatus().remaining)
        reply("/rest/v1/rpc/security_workspace",JSONObject().put("mfa_enabled",true).put("hold_until",JSONObject.NULL).put("events",JSONArray()))
        assertTrue(account.security().mfaEnabled)
        reply("/auth/v1/logout?scope=others",status=204) { _,auth->assertEquals("Bearer verified",auth) }
        account.signOutOthers()
    }

    @Test fun resetRejectsExpiredOrDifferentAccountAndNeverStoresEither() = runBlocking {
        reply("/auth/v1/recover?redirect_to=https%3A%2F%2Fexample.test%2Freset")
        account.requestPasswordReset("grower@example.test","https://example.test/reset")
        reply("/auth/v1/token?grant_type=pkce",token().put("expires_at",Instant.now().epochSecond-1))
        try { account.beginPasswordReset("expired");fail("Expired recovery") } catch (_: IllegalArgumentException) { }
        assertNull(api.session);assertNull(store.read())
        reply("/auth/v1/token?grant_type=pkce",token().put("user",user().put("email","other@example.test")))
        try { account.beginPasswordReset("wrong-user");fail("Wrong recovery account") } catch (_: IllegalArgumentException) { }
        account.cancelPasswordReset();assertFalse(account.resetting);assertNull(store.read())
    }

    @Test fun failedResetDeliveryKeepsSameVerifierForSafeRetry() = runBlocking {
        var challenge=""
        reply("/auth/v1/recover?redirect_to=https%3A%2F%2Fexample.test%2Freset",status=503) { body,_->challenge=body.getString("code_challenge") }
        try { account.requestPasswordReset("grower@example.test","https://example.test/reset");fail("Delivery response failed") } catch (_: ApiFailure) { }
        assertTrue(account.resetting)
        reply("/auth/v1/recover?redirect_to=https%3A%2F%2Fexample.test%2Freset") { body,_->assertEquals(challenge,body.getString("code_challenge")) }
        account.requestPasswordReset("grower@example.test","https://example.test/reset")
        account.cancelPasswordReset();assertFalse(account.resetting);assertNull(store.read())
    }

    @Test fun mfaRecoveryRejectsDifferentAccountRefreshWithoutVerifyingOrSavingIt() = runBlocking {
        login(true)
        reply("/functions/v1/mfa-recovery",JSONObject().put("ok",true).put("removed",1))
        reply("/auth/v1/token?grant_type=refresh_token",token("wrong-account").put("user",user().put("email","other@example.test")))
        try { account.recoverMfa("ABCD-1234-5678");fail("Wrong account recovery") } catch (_: IllegalArgumentException) { }
        assertNull(api.session);assertNull(store.read());assertEquals("grower@example.test",api.pendingSession!!.email)
    }

}
