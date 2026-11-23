package id.smartagro.app

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import java.util.Locale
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin

/* "Garis ukur": every measurement is drawn as ticks on a ruler, with the reference range shaded and one needle for the
 * value. Color follows meaning (ochre = dry or hot, earth = within range, blue = wet or cold); green is kept for
 * actions and selection. The only motion is the needle gliding to a new value (450 ms, ease-out), so a change is seen
 * and its direction is readable. Dragging the day ruler follows the finger with no extra animation. */

private val ID = Locale.forLanguageTag("id-ID")
private val EaseOut = CubicBezierEasing(.2f, .8f, .2f, 1f)

/**
 * Reference ranges for curated species, the same prototype calibration the web engine reads from
 * `src/lib/scenarios.json`: moisture low = median(needs_water), wet = median(drained) + 10, heat limit `hot_c`,
 * pH `ph_range`. Learning species have no reference, so they get no status words and no advice.
 */
internal data class Reference(val low: Double, val wet: Double, val hotC: Double = 34.0, val ph: ClosedFloatingPointRange<Double> = 5.8..6.8)
internal fun referenceFor(speciesId: Int): Reference? = when (speciesId) {
    1 -> Reference(39.0, 88.0)
    2 -> Reference(28.0, 81.0)
    else -> null
}

internal enum class Tone { Dry, Ok, Wet, Learn }
internal data class Word(val text: String, val tone: Tone)

/** The status word for the index. "Mulai kering" marks the last ten points above the low threshold. */
internal fun moistureWord(value: Double?, ref: Reference?): Word? = when {
    ref == null -> Word("Mengamati", Tone.Learn)
    value == null -> null
    value < ref.low -> Word("Kering", Tone.Dry)
    value < ref.low + 10 -> Word("Mulai kering", Tone.Dry)
    value >= ref.wet -> Word("Basah", Tone.Wet)
    else -> Word("Cukup", Tone.Ok)
}
internal fun temperatureWord(value: Double?, ref: Reference?): Word? = when {
    value == null || ref == null -> null
    value >= ref.hotC -> Word("Panas", Tone.Dry)
    else -> Word("Di bawah batas panas", Tone.Ok)
}
internal fun phWord(value: Double?, ref: Reference?): Word? = when {
    value == null || ref == null -> null
    value < ref.ph.start -> Word("Asam", Tone.Dry)
    value > ref.ph.endInclusive -> Word("Basa", Tone.Wet)
    else -> Word("Sesuai", Tone.Ok)
}
@Composable internal fun toneColor(tone: Tone): Color = palette.let { p ->
    when (tone) { Tone.Dry -> p.dryInk; Tone.Ok -> p.okInk; Tone.Wet -> p.wetInk; Tone.Learn -> p.secondary }
}

internal data class Scale(val min: Double, val max: Double, val step: Double, val major: Double, val labels: List<Double>, val compactStep: Double)
internal val MoistureScale = Scale(0.0, 100.0, 2.0, 10.0, listOf(20.0, 40.0, 60.0, 80.0), 5.0)
internal val TemperatureScale = Scale(15.0, 40.0, 1.0, 5.0, listOf(20.0, 25.0, 30.0, 35.0), 2.5)
internal val PhScale = Scale(4.0, 9.0, .1, .5, listOf(5.0, 6.0, 7.0, 8.0), .5)
internal fun scaleOf(sensor: Sensor) = when (sensor) { Sensor.Moisture -> MoistureScale; Sensor.Temperature -> TemperatureScale; Sensor.Ph -> PhScale }
internal fun bandOf(sensor: Sensor, ref: Reference?): ClosedFloatingPointRange<Double>? = ref?.let {
    when (sensor) { Sensor.Moisture -> it.low..it.wet; Sensor.Temperature -> TemperatureScale.min..it.hotC; Sensor.Ph -> it.ph }
}
internal fun formatValue(sensor: Sensor, value: Double): String =
    if (sensor == Sensor.Moisture) value.roundToInt().toString() else String.format(ID, "%.1f", value)

internal fun tapeFraction(v: Double, s: Scale) = ((v - s.min) / (s.max - s.min)).toFloat().coerceIn(0f, 1f)
private fun onMajor(v: Double, major: Double) = abs(v / major - (v / major).roundToInt()) < 1e-6

/**
 * A measuring tape: ticks, the shaded reference range and a needle. [description] is what TalkBack reads, since the
 * drawing itself carries no text. Compact tapes (tiles) draw fewer ticks and no labels.
 */
