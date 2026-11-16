package id.smartagro.app

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** Only authenticated sessions are persisted, encrypted by a non-exportable Android Keystore key. */
class SessionStore(private val context: Context, endpoint: String, private val keyProvider: ()->SecretKey = ::androidSessionKey) {
    private val scope = java.security.MessageDigest.getInstance("SHA-256").digest(endpoint.trimEnd('/').toByteArray()).joinToString("") { "%02x".format(it) }
    private val file = File(context.noBackupFilesDir, "account-$scope.enc")
    fun read(): Session? {
        return try {
            val bytes = android.util.AtomicFile(file).openRead().use { input ->
                require(file.length() in 29..32768)
                input.readBytes()
            }
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, keyProvider(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
            Session.parse(JSONObject(String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8)))
        } catch (_: java.io.FileNotFoundException) { null }
        catch (_: Exception) { clear(); null }
    }
    fun save(session: Session) {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding").apply { init(Cipher.ENCRYPT_MODE, keyProvider()) }
        val bytes = cipher.iv + cipher.doFinal(session.toJson().toString().toByteArray(Charsets.UTF_8))
        val atomic = android.util.AtomicFile(file)
        val stream = atomic.startWrite()
        try { stream.write(bytes); atomic.finishWrite(stream) }
        catch (error: Exception) { atomic.failWrite(stream); throw error }
    }
    // An ambiguous network result keeps the same identity, including after process death.
    fun rewardRequest(email: String, itemId: String): String {
        val file = rewardFile(email, itemId)
        val atomic = android.util.AtomicFile(file)
        val mirror = android.util.AtomicFile(File(file.path+".copy"))
        fun read(source: android.util.AtomicFile): String? = runCatching {
            source.openRead().use { stream ->
                val bytes=ByteArray(37);val size=stream.read(bytes)
                require(size==36 && stream.read()==-1)
                val value=String(bytes,0,size,Charsets.UTF_8)
                java.util.UUID.fromString(value).toString().also { require(it==value) }
            }
        }.getOrNull()
        read(atomic)?.let { return it }
        read(mirror)?.let { value ->
            val stream=atomic.startWrite()
            try { stream.write(value.toByteArray());atomic.finishWrite(stream) }
            catch(error: Exception) { atomic.failWrite(stream);throw error }
            return value
        }
        if(file.exists() || File(file.path+".copy").exists()) throw ApiFailure(
            "Identitas reservasi di HP rusak. Periksa penukaran di website sebelum membuat permintaan baru.",code="request_identity_corrupt")
        val id = java.util.UUID.randomUUID().toString()
        val backup = mirror.startWrite()
        try { backup.write(id.toByteArray(Charsets.UTF_8));mirror.finishWrite(backup) }
        catch(error: Exception) { mirror.failWrite(backup);throw error }
        val stream = atomic.startWrite()
        try { stream.write(id.toByteArray(Charsets.UTF_8)); atomic.finishWrite(stream) }
        catch (error: Exception) { atomic.failWrite(stream); throw error }
        return id
    }
    fun finishRewardRequest(email: String, itemId: String) {
        val target=rewardFile(email,itemId)
        android.util.AtomicFile(target).delete()
        android.util.AtomicFile(File(target.path+".copy")).delete()
    }
    fun archiveRewardRequest(email: String,itemId: String) {
        val target=rewardFile(email,itemId)
        listOf(target,File(target.path+".copy")).filter { it.exists() }.forEach { source ->
            val archive=File(source.path+".damaged-"+java.util.UUID.randomUUID())
            check(source.renameTo(archive)) { "Identitas lama belum berhasil disisihkan. Tidak ada permintaan baru dibuat." }
        }
    }
    private fun rewardFile(email: String, itemId: String): File {
        val hash = java.security.MessageDigest.getInstance("SHA-256").digest("$email:$itemId".toByteArray()).joinToString("") { "%02x".format(it) }
        return File(context.noBackupFilesDir,"reward-$scope-$hash.id")
    }
    fun clear() { android.util.AtomicFile(file).delete() }
}

private fun androidSessionKey(): SecretKey {
    val alias = "smart-agro-session-v1"
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    (store.getKey(alias, null) as? SecretKey)?.let { return it }
    return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
        init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
    }.generateKey()
}
