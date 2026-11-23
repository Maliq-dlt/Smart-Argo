package id.smartagro.app

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.*
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.roundToInt

private val CARE_KINDS = listOf(
    "watering" to "Siram",
    "fertilizing" to "Pupuk",
    "inspection" to "Periksa",
    "note" to "Catatan",
)
private val ID = Locale.forLanguageTag("id-ID")
private val dayMonth = DateTimeFormatter.ofPattern("d MMMM", ID)
private val dayTime = DateTimeFormatter.ofPattern("d MMM, HH.mm", ID)

/** Mean of the trusted readings of [sensor] in each of [n] equal slices of [from, to); null where a slice has none. */
internal fun buckets(readings: List<Reading>, sensor: Sensor, from: Instant, to: Instant, n: Int): List<Double?> {
    val span = Duration.between(from, to).toMillis().coerceAtLeast(1)
    val sums = DoubleArray(n)
    val counts = IntArray(n)
    for (r in readings) {
        val v = r.value ?: continue
        if (r.sensor != sensor || r.quality != "ok" || r.at.isBefore(from) || !r.at.isBefore(to)) continue
        val i = (Duration.between(from, r.at).toMillis() * n / span).toInt().coerceIn(0, n - 1)
        sums[i] += v; counts[i]++
    }
    return List(n) { if (counts[it] == 0) null else sums[it] / counts[it] }
}

/** The loaded window; practice scenarios hold a short span, so their axis spans the data instead of a full day. */
private fun chartWindow(state: AppState): HistoryWindow? = state.historyChartWindow ?: if (state.demo) {
    state.history.minOfOrNull { it.at }?.let { first -> HistoryWindow(first, state.history.maxOf { it.at }.plusSeconds(1)) }
} else null

private fun slices(range: HistoryRange) = if (range == HistoryRange.Day) 48 else 56

private fun axisFor(window: HistoryWindow, range: HistoryRange, live: Boolean): List<Pair<Float, String>> = when {
    range == HistoryRange.Week && live -> listOf(0f to "7 hari lalu", 3f / 7 to "4 hari lalu", 1f to "Hari ini")
    else -> listOf(0f, 1f / 3, 2f / 3, 1f).map { f ->
        val at = window.from.plusMillis((Duration.between(window.from, window.to).toMillis() * f).toLong())
        f to if (f == 1f && live) "Sekarang" else hhmm(at)
    }
}

/** Colour follows meaning: ochre for dry or hot or pH outside its range, blue for too wet; the rest is neutral. */
private fun barColor(p: Palette, sensor: Sensor, v: Double, ref: Reference?): Color = when {
    ref == null -> p.secondary
    sensor == Sensor.Moisture && v < ref.low -> p.dryInk
    sensor == Sensor.Moisture && v >= ref.wet -> p.wetInk
    sensor == Sensor.Temperature && v >= ref.hotC -> p.dryInk
    sensor == Sensor.Ph && v !in ref.ph -> p.dryInk
    else -> p.secondary
}

/**
 * Hairline bars from the floor of the scale, with the reference range as a pale band behind them. With [selected], a
 * reading dot sits on that bar's top with a guide line: it glides between bars (a critically damped spring, no
 * overshoot), and while [reading] its value shows above it. The bars themselves never change colour under the finger.
 */