@Composable internal fun MeasureTape(value: Double?, scale: Scale, band: ClosedFloatingPointRange<Double>?, description: String,
                                     modifier: Modifier = Modifier, compact: Boolean = false) {
    val p = palette
    val needle by animateFloatAsState(value?.let { tapeFraction(it, scale) } ?: 0f, tween(450, easing = EaseOut), label = "Jarum pita ukur")
    Column(modifier.fillMaxWidth().semantics { contentDescription = description }) {
        Canvas(Modifier.fillMaxWidth().height(if (compact) 16.dp else 26.dp)) {
            val pad = 2.dp.toPx()
            val w = size.width - pad * 2
            fun x(v: Double) = pad + tapeFraction(v, scale) * w
            band?.let { drawRoundRect(p.band, Offset(x(it.start), 0f), Size(x(it.endInclusive) - x(it.start), size.height), CornerRadius(3.dp.toPx())) }
            val step = if (compact) scale.compactStep else scale.step
            var i = 0
            while (true) {
                val v = scale.min + i++ * step
                if (v > scale.max + 1e-6) break
                val major = onMajor(v, scale.major)
                val h = size.height * if (major) .62f else .36f
                drawLine(if (major) p.secondary else p.tertiary, Offset(x(v), size.height - h), Offset(x(v), size.height), 1.dp.toPx())
            }
            if (value != null) {
                val nx = pad + needle * w
                drawLine(p.ink, Offset(nx, -3.dp.toPx()), Offset(nx, size.height + 1.dp.toPx()), 2.5.dp.toPx(), StrokeCap.Round)
            }
        }
        if (!compact) AxisLabels(scale.labels.map { tapeFraction(it, scale) to it.roundToInt().toString() })
    }
}

/** Labels centered under their tick, kept inside the row; they scale with the system text size. */
@Composable internal fun AxisLabels(labels: List<Pair<Float, String>>, modifier: Modifier = Modifier) {
    val p = palette
    Layout({ labels.forEach { Text(it.second, style = T.caption, color = p.secondary) } }, modifier.fillMaxWidth().padding(top = 4.dp).clearAndSetSemantics { }) { ms, c ->
        val placed = ms.map { it.measure(c.copy(minWidth = 0)) }
        layout(c.maxWidth, placed.maxOfOrNull { it.height } ?: 0) {
            placed.forEachIndexed { i, pl -> pl.place((labels[i].first * c.maxWidth - pl.width / 2f).roundToInt().coerceIn(0, (c.maxWidth - pl.width).coerceAtLeast(0)), 0) }
        }
    }
}

internal fun phaseAt(phases: List<PhaseSpec>, day: Int) = phases.lastOrNull { day >= it.start }?.name ?: phases.firstOrNull()?.name.orEmpty()

/**
 * The day ruler: one tick per day, a longer one every ten, chapters for the growth phases and a needle that follows the
 * finger. Changing the day only redraws the illustration; readings never change. A tick haptic marks a new chapter.
 */
