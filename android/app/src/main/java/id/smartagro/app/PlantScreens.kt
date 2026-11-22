package id.smartagro.app

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.PointerEventPass
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlin.math.min
import kotlinx.coroutines.delay
import java.time.Duration
import java.time.Instant
import java.util.Locale

private val ID = Locale.forLanguageTag("id-ID")
private fun moistureIndex(value: Double?) = value?.let { String.format(ID, "%.0f/100", it) } ?: "—"
internal fun reading(sensor: Sensor, value: Double?) = when {
    value == null -> "—"
    sensor == Sensor.Moisture -> moistureIndex(value)
    sensor == Sensor.Temperature -> String.format(ID, "%.1f °C", value)
    else -> String.format(ID, "%.1f", value)
}
internal fun ago(at: Instant?, now: Instant): String {
    at ?: return "Belum ada bacaan"
    val minutes = Duration.between(at, now).toMinutes()
    return when {
        minutes < 1 -> "Baru saja"
        minutes < 60 -> "$minutes menit lalu"
        minutes < 24 * 60 -> "${minutes / 60} jam lalu"
        else -> time(at)
    }
}

internal enum class SensorStatus(val label: String) {
    Ready("Bacaan terbaru"),
    Waiting("Menunggu bacaan pertama"),
    Stale("Bacaan lama"),
    Unmeasured("Belum diukur"),
    Error("Sensor bermasalah"),
    UntrustedClock("Jam perangkat belum sinkron"),
    Revoked("Perangkat dicabut"),
    Unknown("Status sensor tidak dikenali"),
}

internal fun sensorStatus(sample: Reading?, now: Instant, stale: Boolean, revoked: Boolean): SensorStatus = when {
    revoked -> SensorStatus.Revoked
    sample == null -> SensorStatus.Waiting
    !sample.synced -> SensorStatus.UntrustedClock
    stale || !fresh(sample.at, now) -> SensorStatus.Stale
    sample.quality == "not_measured" -> SensorStatus.Unmeasured
    sample.quality == "error" -> SensorStatus.Error
    sample.quality == "ok" && sample.value != null -> SensorStatus.Ready
    else -> SensorStatus.Unknown
}

internal data class Health(
    val samples: Map<Sensor, Reading>,
    val sensorStatuses: Map<Sensor, SensorStatus>,
    val status: String,
    val attention: Boolean,
    val waiting: Boolean,
    val at: Instant?,
    val battery: Battery? = null,
) {
    fun value(sensor: Sensor) = samples[sensor]?.value?.takeIf { sensorStatuses.getValue(sensor) == SensorStatus.Ready }
    val moisture = value(Sensor.Moisture)
    val temperature = value(Sensor.Temperature)
    val ph = value(Sensor.Ph)
}

internal fun health(state: AppState, unit: PlantUnit, now: Instant): Health {
    val overview = state.overviews.find { it.id == unit.id }
    val stale = !state.demo && overview?.stale(now) != false
    val revoked = "device_revoked" in overview?.alerts.orEmpty()
    val samples = overview?.readings.orEmpty().groupBy { it.sensor }.mapValues { (_, rows) -> rows.maxBy { it.at } }
    val statuses = Sensor.entries.associateWith { sensor ->
        val sample = samples[sensor]
        if (state.demo && sample?.quality == "ok" && sample.value != null) SensorStatus.Ready
        else sensorStatus(sample, now, stale, revoked)
    }
    val status = when {
        state.demo -> "Skenario latihan"
        revoked -> "Perangkat dicabut"
        stale -> "Menunggu data terbaru"
        else -> stateLabels[overview?.state] ?: "Data perangkat tersimpan"
    }
    val attention = !stale && (overview?.state in listOf("sedih_perhatian", "waspada_marah") ||
        overview?.alerts.orEmpty().any { it in listOf("sensor_error", "battery_low", "energy_deficit") }) || revoked
    return Health(samples, statuses, status, attention, stale && !revoked, overview?.at, overview?.battery)
}

@Composable internal fun rememberNow(): Instant {
    var now by remember { mutableStateOf(Instant.now()) }
    LaunchedEffect(Unit) { while (true) { delay(30_000); now = Instant.now() } }
    return now
}

// ---------------------------------------------------------------- Signature: the moisture ring

