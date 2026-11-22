package id.smartagro.app

import kotlinx.coroutines.NonCancellable
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
    @Volatile var session: Session? = null
        private set
    @Volatile private var pending: Session? = null
    internal val pendingSession: Session? get() = pending
    private var factorId: String? = null
    private val refreshLock = Mutex()
    private val authLock = Any()
    private var authVersion = 0L
    internal fun authenticationVersion(): Long = synchronized(authLock) { authVersion }

    internal suspend fun request(path: String, body: JSONObject? = JSONObject(), token: String? = null, method: String = "POST", timeout: Int = 20000): JSONObject =
        withContext(Dispatchers.IO) {
            check(config.valid) { "Alamat backend atau kunci publik belum valid." }
            val connection = connect(URI(config.url.trimEnd('/') + path))
            try {
                connection.requestMethod = method
                connection.instanceFollowRedirects = false
                connection.connectTimeout = 15000
                connection.readTimeout = timeout
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
                    // GoTrue puts its name in error_code (code is the HTTP number); PostgREST and functions use code.
                    throw ApiFailure(friendlyError(status, json), expired, json?.optString("error_code")?.ifEmpty { null } ?: json?.optString("code"), status)
                }
                json
            } finally { connection.disconnect() }
        }

    internal suspend fun save(value: Session, expectedVersion: Long = authenticationVersion()) {
        require(value.expiresAt > Instant.now().epochSecond && value.email.length <= 320 &&
            Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$").matches(value.email)) { "Respons sesi tidak valid atau kedaluwarsa." }
        withContext(Dispatchers.IO) {
            // Serialize disk and memory together so logout cannot be undone by an older response.
            synchronized(authLock) {
                check(authVersion == expectedVersion) { "Proses masuk sudah berubah. Silakan masuk kembali." }
                store.save(value)
                session = value
                pending = null
                factorId = null
                authVersion++
            }
        }
    }
    suspend fun restore(): Boolean {
        val expectedVersion = authenticationVersion()
        val restored = withContext(Dispatchers.IO) {
            synchronized(authLock) {
                check(authVersion == expectedVersion) { "Proses masuk sudah berubah." }
                store.read().also { session = it; authVersion++ }
            }
        } ?: return false
        refresh()
        val (current, version) = synchronized(authLock) { (session ?: return false) to authVersion }
        val user = request("/auth/v1/user", token = current.accessToken, method = "GET")
        val verified = Session.parse(current.toJson().put("user", user))
        require(restored.email.equals(verified.email, ignoreCase=true)) { "Identitas akun tidak sesuai dengan sesi." }
        save(verified, version)
        return true
    }
    suspend fun login(email: String, password: String): Boolean {
        cancelMfa()
        require(Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$").matches(email) && email.length <= 320) { "Isi alamat email yang valid." }
        require(password.length in 1..256) { "Isi kata sandi, maksimal 256 karakter." }
        val version = authenticationVersion()
        val json = request("/auth/v1/token?grant_type=password", JSONObject().put("email", email).put("password", password))
        return acceptLogin(json, version)
    }
    suspend fun loginIdToken(idToken: String, nonce: String): Boolean {
        cancelMfa()
        require(idToken.length in 1..8192 && idToken.none(Char::isWhitespace) && Regex("[A-Za-z0-9_-]{43}").matches(nonce)) { "Respons Google tidak valid. Coba masuk kembali." }
        val version = authenticationVersion()
        return acceptLogin(request("/auth/v1/token?grant_type=id_token",JSONObject().put("provider","google").put("id_token",idToken).put("nonce",nonce)), version)
    }
    internal suspend fun acceptLogin(json: JSONObject, expectedVersion: Long = authenticationVersion()): Boolean {
        val candidate = Session.parse(json)
        require(candidate.expiresAt > Instant.now().epochSecond) { "Respons sesi sudah kedaluwarsa." }
        val user = request("/auth/v1/user", token = candidate.accessToken, method = "GET")
        val verified = Session.parse(candidate.toJson().put("user",user))
        require(candidate.email.isBlank() || candidate.email.equals(verified.email,ignoreCase=true)) { "Identitas akun tidak sesuai dengan sesi." }
        val factor = user.optJSONArray("factors")?.objects(30)?.firstOrNull {
            it.optString("factor_type") == "totp" && it.optString("status") == "verified"
        }
        if (factor != null) {
            synchronized(authLock) {
                check(authVersion == expectedVersion) { "Proses masuk sudah berubah." }
                pending = verified
                factorId = factor.id("id")
                authVersion++
            }
            return false
        }
        save(verified, expectedVersion)
        return true
    }
    suspend fun verifyMfa(code: String) {
        require(Regex("[0-9]{6}").matches(code)) { "Kode autentikator harus 6 angka." }
        if (pending == null) refresh()
        val version = authenticationVersion()
        val pendingAtStart=pending
        val candidate = pending ?: session ?: throw ApiFailure("Masuk kembali sebelum memasukkan kode.")
        require(candidate.expiresAt > Instant.now().epochSecond) { "Sesi verifikasi sudah kedaluwarsa. Masuk kembali." }
        val token = candidate.accessToken
        val id = factorId ?: request("/auth/v1/user", token=token, method="GET")
            .optJSONArray("factors")?.objects(30)?.firstOrNull { it.optString("factor_type")=="totp" && it.optString("status")=="verified" }?.id("id")
            ?: throw ApiFailure("Aktifkan autentikator di Keamanan akun pada website sebelum menukar poin.")
        val challenge = request("/auth/v1/factors/$id/challenge", token = token)
        val result = request("/auth/v1/factors/$id/verify", JSONObject().put("challenge_id", challenge.id("id")).put("code", code), token)
        check(if(pendingAtStart!=null) pending === pendingAtStart && session==null else pending==null && session === candidate) { "Proses masuk sudah berubah. Ulangi verifikasi." }
        val verified=Session.parse(result).let { it.copy(email=it.email.ifBlank { candidate.email },displayName=it.displayName.ifBlank { candidate.displayName }) }
        require(verified.email.equals(candidate.email,ignoreCase=true)) { "Identitas akun tidak sesuai dengan sesi verifikasi." }
        save(verified, version)
    }
    fun cancelMfa() = synchronized(authLock) { pending = null; factorId = null; authVersion++ }
    internal suspend fun refresh() = refreshLock.withLock {
        val (value, version) = synchronized(authLock) { (session ?: throw ApiFailure("Silakan masuk kembali.", true)) to authVersion }
        if (value.expiresAt > Instant.now().epochSecond + 60) return@withLock
        try {
            val json = request("/auth/v1/token?grant_type=refresh_token", JSONObject().put("refresh_token", value.refreshToken))
            val refreshed = Session.parse(json).let { it.copy(email = it.email.ifBlank { value.email }, displayName = it.displayName.ifBlank { value.displayName }) }
            require(refreshed.email.equals(value.email, ignoreCase=true)) { "Identitas akun tidak sesuai dengan sesi." }
            save(refreshed, version)
        } catch (error: ApiFailure) {
            // Network failures never get here, and 5xx, 408 and 429 are temporary: the session stays. Any other 4xx is Auth
            // refusing this refresh token (hosted Auth: 400 validation_failed or refresh_token_not_found), so sign-in is required.
            if (error.status in 400..499 && error.status !in listOf(408, 429)) throw ApiFailure("Sesi berakhir. Silakan masuk kembali.", true, error.code, error.status)
            throw error
        }
    }
    suspend fun rpc(name: String, body: JSONObject = JSONObject()): JSONObject {
        require(name in setOf("ensure_my_account", "my_account_deletion", "request_account_deletion", "cancel_account_deletion", "my_avatar", "set_my_avatar", "clear_my_avatar", "my_products", "my_units", "my_unit_overview", "unit_measurements", "rename_my_unit", "archive_my_unit", "restore_my_unit", "place_my_device", "my_unit_history", "product_public_status", "reward_workspace", "reserve_my_reward", "cancel_my_redemption", "my_chain_proofs", "my_garden", "my_device_units", "unit_explanations", "add_my_site", "plant_in_my_slot", "switch_my_plant", "append_my_care_journal", "read_my_care_journal", "read_my_measurement_history", "compare_my_measurement_history", "security_workspace", "create_my_recovery_codes", "my_recovery_codes_status", "issue_activation_nonce", "create_transfer_offer", "cancel_transfer_offer", "accept_transfer", "open_ownership_recovery", "withdraw_ownership_recovery", "my_ownership_recoveries", "open_reward_appeal", "my_reward_cases", "energy_workspace", "set_slot_sharing", "share_my_cycle", "unshare_my_cycle", "community_knowledge"))
        refresh()
        return request("/rest/v1/rpc/$name", body, session!!.accessToken)
    }
    internal suspend fun authenticatedRequest(path: String, body: JSONObject = JSONObject()): JSONObject {
        require(path == "/functions/v1/product-claim") { "Fungsi akun tidak didukung." }
        refresh()
        return request(path, body, session!!.accessToken)
    }
    internal suspend fun <T> withIdempotentRequest(kind: String, key: String, hash: String, block: suspend (String) -> T): T {
        refresh()
        val email = requireNotNull(session).email
        val requestId = withContext(Dispatchers.IO) { store.payloadRequest(email, kind, key, hash) }
        val result = block(requestId)
        withContext(Dispatchers.IO) { store.finishPayloadRequest(email, kind, key, hash) }
        return result
    }
    suspend fun weather(latitude: Double, longitude: Double): WeatherSnapshot {
        require(latitude.isFinite() && longitude.isFinite() && latitude in -90.0..90.0 && longitude in -180.0..180.0) { "Koordinat kebun tidak valid." }
        refresh()
        return parseWeatherSnapshot(request("/functions/v1/weather-forecast",JSONObject().put("lat",latitude).put("lon",longitude),session!!.accessToken).getJSONObject("weather"))
    }
    suspend fun explain(unitId: String, deviceId: String, question: String): UnitExplanation {
        listOf(unitId,deviceId).forEach { JSONObject().put("id",it).id("id") }
        require(question.length<=500 && question.none { it.isISOControl() && it!='\n' }) { "Pertanyaan maksimal 500 karakter." }
        refresh()
        val email=session!!.email
        val requestId=withContext(Dispatchers.IO) { store.explanationRequest(email,unitId,deviceId,question) }
        val result=explain(unitId,deviceId,requestId,question)
        withContext(Dispatchers.IO) { store.finishExplanationRequest(email,unitId,deviceId,question) }
        return result
    }
    suspend fun explain(unitId: String, deviceId: String, requestId: String, question: String): UnitExplanation {
        listOf(unitId,deviceId,requestId).forEach { JSONObject().put("id",it).id("id") }
        require(question.length<=500 && question.none { it.isISOControl() && it!='\n' }) { "Pertanyaan maksimal 500 karakter." }
        refresh()
        val result=parseExplanationSnapshot(request("/functions/v1/unit-explanation",JSONObject().put("unit_id",unitId).put("device_id",deviceId)
            .put("request_id",requestId).put("question",question),session!!.accessToken,timeout=45000).getJSONObject("snapshot"))
        require(result.unitId==unitId && result.deviceId==deviceId) { "Bukti penjelasan tidak sesuai dengan unit." }
        return result
    }
    suspend fun updateName(raw: String): String {
        val name = displayName(raw)
        refresh()
        val (current, version) = synchronized(authLock) { requireNotNull(session) to authVersion }
        val user = request("/auth/v1/user", JSONObject().put("data",JSONObject().put("display_name",name)),current.accessToken,"PUT")
        val updated = Session.parse(current.toJson().put("user",user))
        require(updated.email.equals(current.email, ignoreCase=true)) { "Identitas akun tidak sesuai dengan sesi." }
        save(updated, version)
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
    suspend fun clear() = withContext(NonCancellable + Dispatchers.IO) {
        synchronized(authLock) {
            session = null
            pending = null
            factorId = null
            authVersion++
            store.clear()
        }
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
        "reauth_required" to "Verifikasi ulang dulu: masukkan kata sandi atau kode autentikator.",
        "no_pending_deletion" to "Tidak ada penghapusan akun yang menunggu.",
        "invalid_image" to "Foto harus berupa gambar WebP, JPEG, atau PNG.",
        "avatar_too_large" to "Foto terlalu besar. Pilih foto lain.",
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
        "user_already_exists" in detail || "email_exists" in detail -> "Email ini sudah terdaftar. Silakan masuk."
        "weak_password" in detail -> "Kata sandi minimal 10 karakter."
        "otp_expired" in detail -> "Kode salah atau sudah kedaluwarsa. Periksa email terbaru, atau minta kode baru."
        "over_email_send_rate_limit" in detail -> "Email baru saja dikirim. Tunggu sebentar sebelum meminta lagi."
        "mfa" in detail || "verification" in detail || "otp" in detail -> "Kode verifikasi tidak berlaku. Gunakan kode terbaru dari autentikator."
        status == 429 -> "Terlalu banyak percobaan. Tunggu sebentar, lalu coba lagi."
        status == 401 || "refresh_token" in detail -> "Sesi berakhir. Silakan masuk kembali."
        status == 403 -> "Akses ditolak. Periksa kepemilikan produk atau keamanan akun di website."
        status in 500..599 -> "Server belum dapat dihubungi. Coba lagi nanti."
        else -> "Permintaan gagal. Periksa koneksi dan coba lagi."
    }
}
