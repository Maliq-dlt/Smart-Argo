package id.smartagro.app

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.time.Instant

class ApiFailure(message: String, val expired: Boolean = false, val code: String? = null, val status: Int = 0) : Exception(message)

/** Same GoTrue and PostgREST contracts as the web. No service-role key or device-control writes. */
class AgroApi(private val config: BackendConfig, private val store: SessionStore, private val connect: (URI)->HttpURLConnection = { it.toURL().openConnection() as HttpURLConnection }) {
    var session: Session? = null
        private set
    private var pending: Session? = null
    private var factorId: String? = null
    private val refreshLock = Mutex()

    private suspend fun request(path: String, body: JSONObject? = JSONObject(), token: String? = null, method: String = "POST"): JSONObject =
        withContext(Dispatchers.IO) {
            check(config.valid) { "Alamat backend atau kunci publik belum valid." }
            val connection = connect(URI(config.url.trimEnd('/') + path))
            try {
                connection.requestMethod = method
                connection.instanceFollowRedirects = false
                connection.connectTimeout = 15000
                connection.readTimeout = 20000
                connection.setRequestProperty("apikey", config.anonKey)
                connection.setRequestProperty("Content-Type", "application/json")
                token?.let { connection.setRequestProperty("Authorization", "Bearer $it") }
                if (method != "GET") {
                    connection.doOutput = true
                    connection.outputStream.use { it.write((body ?: JSONObject()).toString().toByteArray(Charsets.UTF_8)) }
                }
                val status = connection.responseCode
                if (status == 204) return@withContext JSONObject()
                val stream = if (status in 200..299) connection.inputStream else connection.errorStream
                val bytes = stream?.use { input ->
                    val output = java.io.ByteArrayOutputStream()
                    val buffer = ByteArray(8192)
                    while (output.size() <= 1_048_576) {
                        val count = input.read(buffer)
                        if (count == -1) break
                        output.write(buffer, 0, count)
                    }
                    output.toByteArray()
                } ?: byteArrayOf()
                if (bytes.size > 1_048_576) throw ApiFailure("Respons terlalu besar. Coba lagi nanti.")
                val json = runCatching { JSONObject(String(bytes, Charsets.UTF_8)) }.getOrNull()
                if (status !in 200..299 || json == null || json.opt("ok") == false) {
                    val expired = token != null && token == session?.accessToken &&
                        (status == 401 || json?.optString("code") in listOf("unauthorized", "invalid_session"))
                    throw ApiFailure(friendlyError(status, json), expired, json?.optString("code"), status)
                }
                json
            } finally { connection.disconnect() }
        }