@Composable internal fun ThinBars(values: List<Double?>, sensor: Sensor, ref: Reference?, height: Dp, modifier: Modifier = Modifier,
                                  selected: Int? = null, reading: Boolean = false) {
    val p = palette
    val scale = scaleOf(sensor)
    val at by animateFloatAsState(selected?.toFloat() ?: 0f, Springs.snappy(), label = "Titik baca")
    val shown by animateFloatAsState(if (reading) 1f else 0f, tween(200), label = "Label baca")
    val measurer = rememberTextMeasurer()
    val label = selected?.let { values.getOrNull(it) }?.let { v ->
        measurer.measure("${formatValue(sensor, v)}${unitOf(sensor)}", T.footnote.copy(color = p.canvas, fontWeight = FontWeight.SemiBold))
    }
    Canvas(modifier.fillMaxWidth().height(height)) {
        val n = values.size.coerceAtLeast(1)
        val gap = size.width / n
        val bw = max(1.2.dp.toPx(), gap * .42f)
        fun y(v: Double) = size.height - tapeFraction(v, scale) * size.height
        bandOf(sensor, ref)?.let { b -> drawRoundRect(p.band, Offset(0f, y(b.endInclusive)), Size(size.width, y(b.start) - y(b.endInclusive)), CornerRadius(4.dp.toPx())) }
        values.forEachIndexed { i, v ->
            if (v != null) {
                val top = y(v).coerceAtMost(size.height - 2.dp.toPx())
                drawRoundRect(barColor(p, sensor, v, ref), Offset(i * gap + (gap - bw) / 2, top), Size(bw, size.height - top), CornerRadius(bw / 2))
            }
        }
        val target = selected?.let { values.getOrNull(it) } ?: return@Canvas
        // Between two bars the dot's height follows the line joining their tops; an empty bar holds the selected value.
        val lo = floor(at).toInt().coerceIn(0, n - 1)
        val a = values[lo] ?: target
        val b = values.getOrNull(lo + 1) ?: a
        val cx = at * gap + gap / 2
        val cy = y(a + (b - a) * (at - lo)).coerceIn(0f, size.height)
        drawLine(p.ink.copy(alpha = .3f), Offset(cx, 0f), Offset(cx, size.height), 1.dp.toPx())
        drawCircle(p.canvas, 5.5.dp.toPx(), Offset(cx, cy))
        drawCircle(p.ink, 5.5.dp.toPx(), Offset(cx, cy), style = Stroke(2.5.dp.toPx()))
        if (label != null && shown > 0f) {
            val pad = 8.dp.toPx()
            val w = label.size.width + pad * 2
            val h = label.size.height + pad
            val left = (cx - w / 2).coerceIn(0f, size.width - w)
            val top = (cy - h - 10.dp.toPx()).coerceAtLeast(0f)
            drawRoundRect(p.ink.copy(alpha = shown), Offset(left, top), Size(w, h), CornerRadius(h / 2))
            drawText(label, topLeft = Offset(left + pad, top + pad / 2), alpha = shown)
        }
    }
}

private fun unitOf(sensor: Sensor) = when (sensor) { Sensor.Moisture -> "/100"; Sensor.Temperature -> " °C"; Sensor.Ph -> " pH" }

private fun nearest(values: List<Double?>, i: Int): Int? = values.indices.filter { values[it] != null }.minByOrNull { abs(it - i) }