@Composable internal fun DayRuler(day: Int, today: Int, maxDay: Int, phases: List<PhaseSpec>, onDay: (Int) -> Unit, modifier: Modifier = Modifier) {
    val p = palette
    val haptics = rememberHaptics()
    val current by rememberUpdatedState(day)
    val set: (Float, Float) -> Unit = { x, width ->
        val d = (x / width * maxDay).roundToInt().coerceIn(0, maxDay)
        if (d != current) {
            if (phaseAt(phases, d) != phaseAt(phases, current)) haptics.tick()
            onDay(d)
        }
    }
    val segments = phases.mapIndexed { i, ph -> Triple(ph, ph.start, if (i + 1 < phases.size) phases[i + 1].start else maxDay + 1) }
    Column(modifier.fillMaxWidth()) {
        Canvas(Modifier.fillMaxWidth().height(34.dp)
            .pointerInput(maxDay) { detectTapGestures { set(it.x, size.width.toFloat()) } }
            .pointerInput(maxDay) { detectHorizontalDragGestures(onDragStart = { set(it.x, size.width.toFloat()) }) { change, _ -> change.consume(); set(change.position.x, size.width.toFloat()) } }
            .semantics {
                contentDescription = "Umur tanaman untuk ilustrasi"
                stateDescription = "Hari ke-$day, ${phaseAt(phases, day)}"
                progressBarRangeInfo = ProgressBarRangeInfo(day.toFloat(), 0f..maxDay.toFloat(), maxDay - 1)
                setProgress { target -> onDay(target.roundToInt().coerceIn(0, maxDay)); true }
            }) {
            val pad = 2.dp.toPx()
            val w = size.width - pad * 2
            fun x(d: Int) = pad + d / maxDay.toFloat() * w
            val u = size.height / 34f
            for (d in 0..maxDay) {
                val major = d % 10 == 0
                drawLine(if (major) p.secondary else p.tertiary, Offset(x(d), (if (major) 8f else 14f) * u), Offset(x(d), 22f * u), 1.dp.toPx())
            }
            drawLine(p.tint, Offset(x(today), 4f * u), Offset(x(today), 22f * u), 2.dp.toPx(), StrokeCap.Round)
            for ((_, start, end) in segments) {
                val on = day in start until end
                drawRoundRect(if (on) p.tint else p.fill, Offset(x(start), 27f * u), Size((x(end) - x(start) - 2.dp.toPx()).coerceAtLeast(1f), 4f * u), CornerRadius(2f * u))
            }
            drawLine(p.ink, Offset(x(day), 0f), Offset(x(day), 23f * u), 2.5.dp.toPx(), StrokeCap.Round)
        }
        val wide = segments.filter { (_, s, e) -> (e - s) / (maxDay + 1f) > .14f }
        Layout({ wide.forEach { (ph, _, _) -> Text(ph.name, style = T.caption, color = p.secondary, maxLines = 2) } },
            Modifier.fillMaxWidth().padding(top = 4.dp).clearAndSetSemantics { }) { ms, c ->
            val placed = ms.mapIndexed { i, m ->
                val (_, s, e) = wide[i]
                m.measure(c.copy(minWidth = 0, maxWidth = ((e - s) / (maxDay + 1f) * c.maxWidth).roundToInt().coerceAtLeast(1)))
            }
            layout(c.maxWidth, placed.maxOfOrNull { it.height } ?: 0) {
                placed.forEachIndexed { i, pl -> pl.place((wide[i].second / (maxDay + 1f) * c.maxWidth).roundToInt(), 0) }
            }
        }
    }
}

internal enum class CareMark { Water, Check, None }

/** One tick per day of the cycle: watered, another care note, or nothing recorded. Only what the journal holds. */
@Composable internal fun CareStrip(marks: List<CareMark>, modifier: Modifier = Modifier) {
    val p = palette
    Column(modifier.fillMaxWidth()) {
        Canvas(Modifier.fillMaxWidth().height(26.dp).clearAndSetSemantics { }) {
            val gap = size.width / maxOf(marks.size, 30)
            marks.forEachIndexed { i, m ->
                val (color, h) = when (m) { CareMark.Water -> p.water to 22f; CareMark.Check -> p.secondary to 14f; CareMark.None -> p.tertiary to 6f }
                val x = i * gap + 2.dp.toPx()
                drawLine(color, Offset(x, size.height - h.dp.toPx()), Offset(x, size.height), 2.2.dp.toPx(), StrokeCap.Round)
            }
        }
        Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            for ((label, color, h) in listOf(Triple("Siram", p.water, 10.dp), Triple("Catatan lain", p.secondary, 10.dp), Triple("Tidak ada catatan", p.tertiary, 5.dp)))
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    Box(Modifier.size(3.dp, h).clip(RoundedCornerShape(2.dp)).background(color))
                    Text(label, style = T.footnote, color = p.secondary)
                }
        }
    }
}

private val pathCache = HashMap<String, Path>()
private fun path(d: String) = pathCache.getOrPut(d) { PathParser().parsePathString(d).toPath() }
private const val POT = "M13 32h38l-4.2 26.4a3 3 0 0 1-3 2.6H20.2a3 3 0 0 1-3-2.6z"
private const val SOIL = "M17 35h30l-3.6 22.6a1.6 1.6 0 0 1-1.6 1.4H22.2a1.6 1.6 0 0 1-1.6-1.4z"

/**
 * A small cut-away pot for the tiles: the height of the dark, wet soil is the moisture index, and the plant follows its
 * species and age and leans when the index is low. Without a reading the soil stays one color.
 */
@Composable internal fun MiniPot(speciesId: Int, day: Int?, moisture: Double?, modifier: Modifier = Modifier, size: Dp = 72.dp) {
    val p = palette
    Canvas(modifier.size(size).clearAndSetSemantics { }) {
        val s = this.size.width / 64f
        withTransform({ scale(s, s, Offset.Zero) }) { miniPot(p, speciesId, day ?: 35, moisture) }
    }
}