/**
 * Soil moisture as a ring, drawn once from empty to its value on a critically-damped spring.
 * The number and status in text carry the meaning; the ring reinforces it (nothing by color alone).
 */
@Composable fun MoistureRing(value: Double?, modifier: Modifier = Modifier, size: Dp = 46.dp, stroke: Dp = 5.dp,
                             color: Color = palette.water, content: @Composable BoxScope.() -> Unit = {}) {
    val p = palette
    val sweep = remember { Animatable(0f) }
    LaunchedEffect(value) { sweep.animateTo(((value ?: 0.0) / 100.0).toFloat().coerceIn(0f, 1f), Springs.smooth()) }
    Box(modifier.size(size), contentAlignment = Alignment.Center) {
        Canvas(Modifier.matchParentSize()) {
            val w = stroke.toPx()
            val inset = w / 2
            val arc = androidx.compose.ui.geometry.Size(this.size.width - w, this.size.height - w)
            drawArc(color.copy(alpha = if (p.dark || color == Color.White) .24f else .16f), 0f, 360f, false, Offset(inset, inset), arc, style = Stroke(w))
            if (value != null) drawArc(Brush.sweepGradient(listOf(color.copy(alpha = .8f), color, color.copy(alpha = .8f))),
                -90f, 360f * sweep.value, false, Offset(inset, inset), arc, style = Stroke(w, cap = StrokeCap.Round))
        }
        content()
    }
}

@Composable internal fun SensorDiagnosticsSheet(unit: PlantUnit, health: Health, demo: Boolean, onDismiss: () -> Unit) {
    val p = palette
    AgroSheet("Diagnostik sensor", onDismiss) {
        Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(unit.name, style = T.title3, color = p.ink)
            if (demo) Text("Data skenario latihan", style = T.footnote, color = p.secondary)
            Sensor.entries.forEach { sensor ->
                val sample = health.samples[sensor]
                val status = health.sensorStatuses.getValue(sensor)
                Panel(Modifier.fillMaxWidth(), padding = 12.dp) {
                    Text(sensor.label, style = T.headline, color = p.ink)
                    Text(status.label, style = T.subhead, color = p.ink)
                    Text("Waktu ukur: ${sample?.at?.let { time(it) } ?: "Tidak tersedia"}", style = T.footnote, color = p.secondary)
                    Text("Waktu terima: ${sample?.receivedAt?.let { time(it) } ?: "Tidak tersedia"}", style = T.footnote, color = p.secondary)
                    val hint = when (status) {
                        SensorStatus.Ready -> null
                        SensorStatus.Waiting -> "Periksa perangkat terpasang di pot ini dan tersambung ke Wi-Fi. Untuk mengatur Wi-Fi, tekan EN lalu tahan BOOT 2 detik dan sambungkan HP ke jaringan SmartAgro di label."
                        SensorStatus.Stale -> "Periksa daya dan koneksi perangkat, lalu muat ulang."
                        SensorStatus.Unmeasured -> "Periksa apakah sensor ini tersedia pada perangkat."
                        SensorStatus.Error -> probeErrorHint(sample?.error) ?: "Periksa pemasangan sensor, lalu tunggu bacaan berikutnya."
                        SensorStatus.UntrustedClock -> "Periksa koneksi perangkat dan tunggu sinkronisasi jam."
                        SensorStatus.Revoked -> "Periksa status perangkat di Kelola produk & QR."
                        SensorStatus.Unknown -> "Muat ulang. Jika status tetap muncul, hubungi dukungan."
                    }
                    if (!demo && hint != null) {
                        Text(hint, Modifier.padding(top = 4.dp), style = T.footnote, color = p.secondary)
                    }
                }
            }
            health.battery?.let { cell ->
                Panel(Modifier.fillMaxWidth(), padding = 12.dp) {
                    Text("Baterai", style = T.headline, color = p.ink)
                    Text("%.2f V".format(java.util.Locale.forLanguageTag("id-ID"), cell.volts), style = T.subhead, color = p.ink)
                    Text("Waktu ukur: ${time(cell.at)}", style = T.footnote, color = p.secondary)
                    if (cell.volts < 3.4) {
                        Text("Baterai lemah. Periksa panel surya, charger CN3791 dan sambungan baterai.", Modifier.padding(top = 4.dp),
                            style = T.footnote, color = p.secondary)
                    }
                }
            }
        }
    }
}