/** A sensor's history, large: one bar is read out at a time and the finger moves along the bars (no motion of its own). */
@Composable internal fun ChartSheet(state: AppState, model: AgroViewModel, sensor: Sensor, ref: Reference?, onDismiss: () -> Unit) {
    val p = palette
    val haptics = rememberHaptics()
    val window = chartWindow(state)
    val values = remember(state.history, sensor, window, state.historyRange) {
        window?.let { buckets(state.history, sensor, it.from, it.to, slices(state.historyRange)) }.orEmpty()
    }
    // At rest the dot sits on the newest reading; a finger moves it, and lifting the finger sends it back (2026-11-24).
    val newest = nearest(values, values.size - 1)
    var picked by remember(values) { mutableStateOf(newest) }
    var pressing by remember { mutableStateOf(false) }
    var dragging by remember { mutableStateOf(false) }
    val pick: (Float, Float) -> Unit = { x, width ->
        val i = nearest(values, (x / width * (values.size - 1)).roundToInt())
        if (i != picked) { haptics.tick(); picked = i }
    }
    val rest = { pressing = false; picked = newest }
    AgroSheet(sensor.label, onDismiss) {
        Column(Modifier.padding(horizontal = 16.dp)) {
            Segmented(HistoryRange.entries.map { it.label }, state.historyRange.ordinal, { model.selectHistoryRange(HistoryRange.entries[it]) })
            val i = picked
            val at = if (window != null && i != null) window.from.plusMillis(Duration.between(window.from, window.to).toMillis() * (2 * i + 1) / (2L * values.size)) else null
            Row(Modifier.padding(top = 18.dp, start = 4.dp), verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(i?.let { values[it] }?.let { formatValue(sensor, it) } ?: "—", style = T.figure, color = p.ink)
                Text(when (sensor) { Sensor.Moisture -> "/100"; Sensor.Temperature -> "°C"; Sensor.Ph -> "pH" }, style = T.headline, color = p.secondary,
                    modifier = Modifier.padding(bottom = 8.dp))
                Spacer(Modifier.weight(1f))
                at?.let { Text(if (state.historyRange == HistoryRange.Day) hhmm(it) else dayTime.format(it.atZone(ZoneId.systemDefault())),
                    style = T.subhead, color = p.secondary, modifier = Modifier.padding(bottom = 8.dp)) }
            }
            Column(Modifier.padding(top = 8.dp).clip(RoundedCornerShape(20.dp)).background(p.cell).padding(14.dp)) {
                if (window == null || values.all { it == null }) Text("Belum ada bacaan pada rentang ini.", style = T.subhead, color = p.secondary)
                else {
                    ThinBars(values, sensor, ref, 170.dp, Modifier
                        // A press reads at once; when it turns into a horizontal drag the drag takes over, and the dot only
                        // goes back when the finger lifts (or the sheet's scroll takes the gesture).
                        .pointerInput(values) {
                            detectTapGestures(onPress = {
                                pressing = true; pick(it.x, size.width.toFloat())
                                val released = tryAwaitRelease()
                                if (released || !dragging) rest()
                            })
                        }
                        .pointerInput(values) {
                            detectHorizontalDragGestures(
                                onDragStart = { dragging = true; pressing = true; pick(it.x, size.width.toFloat()) },
                                onDragEnd = { dragging = false; rest() },
                                onDragCancel = { dragging = false; rest() },
                            ) { c, _ -> c.consume(); pick(c.position.x, size.width.toFloat()) }
                        }
                        .semantics {
                            contentDescription = "Telusuri bacaan ${sensor.label}"
                            stateDescription = i?.let { values[it] }?.let { formatValue(sensor, it) }.orEmpty()
                            progressBarRangeInfo = ProgressBarRangeInfo((i ?: 0).toFloat(), 0f..(values.size - 1).toFloat(), values.size - 2)
                            setProgress { target -> picked = nearest(values, target.roundToInt()); true }
                        }, selected = i, reading = pressing)
                    AxisLabels(axisFor(window, state.historyRange, !state.demo))
                }
            }
            val band = bandOf(sensor, ref)
            Text(when {
                band == null -> "Spesies ini belum punya rentang acuan. Geser grafik untuk membaca tiap rata-rata."
                sensor == Sensor.Temperature -> "Area hijau muda berada di bawah batas panas ${formatValue(sensor, band.endInclusive)} °C. Tiap batang adalah rata-rata bacaan."
                else -> "Area hijau muda adalah rentang acuan ${formatValue(sensor, band.start)}–${formatValue(sensor, band.endInclusive)}. Tiap batang adalah rata-rata bacaan."
            }, style = T.footnote, color = p.secondary, modifier = Modifier.padding(top = 10.dp, start = 4.dp, end = 4.dp))
            if (state.historyHasMore) PlainButton("Muat bacaan lebih lama", model::loadOlderHistory, Modifier.padding(top = 4.dp), enabled = !state.busy)
        }
    }
}

/**
 * Aktivitas: which plant, one range control, three small charts and the journal by day. Exports and the week-to-week
 * comparison stay as rows at the end.
 */
