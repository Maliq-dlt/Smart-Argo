package id.smartagro.app

import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.time.Instant

/** Private per-account snapshots; only complete snapshots replace the last readable file. */
class OverviewCache(private val dir: File) {
    private companion object { val lock = Any() }
    data class Cached(val json: String, val at: Instant)
    private fun file(account: String): File {
        require(account.isNotBlank())
        val hash = MessageDigest.getInstance("SHA-256").digest(account.toByteArray()).joinToString("") { "%02x".format(it) }
        return File(dir, "cache-$hash.json")
    }
    fun save(account: String, json: String, at: Instant) = synchronized(lock) {
        JSONObject(json)
        dir.mkdirs()
        val target = file(account)
        val next = File(dir, target.name + ".new")
        next.writeText(JSONObject().put("json", json).put("at", at.toString()).toString())
        java.nio.file.Files.move(next.toPath(), target.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING, java.nio.file.StandardCopyOption.ATOMIC_MOVE)
    }
    fun load(account: String): Cached? = synchronized(lock) { runCatching {
        val target = file(account)
        require(target.length() in 1..8_000_000)
        val data = JSONObject(target.readText())
        Cached(data.getString("json"), Instant.parse(data.getString("at")))
    }.getOrNull() }
    fun clear() = synchronized(lock) { dir.listFiles()?.filter { it.name.matches(Regex("cache-[a-f0-9]{64}\\.json(\\.new)?")) }?.forEach { check(it.delete()) } }
}