private fun DrawScope.miniPot(p: Palette, speciesId: Int, day: Int, m: Double?) {
    val droop = if (m == null) 0f else ((42f - m.toFloat()) / 40f).coerceIn(0f, 1f) * 24f
    when (speciesId) {
        1 -> {
            val g = minOf(1f, day / 62f)
            val h = 8f + 16f * g
            val n = 2 + (3 * g).roundToInt()
            drawPath(Path().apply { moveTo(32f, 33f); quadraticTo(31f, 33f - h / 2, 32f, 33f - h) }, p.leaf, style = Stroke(1.8f, cap = StrokeCap.Round))
            for (k in 0 until n) {
                val y = 33f - (k + 1) * h / (n + .4f)
                val r = 4.2f + 2.6f * g - k * .3f
                for (side in listOf(-1, 1)) rotate(side * (-28f + droop), Offset(32f, y)) {
                    drawOval(if (k % 2 == 1) p.leaf2 else p.leaf, Offset(32f + side * r * .9f - r, y - (1.6f + .9f * g)), Size(2 * r, 2 * (1.6f + .9f * g)))
                }
            }
            if (day >= 56) for (d in listOf("M27 27q-1 5 1 7", "M37 25q1 5-1 7")) drawPath(path(d), p.fruit, style = Stroke(2.4f, cap = StrokeCap.Round))
        }
        2 -> {
            val l = 9f + 15f * minOf(1f, day / 48f)
            for (a in listOf(-26f, -13f, 0f, 12f, 25f)) {
                val rad = Math.toRadians((a * (1 + droop / 30f)).toDouble())
                drawPath(Path().apply {
                    moveTo(32f, 33f)
                    quadraticTo(32f + sin(rad).toFloat() * l * .4f, 33f - l * .6f, 32f + sin(rad).toFloat() * l, 33f - cos(rad).toFloat() * l + droop * .3f)
                }, p.leaf, style = Stroke(2f, cap = StrokeCap.Round))
            }
        }
        else -> for ((a, l, c) in listOf(Triple(-24f, 12f, p.leaf), Triple(22f, 11f, p.leaf2), Triple(-6f, 8f, p.leaf))) {
            val cx = 32f + if (a < -10) -l * .5f else if (a > 10) l * .5f else 0f
            val cy = if (a > -10 && a < 10) 22f else 26f
            rotate(a, Offset(32f, 30f)) { drawOval(c, Offset(cx - l, cy - 3.6f), Size(2 * l, 7.2f)) }
        }
    }
    drawPath(path(POT), p.pot)
    clipPath(path(SOIL)) {
        drawRect(p.soilDry, Offset(10f, 34f), Size(44f, 30f))
        if (m != null) {
            val wet = 58f - 23f * m.toFloat().coerceIn(0f, 100f) / 100f
            drawRect(p.soilWet, Offset(10f, wet), Size(44f, 64f - wet))
        }
    }
    drawRoundRect(p.potRim, Offset(11.5f, 30f), Size(41f, 5f), CornerRadius(2f))
}

/** The one practice marker: a capsule by the title instead of a banner on every screen. It explains itself on tap. */
@Composable internal fun PracticeCapsule(onClick: () -> Unit, modifier: Modifier = Modifier) {
    val p = palette
    Row(modifier.heightIn(min = 32.dp).clip(RoundedCornerShape(50)).background(p.soft).clickable(role = Role.Button, onClickLabel = "Tentang mode latihan", onClick = onClick)
        .padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Icon(icon(PhosphorPaths.Info), null, Modifier.size(16.dp), tint = p.onSoft)
        Text("Latihan", style = T.footnote.copy(fontWeight = FontWeight.SemiBold), color = p.onSoft, maxLines = 1)
    }
}

@Composable internal fun PracticeSheet(onEnd: () -> Unit, onDismiss: () -> Unit) {
    val p = palette
    AgroSheet("Mode latihan", onDismiss) {
        Text("Semua tanaman, bacaan, dan saran di sini adalah data sintetis dari skenario web. Catatan yang Anda buat hanya tersimpan selama latihan.",
            Modifier.padding(horizontal = 20.dp, vertical = 8.dp), style = T.body, color = p.secondary)
        Spacer(Modifier.height(12.dp))
        Group { Cell("Akhiri latihan", destructive = true, onClick = onEnd) }
    }
}

/** A filled dot with the status word, used in tiles and rows; the word carries the meaning, the color repeats it. */
@Composable internal fun StatusWord(word: Word, modifier: Modifier = Modifier) {
    Text(word.text, modifier, style = T.subhead.copy(fontWeight = FontWeight.Medium), color = toneColor(word.tone))
}