@Composable
internal fun ActivityScreen(state: AppState, model: AgroViewModel) {
    val p = palette
    val context = LocalContext.current
    val unit = state.selectedUnit ?: state.units.firstOrNull()
    var journaling by rememberSaveable { mutableStateOf(false) }
    var practice by rememberSaveable { mutableStateOf(false) }
    var chart by rememberSaveable { mutableStateOf<Sensor?>(null) }
    val saveCsvLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/csv")) { uri: Uri? -> model.finishCsvDocument(uri) }
    LaunchedEffect(unit?.id) { if (state.selectedUnit == null && unit != null) model.selectUnit(unit) }
    LaunchedEffect(unit?.id, state.demo, state.email) {
        if (!state.demo && state.email.isNotBlank() && unit != null && (!state.careLoaded || state.careUnitId != unit.id)) model.loadCareJournal(unit.id)
    }
    val now = rememberNow()
    val h = unit?.let { health(state, it, now) }
    val species = unit?.let { u -> state.garden?.plants?.firstOrNull { it.unitId == u.id && it.endedOn == null }?.let { SpeciesCatalog.byCode(it.species) } ?: SpeciesCatalog.ofCrop(u.crop) }
    val ref = species?.takeIf { it.curated }?.let { referenceFor(it.speciesId) }
    val week = { val to = Instant.now(); HistoryWindow(to.minus(7, ChronoUnit.DAYS), to) }

    TitledScreen("Aktivitas", accessory = if (state.demo) ({ PracticeCapsule({ practice = true }) }) else null, actions = {
        if (unit != null) BarButton(PhosphorPaths.PlusBold, "Catat perawatan", { journaling = true }, enabled = !state.busy)
        RefreshAction(state, model)
    }) {
        notices(state)
        if (unit == null || h == null) {
            item { Footnote("Belum ada tanaman dengan perangkat aktif. Tambahkan atau pilih dari tab Tanaman.") }
            return@TitledScreen
        }
        item(key = "picker") { PlantPicker(state, unit) { model.selectUnit(it) } }
        item(key = "range") {
            Box(Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) {
                Segmented(HistoryRange.entries.map { it.label }, state.historyRange.ordinal, { model.selectHistoryRange(HistoryRange.entries[it]) })
            }
        }
        val window = chartWindow(state)
        if (!state.historyLoaded || window == null) item(key = "loading") {
            if (state.busy || state.message == null) Footnote("Memuat bacaan ${state.historyRange.label}…")
            PlainButton("Muat riwayat sensor", model::loadHistory, Modifier.padding(horizontal = 8.dp), enabled = !state.busy)
        } else Sensor.entries.forEach { s ->
            item(key = "chart-${s.key}") {
                val values = remember(state.history, s, window, state.historyRange) { buckets(state.history, s, window.from, window.to, slices(state.historyRange)) }
                ChartCard(s, values, h, ref, axisFor(window, state.historyRange, !state.demo)) { chart = s }
            }
        }

        val entries = state.careJournal.filter { it.unitId == unit.id }.sortedByDescending { it.observedAt }
        item(key = "journal-title") { SectionTitle("Jurnal") }
        if (entries.isEmpty()) item(key = "journal-empty") {
            when {
                state.careLoaded || state.demo -> Footnote("Belum ada catatan perawatan. Ketuk + untuk mencatat siram, pupuk, atau pemeriksaan.")
                state.busy -> Footnote("Memuat catatan perawatan…")
                else -> PlainButton("Muat catatan perawatan", { model.loadCareJournal(unit.id) }, Modifier.padding(horizontal = 8.dp))
            }
        } else entries.groupBy { it.observedAt.atZone(ZoneId.systemDefault()).toLocalDate() }.forEach { (day, rows) ->
            item(key = "jday-$day") {
                Text(dayLabel(day), Modifier.padding(start = 20.dp, end = 20.dp, top = 6.dp, bottom = 6.dp), style = T.subhead.copy(fontWeight = FontWeight.SemiBold), color = p.secondary)
                Group(inset = 62.dp, modifier = Modifier.padding(bottom = 10.dp)) { rows.forEach { JournalRow(it) } }
            }
        }
        if (state.careNext != null) item(key = "older-care") { PlainButton("Muat catatan lebih lama", model::loadOlderCareJournal, Modifier.padding(horizontal = 8.dp), enabled = !state.busy) }

        if (!state.demo) item(key = "data") {
            SectionTitle("Data")
            Group(inset = 60.dp) {
                Cell("Bandingkan 7 hari", subtitle = "Rata-rata minggu ini terhadap minggu lalu", glyph = PhosphorPaths.ChartLine, glyphColor = p.secondary, enabled = !state.busy,
                    onClick = { val second = week(); model.compareMeasurements(unit.id, HistoryWindow(second.from.minus(7, ChronoUnit.DAYS), second.from), second) })
                Cell("Simpan CSV 7 hari", glyph = PhosphorPaths.DownloadSimple, glyphColor = p.secondary, enabled = !state.busy, onClick = {
                    model.exportMeasurementsCsv(unit.id, week()) { csv -> model.prepareCsvDocument(csv); saveCsvLauncher.launch("smart-agro-${state.plantCode(unit)}.csv") }
                })
                Cell("Bagikan CSV 7 hari", glyph = PhosphorPaths.ShareNetwork, glyphColor = p.secondary, enabled = !state.busy, onClick = {
                    model.exportMeasurementsCsv(unit.id, week()) { csv -> shareTextFile(context, "smart-agro-${state.plantCode(unit)}.csv", "text/csv", "Data sensor ${unit.name}", csv.content) }
                })
            }
            state.historyComparison?.takeIf { state.comparisonUnitId == unit.id }?.let { cmp ->
                SectionTitle("Minggu ini dan minggu lalu")
                Group(footer = "Dihitung pada ${time(cmp.snapshot)}") {
                    cmp.sensors.forEach { sc ->
                        Cell(sc.sensor.label, chevron = false,
                            subtitle = "Minggu ini ${sc.second.avg?.let { number(it) } ?: "—"} · lalu ${sc.first.avg?.let { number(it) } ?: "—"} (${sc.second.eligible}/${sc.second.total} sah)",
                            value = sc.avgDelta?.let { (if (it >= 0) "+" else "") + "${number(it)} ${sc.sensor.unit}" } ?: "—")
                    }
                }
            }
        }
    }

    if (journaling && unit != null) CareJournalSheet(unit, state, model) { journaling = false }
    chart?.let { s -> ChartSheet(state, model, s, ref) { chart = null } }
    if (practice) PracticeSheet({ practice = false; model.logout() }) { practice = false }
}

