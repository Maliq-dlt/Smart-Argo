package id.smartagro.app

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.security.MessageDigest
import java.security.SecureRandom
import java.time.Instant
import java.util.Base64

class TotpEnrollment(val id: String, val secret: String, val uri: String)
data class SecurityEvent(val kind: String, val detail: String?, val createdAt: Instant)
data class AccountSecurity(val mfaEnabled: Boolean, val holdUntil: Instant?, val events: List<SecurityEvent>)
data class RecoveryCodeStatus(val total: Int, val remaining: Int, val createdAt: Instant?)
enum class SignupResult { ConfirmEmail, SignedIn, MfaRequired }
enum class PasswordResetResult { PasswordChanged, PasswordChangedLogoutUnconfirmed }

/** Account contracts only. Claude's screens must collect codes, protect enrollment/recovery-code screens and route
 * allowlisted PKCE return URLs. Recovery credentials stay here in memory and never become an AgroApi account session. */
class AccountWorkflows(private val api: AgroApi) {
    private val lock = Mutex()
    private var signupVerifier: String? = null
    private var resetEmail: String? = null
    private var recovery: Session? = null
    val resetting: Boolean get() = resetEmail != null || recovery != null
    /** The emailed code was accepted; only the new password is still missing. */
    val recovered: Boolean get() = recovery != null

