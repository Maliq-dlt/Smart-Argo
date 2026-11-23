package id.smartagro.app

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.content.edit
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.CancellationException
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.TimeUnit

data class Notice(val key: String, val title: String, val body: String)

private fun JSONObject.text(name: String): String = if (isNull(name)) "" else optString(name)

/**
 * The conditions in one my_overview snapshot that deserve a phone notification, given the alert kinds the owner keeps on.
 * Pure: the worker stores the returned keys and passes them back next time, so a condition that lasts is announced once,
 * and again only after it cleared.
 */
internal fun noticesFor(previous: Set<String>, overview: JSONObject, kinds: Set<String>): Pair<List<Notice>, Set<String>> {
    val current = linkedMapOf<String, Notice>()
    val names = mutableMapOf<String, String>()
    val plants = overview.optJSONArray("plants") ?: JSONArray()
    for (i in 0 until plants.length()) {
        val plant = plants.getJSONObject(i)
        val unit = plant.text("unit_id")
        if (unit.isBlank()) continue  // a slot without a probe has nothing to report
        val name = plant.text("name").ifBlank { "Tanaman" }
        names[unit] = name
        if ("soil_dry" in kinds && plant.text("state") == "below") {
            val key = "$unit:below"
            current[key] = Notice(key, "$name perlu disiram", "Kelembapan tanah di bawah batas pot ini.")
        }
    }
    val issues = overview.optJSONObject("devices")?.optJSONArray("issues") ?: JSONArray()
    for (i in 0 until issues.length()) {
        val issue = issues.getJSONObject(i)
        val unit = issue.text("unit_id")
        val name = names[unit] ?: "Pot"
        val key = "$unit:${issue.text("device_id")}:${issue.text("kind")}"
        when (issue.text("kind")) {
            "silent" -> if ("device_silent" in kinds) current[key] = Notice(key, "$name: perangkat tidak mengirim data",
                "Belum ada kiriman lebih dari 90 menit. Periksa daya atau Wi-Fi.")
            "battery_low" -> if ("battery_low" in kinds) current[key] = Notice(key, "$name: baterai perangkat lemah",
                "Tegangan di bawah 3,4 V. Pastikan panel surya terkena sinar matahari.")
        }
    }
    return current.values.filter { it.key !in previous } to current.keys
}

/** Checks the garden once an hour while the owner keeps phone notifications on. */
class CareCheckWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val context = applicationContext
        if (!CareNotifications.enabled(context)) return Result.success()
        val config = BackendConfig(BuildConfig.SUPABASE_URL, BuildConfig.SUPABASE_ANON_KEY, allowEmulatorHost = BuildConfig.DEBUG)
        val api = AgroApi(config, SessionStore(context, config.url))
        try {
            if (!api.resume()) return Result.success()  // signed out: nothing to watch
            val kinds = api.rpc("my_alert_preferences").optJSONArray("kinds")
                ?.let { list -> (0 until list.length()).map(list::getString).toSet() }.orEmpty()
            val (notices, keys) = noticesFor(CareNotifications.seen(context), api.rpc("my_overview"), kinds)
            notices.forEach { CareNotifications.post(context, it) }
            CareNotifications.remember(context, keys)
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            // ponytail: an expired session, no network or a backend without my_overview yet just waits for the next hour.
            // The worker never clears the stored session; the app asks the owner to sign in again.
        }
        return Result.success()
    }
}

internal object CareNotifications {
    private const val PREFS = "care-notifications"
    private const val WORK = "care-check"
    private const val CHANNEL = "perawatan"
    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun enabled(context: Context) = prefs(context).getBoolean("enabled", false)
    fun seen(context: Context): Set<String> = prefs(context).getStringSet("seen", null).orEmpty().toSet()
    fun remember(context: Context, keys: Set<String>) = prefs(context).edit { putStringSet("seen", keys) }

    /** True when the system lets the app post (Android 13+ asks for a runtime permission). */
    fun allowed(context: Context) = Build.VERSION.SDK_INT < 33 ||
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun setEnabled(context: Context, on: Boolean) {
        prefs(context).edit { putBoolean("enabled", on); remove("seen") }
        val work = WorkManager.getInstance(context)
        if (!on) { work.cancelUniqueWork(WORK); return }
        val request = PeriodicWorkRequestBuilder<CareCheckWorker>(1, TimeUnit.HOURS)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
        work.enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    fun post(context: Context, notice: Notice) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        context.getSystemService(NotificationManager::class.java)
            .createNotificationChannel(NotificationChannel(CHANNEL, "Perawatan tanaman", NotificationManager.IMPORTANCE_DEFAULT))
        val open = PendingIntent.getActivity(context, 0,
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        NotificationManagerCompat.from(context).notify(notice.key.hashCode(), NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_agro_mono).setContentTitle(notice.title).setContentText(notice.body)
            .setContentIntent(open).setAutoCancel(true).build())
    }
}