private fun dayLabel(day: LocalDate): String = when (day) {
    LocalDate.now() -> "Hari ini"
    LocalDate.now().minusDays(1) -> "Kemarin"
    else -> dayMonth.format(day)
}

/** The plant this tab shows, as a pull-down button under the title (HIG pull-down: a menu of choices that sets context). */
@Composable private fun PlantPicker(state: AppState, unit: PlantUnit, onPick: (PlantUnit) -> Unit) {
    val p = palette
    var open by remember { mutableStateOf(false) }
    val many = state.units.size > 1
    Box(Modifier.padding(horizontal = 12.dp)) {
        Row(Modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(12.dp)).then(if (many) Modifier.clickable(role = Role.DropdownList, onClickLabel = "Pilih tanaman") { open = true } else Modifier)
            .padding(horizontal = 8.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Text("${unit.name} · ${state.plantCode(unit)}", style = T.headline, color = if (many) p.tint else p.ink)
            if (many) Icon(icon(PhosphorPaths.CaretRightBold), null, Modifier.size(14.dp).rotate(90f), tint = p.tint)
        }
        DropdownMenu(open, { open = false }, containerColor = p.raised, shape = RoundedCornerShape(16.dp)) {
            state.units.forEach { u ->
                DropdownMenuItem(text = { Column { Text(u.name, style = T.body, color = p.ink); Text(state.plantCode(u), style = T.footnote, color = p.secondary) } },
                    onClick = { open = false; if (u.id != unit.id) onPick(u) },
                    trailingIcon = if (u.id == unit.id) ({ Icon(icon(PhosphorPaths.CheckBold), "Dipilih", Modifier.size(16.dp), tint = p.tint) }) else null)
            }
        }
    }
}