    private suspend fun save(value: Session) {
        withContext(Dispatchers.IO) { store.save(value) }
        session = value
        pending = null
        factorId = null
    }
    suspend fun restore(): Boolean {
        session = withContext(Dispatchers.IO) { store.read() }
        if (session == null) return false
        refresh()
        val user=request("/auth/v1/user", token = session!!.accessToken, method = "GET")
        save(Session.parse(session!!.toJson().put("user",user)))
        return true
    }
    suspend fun login(email: String, password: String): Boolean {
        cancelMfa()
        require(Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$").matches(email) && email.length <= 320) { "Isi alamat email yang valid." }
        require(password.length in 1..256) { "Isi kata sandi, maksimal 256 karakter." }
        val json = request("/auth/v1/token?grant_type=password", JSONObject().put("email", email).put("password", password))
        return acceptLogin(json)
    }
    suspend fun loginIdToken(idToken: String, nonce: String): Boolean {
        cancelMfa()
        require(idToken.length in 1..8192 && idToken.none(Char::isWhitespace) && Regex("[A-Za-z0-9_-]{43}").matches(nonce)) { "Respons Google tidak valid. Coba masuk kembali." }
        return acceptLogin(request("/auth/v1/token?grant_type=id_token",JSONObject().put("provider","google").put("id_token",idToken).put("nonce",nonce)))
    }
    private suspend fun acceptLogin(json: JSONObject): Boolean {
        val candidate = Session.parse(json)
        val user = request("/auth/v1/user", token = candidate.accessToken, method = "GET")
        val factor = user.optJSONArray("factors")?.objects(30)?.firstOrNull {
            it.optString("factor_type") == "totp" && it.optString("status") == "verified"
        }
        if (factor != null) {
            pending = candidate
            factorId = factor.id("id")
            return false
        }
        save(candidate)
        return true
    }
    suspend fun verifyMfa(code: String) {
        require(Regex("[0-9]{6}").matches(code)) { "Kode autentikator harus 6 angka." }
        if (pending == null) refresh()
        val candidate = pending ?: session ?: throw ApiFailure("Masuk kembali sebelum memasukkan kode.")
        val token = candidate.accessToken
        val id = factorId ?: request("/auth/v1/user", token=token, method="GET")
            .optJSONArray("factors")?.objects(30)?.firstOrNull { it.optString("factor_type")=="totp" && it.optString("status")=="verified" }?.id("id")
            ?: throw ApiFailure("Aktifkan autentikator di Keamanan akun pada website sebelum menukar poin.")
        val challenge = request("/auth/v1/factors/$id/challenge", token = token)
        val result = request("/auth/v1/factors/$id/verify", JSONObject().put("challenge_id", challenge.id("id")).put("code", code), token)
        save(Session.parse(result).let { it.copy(email=it.email.ifBlank { candidate.email },displayName=it.displayName.ifBlank { candidate.displayName }) })
    }
    fun cancelMfa() { pending = null; factorId = null }
    private suspend fun refresh() = refreshLock.withLock {
        val value = session ?: throw ApiFailure("Silakan masuk kembali.", true)
        if (value.expiresAt > Instant.now().epochSecond + 60) return@withLock
        try {
            val json = request("/auth/v1/token?grant_type=refresh_token", JSONObject().put("refresh_token", value.refreshToken))
            save(Session.parse(json).let { it.copy(email = it.email.ifBlank { value.email }, displayName = it.displayName.ifBlank { value.displayName }) })
        } catch (error: ApiFailure) {
            // Network failures never get here, and 5xx, 408 and 429 are temporary: the session stays. Any other 4xx is Auth
            // refusing this refresh token (hosted Auth: 400 validation_failed or refresh_token_not_found), so sign-in is required.
            if (error.status in 400..499 && error.status !in listOf(408, 429)) throw ApiFailure("Sesi berakhir. Silakan masuk kembali.", true, error.code, error.status)
            throw error
        }
    }
    suspend fun rpc(name: String, body: JSONObject = JSONObject()): JSONObject {
        require(name in setOf("ensure_my_account", "my_products", "my_units", "my_unit_overview", "unit_measurements", "rename_my_unit", "reward_workspace", "reserve_my_reward", "cancel_my_redemption", "my_chain_proofs", "my_garden"))
        refresh()
        return request("/rest/v1/rpc/$name", body, session!!.accessToken)
    }
    suspend fun updateName(raw: String): String {
        val name = displayName(raw)
        refresh()
        val user = request("/auth/v1/user", JSONObject().put("data",JSONObject().put("display_name",name)),session!!.accessToken,"PUT")
        save(Session.parse(session!!.toJson().put("user",user)))
        return session!!.displayName
    }
    suspend fun reserveReward(itemId: String, otp: String): String {
        require(runCatching { java.util.UUID.fromString(itemId).toString()==itemId.lowercase() }.getOrDefault(false)) { "Item reward tidak valid." }
        refresh()
        val email = session!!.email
        val requestId = withContext(Dispatchers.IO) { store.rewardRequest(email,itemId) }
        val body = JSONObject().put("p_item_id",itemId).put("p_request_id",requestId)
        val receipt = try { rpc("reserve_my_reward",body) }
        catch (error: ApiFailure) {
            if (error.code != "step_up_required" || !Regex("[0-9]{6}").matches(otp)) throw error
            verifyMfa(otp)
            rpc("reserve_my_reward",body)
        }
        require(receipt.opt("ok")==true) { "Hasil reservasi belum dapat dipastikan. Coba lagi dengan permintaan yang sama." }
        receipt.id("redemption_id");receipt.whole("reserved_points",1,100000)
        val status=receipt.text("status").also { require(it in redemptionLabels) { "Status reservasi tidak valid. Muat ulang reward." } }
        withContext(Dispatchers.IO) { store.finishRewardRequest(email,itemId) }
        return status
    }
    suspend fun resetRewardRequest(itemId: String) {
        refresh()
        require(runCatching { java.util.UUID.fromString(itemId).toString()==itemId.lowercase() }.getOrDefault(false))
        val current=parseRewards(rpc("reward_workspace"))
        require(current.redemptions.none { it.catalogItemId==itemId && it.status=="reserved" }) { "Masih ada reservasi item ini. Periksa website terlebih dahulu." }
        withContext(Dispatchers.IO) { store.archiveRewardRequest(session!!.email,itemId) }
    }
    suspend fun cancelReward(id: String) {
        val receipt=rpc("cancel_my_redemption",JSONObject().put("p_id",id))
        require(receipt.opt("ok")==true && receipt.id("redemption_id")==id && receipt.text("status")=="cancelled") { "Pembatalan belum dapat dipastikan. Muat ulang reward." }
    }
    suspend fun clear() {
        session = null; cancelMfa()
        withContext(Dispatchers.IO) { store.clear() }
    }
    suspend fun logout() {
        val token = session?.accessToken
        try { if (token != null) request("/auth/v1/logout?scope=local", token = token) }
        finally { clear() }
    }
}
internal fun friendlyError(status: Int, json: JSONObject?): String {
    val detail = listOf("msg", "message", "error_description", "error", "code", "error_code").joinToString(" ") { json?.optString(it).orEmpty() }.lowercase()
    val codes = mapOf(
        "unauthorized" to "Sesi berakhir. Silakan masuk kembali.",
        "invalid_session" to "Sesi berakhir. Silakan masuk kembali.",
        "mfa_required" to "Aktifkan 2FA di Keamanan akun pada website sebelum menukar poin.",
        "step_up_required" to "Masukkan kode autentikator terbaru, lalu konfirmasi kembali.",
        "security_hold" to "Penukaran ditahan 24 jam setelah perubahan keamanan akun.",
        "limit_reached" to "Batas 10 reservasi dalam 24 jam sudah tercapai.",
        "insufficient_points" to "Poin tersedia belum cukup. Muat ulang saldo.",
        "item_unavailable" to "Stok reward tidak tersedia. Muat ulang katalog.",
        "state_conflict" to "Status sudah berubah. Muat ulang sebelum melanjutkan.",
        "redemption_unavailable" to "Reservasi ini tidak tersedia untuk akun Anda.",
        "request_conflict" to "Permintaan berbeda dari kiriman sebelumnya. Muat ulang.",
        "invalid_label" to "Nama tanaman harus 1-120 karakter.")
    codes[json?.optString("code")]?.let { return it }
    return when {
        "invalid login credentials" in detail || "invalid_credentials" in detail -> "Email atau kata sandi salah. Coba periksa kembali."
        "email not confirmed" in detail || "email_not_confirmed" in detail -> "Konfirmasi email Anda terlebih dahulu, lalu masuk kembali."
        "mfa" in detail || "verification" in detail || "otp" in detail -> "Kode verifikasi tidak berlaku. Gunakan kode terbaru dari autentikator."
        status == 429 -> "Terlalu banyak percobaan. Tunggu sebentar, lalu coba lagi."
        status == 401 || "refresh_token" in detail -> "Sesi berakhir. Silakan masuk kembali."
        status == 403 -> "Akses ditolak. Periksa kepemilikan produk atau keamanan akun di website."
        status in 500..599 -> "Server belum dapat dihubungi. Coba lagi nanti."
        else -> "Permintaan gagal. Periksa koneksi dan coba lagi."
    }
}