@Composable internal fun RefreshAction(state: AppState, model: AgroViewModel) {
    if (state.demo) return
    if (state.busy) Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) { ActivityIndicator() }
    else BarButton(PhosphorPaths.ArrowsClockwise, "Segarkan", model::refreshCurrent)
}

/** Status messages at the top of a screen, in the interface rather than in a dialog. Practice mode has its own capsule. */
internal fun androidx.compose.foundation.lazy.LazyListScope.notices(state: AppState) {
    state.message?.let { message -> item(key = "message") { Banner(message, Modifier.padding(horizontal = 16.dp, vertical = 4.dp), state.messageIsError) } }
}

@Composable internal fun Pill(text: String, selected: Boolean, onClick: () -> Unit) {
    val p = palette
    val haptics = rememberHaptics()
    Box(Modifier.heightIn(min = 40.dp).clip(RoundedCornerShape(50)).background(if (selected) p.tint else p.fill)
        .clickable(role = Role.RadioButton) { if (!selected) haptics.tick(); onClick() }.padding(horizontal = 16.dp, vertical = 9.dp)
        .semantics { stateDescription = if (selected) "Dipilih" else "Tidak dipilih" }, contentAlignment = Alignment.Center) {
        Text(text, style = T.subhead.copy(fontWeight = FontWeight.Medium), color = if (selected) p.onTint else p.ink, maxLines = 1)
    }
}

/** The iOS search field: a filled capsule with a magnifier, the hint inside, and a clear button. */
@Composable internal fun SearchField(value: String, onChange: (String) -> Unit, hint: String, modifier: Modifier = Modifier) {
    val p = palette
    Row(modifier.fillMaxWidth().heightIn(min = 44.dp).clip(RoundedCornerShape(14.dp)).background(p.fill).padding(start = 12.dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(icon(PhosphorPaths.MagnifyingGlass), null, Modifier.size(18.dp), tint = p.secondary)
        BasicTextField(value, onChange, Modifier.weight(1f).padding(vertical = 11.dp), singleLine = true,
            textStyle = T.body.copy(color = p.ink), cursorBrush = SolidColor(p.tint),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            decorationBox = { field -> Box { if (value.isEmpty()) Text(hint, style = T.body, color = p.secondary, maxLines = 1, overflow = TextOverflow.Ellipsis); field() } })
        if (value.isNotEmpty()) BarButton(PhosphorPaths.XBold, "Hapus pencarian", { onChange("") })
    }
}

@Composable internal fun Footnote(text: String) {
    Text(text, Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp), style = T.footnote, color = palette.secondary)
}

/** An empty screen invites the next action (HIG writing). */
@Composable internal fun EmptyState(title: String, detail: String, action: String, onAction: () -> Unit) {
    val p = palette
    Column(Modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        MoistureRing(null, size = 72.dp, stroke = 6.dp) { Icon(icon(PhosphorPaths.Plant), null, Modifier.size(30.dp), tint = p.tint) }
        Text(title, style = T.title3, color = p.ink, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 16.dp))
        Text(detail, style = T.subhead, color = p.secondary, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 6.dp))
        PlainButton(action, onAction, Modifier.padding(top = 8.dp), path = PhosphorPaths.ArrowUpRight)
    }
}

@Composable internal fun RenameSheet(current: String, busy: Boolean, dismiss: () -> Unit, save: (String) -> Unit) {
    val p = palette
    var name by rememberSaveable { mutableStateOf(current) }
    val valid = name.isNotBlank() && name.trim() != current && name.length <= 80
    AgroSheet("Ubah nama", dismiss, action = "Simpan", onAction = { save(name.trim()) }, actionEnabled = valid && !busy) {
        Group {
            BasicTextField(name, { name = it.take(80) }, Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = 16.dp, vertical = 15.dp)
                .semantics { contentDescription = "Nama tanaman" }, singleLine = true, textStyle = T.body.copy(color = p.ink), cursorBrush = SolidColor(p.tint),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done))
        }
        Footnote("Nama hanya tampil di akun Anda. Kode tanaman tidak berubah.")
        PrimaryButton("Simpan nama tanaman", { save(name.trim()) }, Modifier.padding(horizontal = 16.dp, vertical = 8.dp).fillMaxWidth(), enabled = valid, busy = busy)
    }
}