@Composable private fun ChartCard(sensor: Sensor, values: List<Double?>, h: Health, ref: Reference?, axis: List<Pair<Float, String>>, onOpen: () -> Unit) {
    val p = palette
    val value = h.value(sensor)
    val word = when (sensor) {
        Sensor.Moisture -> moistureWord(value, ref).takeIf { value != null }
        Sensor.Temperature -> temperatureWord(value, ref)
        Sensor.Ph -> phWord(value, ref)
    }
    Column(Modifier.padding(horizontal = 16.dp, vertical = 6.dp).fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(p.cell)
        .clickable(role = Role.Button, onClickLabel = "Buka grafik", onClick = onOpen).padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 12.dp)
        .semantics(mergeDescendants = true) { }) {
        Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(Modifier.weight(1f)) {
                Text(sensor.label, style = T.body.copy(fontWeight = FontWeight.Medium), color = p.ink)
                word?.let { Text(it.text, style = T.subhead.copy(fontWeight = FontWeight.Medium), color = toneColor(it.tone)) }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(value?.let { formatValue(sensor, it) } ?: "—", style = T.title3, color = p.ink)
                Icon(icon(PhosphorPaths.CaretRightBold), null, Modifier.padding(start = 8.dp).size(14.dp), tint = p.tertiary)
            }
        }
        if (values.all { it == null }) Text("Belum ada bacaan pada rentang ini.", style = T.footnote, color = p.secondary, modifier = Modifier.padding(top = 10.dp))
        else {
            ThinBars(values, sensor, ref, 64.dp, Modifier.padding(top = 12.dp).clearAndSetSemantics { })
            AxisLabels(axis)
        }
    }
}

@Composable private fun JournalRow(entry: CareEntry) {
    val p = palette
    val label = CARE_KINDS.find { it.first == entry.kind }?.second ?: entry.kind
    val (path, color) = when (entry.kind) {
        "watering" -> PhosphorPaths.Drop to p.water
        "fertilizing" -> PhosphorPaths.Flask to p.secondary
        "inspection" -> PhosphorPaths.Leaf to p.leaf
        else -> PhosphorPaths.Notebook to p.secondary
    }
    Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = 16.dp, vertical = 11.dp).semantics(mergeDescendants = true) { },
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Box(Modifier.size(32.dp).clip(CircleShape).background(color.copy(alpha = .14f)), contentAlignment = Alignment.Center) {
            Icon(icon(path), null, Modifier.size(17.dp), tint = color)
        }
        Column(Modifier.weight(1f)) {
            Text(label + (entry.amountMl?.let { " ${it.toInt()} mL" } ?: ""), style = T.body, color = p.ink)
            if (entry.notes.isNotBlank()) Text(entry.notes, style = T.subhead, color = p.secondary, modifier = Modifier.padding(top = 2.dp))
        }
        Text(hhmm(entry.observedAt), style = T.subhead, color = p.secondary)
    }
}

@Composable
private fun CareJournalSheet(unit: PlantUnit, state: AppState, model: AgroViewModel, dismiss: () -> Unit) {
    var kindIdx by rememberSaveable { mutableIntStateOf(0) }
    var amountRaw by rememberSaveable { mutableStateOf("150") }
    var notes by rememberSaveable { mutableStateOf("") }
    val kind = CARE_KINDS[kindIdx].first
    val amount = if (kind == "watering") amountRaw.replace(',', '.').toDoubleOrNull() else null
    val valid = !state.busy && when (kind) {
        "watering" -> amount != null && amount > 0.0 && amount <= 100000.0
        "note" -> notes.trim().isNotEmpty()
        else -> true
    }
    AgroSheet("Catat untuk ${unit.name}", dismiss) {
        Column(Modifier.padding(horizontal = 16.dp)) {
            Segmented(CARE_KINDS.map { it.second }, kindIdx, { kindIdx = it })
        }
        Spacer(Modifier.height(12.dp))
        Group {
            if (kind == "watering") {
                FieldRow("Takaran (mL)", amountRaw, { amountRaw = it.take(10) }, "150", keyboard = KeyboardType.Decimal, enabled = !state.busy)
            }
            FieldRow(
                if (kind == "note") "Catatan" else "Catatan opsional",
                notes,
                { notes = it.take(500) },
                if (kind == "inspection") "Misal [sehat] daun segar" else "Keterangan singkat",
                ime = ImeAction.Done,
                singleLine = false,
                enabled = !state.busy,
            )
        }
        PrimaryButton(
            if (state.busy) "Menyimpan…" else "Simpan catatan",
            { model.recordCare(unit.id, kind, Instant.now(), amount, notes, dismiss) },
            Modifier.padding(16.dp).fillMaxWidth(),
            enabled = valid,
            busy = state.busy,
        )
    }
}
