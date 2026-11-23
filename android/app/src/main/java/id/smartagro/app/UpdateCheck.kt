package id.smartagro.app

import android.content.Context
import androidx.core.content.edit
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

internal fun isNewer(latestTag: String, current: String): Boolean {
    fun parse(value: String): List<Int>? = Regex("(?:android-)?v?(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)").matchEntire(value)
        ?.groupValues?.drop(1)?.map { it.toIntOrNull() ?: return null }
    val latest = parse(latestTag) ?: return false
    val installed = parse(current) ?: return false
    return latest.zip(installed).firstOrNull { (a, b) -> a != b }?.let { (a, b) -> a > b } ?: false
}

// ponytail: GitHub stable sideload releases only; add store updates when distributed through Play.
internal suspend fun checkApkUpdate(context: Context, now: Long = System.currentTimeMillis()): String? = withContext(Dispatchers.IO) {
    val cache = context.getSharedPreferences("apk-update", Context.MODE_PRIVATE)
    if (now - cache.getLong("checked-at", 0) !in 0 until 86_400_000L) {
        val connection = URL("https://api.github.com/repos/Maliq-dlt/Smart-Argo/releases/latest").openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 8_000
            connection.readTimeout = 8_000
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("Accept", "application/vnd.github+json")
            connection.setRequestProperty("User-Agent", "SmartAgro-Android/${BuildConfig.VERSION_NAME}")
            if (connection.responseCode == 200) {
                val json = JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
                val tag = json.optString("tag_name")
                val release = json.optString("html_url")
                val supported = tag.startsWith("android-v") && !json.optBoolean("draft") && !json.optBoolean("prerelease") &&
                    isNewer(tag, BuildConfig.VERSION_NAME) && release == "https://github.com/Maliq-dlt/Smart-Argo/releases/tag/$tag"
                cache.edit { putString("release", if (supported) release else "") }
            }
        } catch (_: Exception) { /* Keep the last successful result on network failure. */ }
        finally { connection.disconnect(); cache.edit { putLong("checked-at", now) } }
    }
    cache.getString("release", "")?.takeIf { it.isNotEmpty() && isNewer(it.substringAfterLast('/'), BuildConfig.VERSION_NAME) }
}

@Composable internal fun UpdateAvailableRow() {
    val context = LocalContext.current
    val uri = rememberSafeUriHandler()
    var release by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { release = checkApkUpdate(context.applicationContext) }
    release?.let { url -> Group { Cell("Versi baru tersedia", subtitle = "Buka rilis APK di GitHub", onClick = { uri.openUri(url) }) } }
}