    suspend fun signup(email: String, password: String, name: String): SignupResult = lock.withLock {
        signedOut()
        val address = email(email)
        password(password)
        val verifier = verifier()
        signupVerifier = verifier
        val body = JSONObject().put("email", address).put("password", password)
            .put("data", JSONObject().put("display_name", displayName(name).also { require(it.length <= 40) { "Nama maksimal 40 karakter." } }))
            .put("code_challenge", challenge(verifier)).put("code_challenge_method", "s256")
        val version = api.authenticationVersion()
        val result = api.request("/auth/v1/signup", body)
        if (!result.has("access_token") && result.optJSONArray("identities")?.length() == 0)
            throw ApiFailure("Email sudah terdaftar. Silakan masuk.", code = "email_exists")
        signupVerifier = verifier
        if (!result.has("access_token")) SignupResult.ConfirmEmail
        else { signupVerifier = null; if (api.acceptLogin(result,version)) SignupResult.SignedIn else SignupResult.MfaRequired }
    }
    suspend fun verifySignupCode(email: String, code: String): Boolean = lock.withLock {
        signedOut()
        val version = api.authenticationVersion()
        val result = api.request("/auth/v1/verify", JSONObject().put("type", "signup").put("email", email(email)).put("token", otp(code)))
        signupVerifier = null
        api.acceptLogin(result,version)
    }
    suspend fun resendSignupCode(email: String) {
        signedOut()
        api.request("/auth/v1/resend", JSONObject().put("type", "signup").put("email", email(email)))
    }
    suspend fun completeSignupReturn(code: String): Boolean = lock.withLock {
        signedOut()
        val verifier = signupVerifier ?: throw ApiFailure("Pendaftaran tidak dimulai di aplikasi ini. Gunakan kode email.")
        val version = api.authenticationVersion()
        val result = exchange(code, verifier)
        signupVerifier = null
        api.acceptLogin(result,version)
    }
    /**
     * Emails a 6-digit code (template `recovery.html`). The PKCE challenge is sent only so the same email's website
     * link never carries tokens; GoTrue accepts the code for a PKCE request too (`isOtpValid`, auth v2.197).
     */
    suspend fun requestPasswordReset(email: String) = lock.withLock {
        signedOut()
        val address = email(email)
        // Kept before HTTP: an interrupted response may still have sent the email, and its code must stay usable.
        resetEmail = address
        recovery = null
        api.request("/auth/v1/recover", JSONObject().put("email", address).put("code_challenge", challenge(verifier())).put("code_challenge_method", "s256"))
    }
    suspend fun beginPasswordReset(code: String) = lock.withLock {
        signedOut()
        val address = resetEmail ?: throw ApiFailure("Minta kode reset terlebih dahulu.")
        val result = Session.parse(api.request("/auth/v1/verify", JSONObject().put("type", "recovery").put("email", address).put("token", otp(code))))
        check(resetEmail == address) { "Reset sandi sudah dibatalkan." }
        signedOut()
        require(result.email.equals(address, ignoreCase=true)) { "Akun reset tidak sesuai." }
        require(result.expiresAt > Instant.now().epochSecond) { "Kode reset sudah kedaluwarsa. Minta kode baru." }
        recovery = result
    }
    /** On success the owner signs in normally, including 2FA; a recovery link never opens account data here. */
    suspend fun setRecoveredPassword(password: String) = lock.withLock {
        signedOut()
        password(password)
        val candidate = recovery ?: throw ApiFailure("Masukkan kode reset sebelum mengganti sandi.")
        require(candidate.expiresAt > Instant.now().epochSecond) { "Sesi reset sudah kedaluwarsa. Minta kode baru." }
        api.request("/auth/v1/user", JSONObject().put("password", password), candidate.accessToken, "PUT")
        recovery = null
        resetEmail = null
        try {
            api.request("/auth/v1/logout?scope=local", token = candidate.accessToken)
            PasswordResetResult.PasswordChanged
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            PasswordResetResult.PasswordChangedLogoutUnconfirmed
        }
    }
    fun cancelPasswordReset() { resetEmail = null; recovery = null }
    suspend fun setPassword(password: String) = lock.withLock {
        password(password)
        val token = active().accessToken
        api.request("/auth/v1/user", JSONObject().put("password", password), token, "PUT")
    }
    suspend fun enrollMfa(): TotpEnrollment = lock.withLock {
        val token = active().accessToken
        val factors = factors(token)
        require(factors.none { it.optString("status") == "verified" }) { "2FA sudah aktif." }
        factors.forEach { api.request("/auth/v1/factors/${it.id("id")}", token = token, method = "DELETE") }
        val result = api.request("/auth/v1/factors", JSONObject().put("factor_type", "totp"), token)
        val totp = result.getJSONObject("totp")
        val secret = totp.text("secret",128)
        val uri = totp.text("uri",2048)
        require(Regex("[A-Z2-7]{16,128}").matches(secret) && uri.startsWith("otpauth://totp/") && uri.none(Char::isISOControl)) { "Respons 2FA tidak valid." }
        TotpEnrollment(result.id("id"),secret,uri)
    }
    suspend fun confirmMfa(id: String, code: String) = lock.withLock {
        JSONObject().put("id",id).id("id");otp(code)
        val current = active()
        val version = api.authenticationVersion()
        require(factors(current.accessToken).any { it.id("id") == id && it.optString("status") == "unverified" }) { "Pendaftaran 2FA tidak tersedia." }
        val challenge = api.request("/auth/v1/factors/$id/challenge", token=current.accessToken)
        val result = api.request("/auth/v1/factors/$id/verify", JSONObject().put("challenge_id",challenge.id("id")).put("code",code), current.accessToken)
        require(api.session == current) { "Akun berubah. Silakan masuk kembali." }
        saveSameAccount(result,current,version)
    }
    suspend fun removeMfa(code: String) = lock.withLock {
        api.verifyMfa(otp(code))
        val current = active()
        val version = api.authenticationVersion()
        factors(current.accessToken).forEach { api.request("/auth/v1/factors/${it.id("id")}", token=current.accessToken, method="DELETE") }
        val result = api.request("/auth/v1/token?grant_type=refresh_token",JSONObject().put("refresh_token",current.refreshToken))
        require(api.session == current) { "Akun berubah. Silakan masuk kembali." }
        saveSameAccount(result,current,version)
    }
    suspend fun recoverMfa(code: String): Boolean = lock.withLock {
        val clean = code.trim().uppercase(java.util.Locale.ROOT)
        require(Regex("[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}").matches(clean)) { "Kode pemulihan tidak valid." }
        val version = api.authenticationVersion()
        val pending = api.pendingSession ?: throw ApiFailure("Masuk dengan email dan kata sandi terlebih dahulu.")
        require(pending.expiresAt > Instant.now().epochSecond) { "Sesi masuk kedaluwarsa. Masuk kembali." }
        api.request("/functions/v1/mfa-recovery",JSONObject().put("code",clean),pending.accessToken)
        val result = api.request("/auth/v1/token?grant_type=refresh_token",JSONObject().put("refresh_token",pending.refreshToken))
        val refreshed = Session.parse(result)
        require(refreshed.expiresAt > Instant.now().epochSecond && refreshed.email.equals(pending.email,ignoreCase=true)) { "Sesi pemulihan tidak sesuai dengan akun." }
        require(api.pendingSession == pending && api.session == null) { "Proses masuk sudah berubah." }
        api.acceptLogin(result,version)
    }
    suspend fun signOutOthers() { api.request("/auth/v1/logout?scope=others",token=active().accessToken) }
    suspend fun security(): AccountSecurity = parseAccountSecurity(api.rpc("security_workspace"))
    suspend fun recoveryCodeStatus(): RecoveryCodeStatus {
        val result = api.rpc("my_recovery_codes_status")
        val total = result.whole("total",0,10).toInt()
        val remaining = result.whole("remaining",0,total.toLong()).toInt()
        return RecoveryCodeStatus(total,remaining,if(result.isNull("created_at")) null else result.instant("created_at"))
    }
    /** Returned once; caller must not log, persist in SavedState, or silently regenerate on network failures. */
    suspend fun createRecoveryCodes(code: String): List<String> = lock.withLock {
        api.verifyMfa(otp(code))
        val codes = api.rpc("create_my_recovery_codes").array("codes")
        require(codes.length() == 10) { "Respons kode pemulihan tidak valid." }
        (0 until codes.length()).map { codes.getString(it).also { value -> require(Regex("[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}").matches(value)) } }
            .also { require(it.distinct().size == 10) { "Kode pemulihan berulang." } }
    }
    private suspend fun saveSameAccount(json: JSONObject, current: Session, version: Long) {
        val next = Session.parse(json)
        require(next.expiresAt > Instant.now().epochSecond && next.email.equals(current.email,ignoreCase=true)) { "Sesi 2FA tidak sesuai dengan akun." }
        require(api.session == current) { "Akun berubah. Silakan masuk kembali." }
        api.save(next,version)
    }
    private suspend fun active(): Session { check(!resetting) { "Selesaikan atau batalkan reset sandi terlebih dahulu." };api.refresh();return requireNotNull(api.session) }
    private fun signedOut() { check(api.session == null && api.pendingSession == null) { "Keluar atau batalkan proses masuk sebelum melanjutkan." } }
    private suspend fun factors(token: String) = api.request("/auth/v1/user",token=token,method="GET").optJSONArray("factors")?.objects(30)
        ?.filter { it.optString("factor_type") == "totp" }.orEmpty()
    private suspend fun exchange(code: String, verifier: String): JSONObject {
        require(code.length in 1..2048 && code.none { it.isWhitespace() || it.isISOControl() }) { "Kode tautan tidak valid." }
        return api.request("/auth/v1/token?grant_type=pkce",JSONObject().put("auth_code",code).put("code_verifier",verifier))
    }
    private fun email(raw: String): String = raw.trim().also { require(it.length <= 320 && Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$").matches(it)) { "Isi alamat email yang valid." } }
    private fun password(value: String) { require(value.length in 10..256 && value.none(Char::isISOControl)) { "Kata sandi harus 10–256 karakter." } }
    private fun otp(value: String): String = value.also { require(Regex("[0-9]{6}").matches(it)) { "Kode harus 6 angka." } }
    private fun verifier(): String = Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32).also { SecureRandom().nextBytes(it) })
    private fun challenge(value: String): String = Base64.getUrlEncoder().withoutPadding().encodeToString(MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.US_ASCII)))
}
internal fun parseAccountSecurity(json: JSONObject): AccountSecurity {
    require(json.opt("mfa_enabled") is Boolean) { "Status keamanan tidak valid." }
    return AccountSecurity(json.getBoolean("mfa_enabled"), if(json.isNull("hold_until")) null else json.instant("hold_until"), json.array("events").objects(20).map {
        SecurityEvent(it.text("kind",80),if(it.isNull("detail")) null else it.text("detail",1000),it.instant("created_at"))
    })
}
