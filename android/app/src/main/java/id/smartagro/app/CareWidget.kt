package id.smartagro.app

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews
import org.json.JSONObject

fun widgetLine(overview: JSONObject?, now: java.time.Instant = java.time.Instant.now()): String {
    if (overview == null) return "Buka Smart Agro untuk memuat"
    val plants = overview.optJSONArray("plants") ?: return "Buka Smart Agro untuk memuat"
    if (plants.length() == 0) return "Belum ada tanaman aktif"
    val rows = (0 until plants.length()).map { plants.getJSONObject(it) }
    val measured = rows.associateWith { runCatching { it.instant("measured_at") }.getOrNull() }
    rows.firstOrNull { it.optString("state") == "below" && measured[it]?.let { at -> fresh(at, now) } == true }?.let { return "${it.optString("name", "Tanaman")} perlu disiram" }
    if (rows.any { it.optString("state") in setOf("ok", "above", "below") && measured[it]?.let { at -> fresh(at, now) } != true }) return "Bacaan tanaman belum segar; buka Smart Agro"
    rows.firstOrNull { it.optString("state") == "above" }?.let { return "${it.optString("name", "Tanaman")} di atas pita kelembapan" }
    if (rows.any { it.optString("state") != "ok" }) return "Pola atau bacaan tanaman belum lengkap"
    return "Semua tanaman aman"
}

/** Native RemoteViews keeps the small widget independent of an additional UI runtime. */
class CareWidget : AppWidgetProvider() {
    override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
        refresh(context)
        if (SessionStore(context, BuildConfig.SUPABASE_URL).read() != null) {
            androidx.work.WorkManager.getInstance(context).enqueueUniqueWork("care-widget-refresh", androidx.work.ExistingWorkPolicy.KEEP,
                androidx.work.OneTimeWorkRequestBuilder<CareCheckWorker>().setConstraints(androidx.work.Constraints.Builder()
                    .setRequiredNetworkType(androidx.work.NetworkType.CONNECTED).build()).build())
        }
    }
    companion object {
        fun active(context: Context) = AppWidgetManager.getInstance(context).getAppWidgetIds(ComponentName(context, CareWidget::class.java)).isNotEmpty()
        fun refresh(context: Context) {
            val manager = AppWidgetManager.getInstance(context)
            val ids = manager.getAppWidgetIds(ComponentName(context, CareWidget::class.java))
            if (ids.isEmpty()) return
            val endpoint = BuildConfig.SUPABASE_URL
            val session = SessionStore(context, endpoint).read()
            val cached = session?.let { OverviewCache(java.io.File(context.filesDir, "care-cache")).load(endpoint + ":" + it.email) }
            val overview = cached?.let { runCatching { JSONObject(it.json).optJSONObject("care") }.getOrNull() }
            val open = PendingIntent.getActivity(context, 0, Intent(context, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            ids.forEach { id ->
                val views = RemoteViews(context.packageName, R.layout.care_widget)
                views.setTextViewText(R.id.care_widget_text, widgetLine(overview))
                val observed = overview?.optJSONArray("plants")?.let { plants -> (0 until plants.length()).mapNotNull { i -> runCatching { plants.getJSONObject(i).instant("measured_at") }.getOrNull() }.minOrNull() }
                views.setTextViewText(R.id.care_widget_time, observed?.let { "Diukur ${time(it)}" } ?: "Smart Agro")
                views.setOnClickPendingIntent(R.id.care_widget_root, open)
                manager.updateAppWidget(id, views)
            }
        }
    }
}
