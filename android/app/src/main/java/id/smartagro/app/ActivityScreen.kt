package id.smartagro.app

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.Locale

private val CARE_KINDS = listOf(
    "watering" to "Siram",
    "fertilizing" to "Pupuk",
    "inspection" to "Periksa",
    "note" to "Catatan",
)

@Composable
internal fun ActivityScreen(state: AppState, model: AgroViewModel) {
    val p = palette
    val context = LocalContext.current
    val unit = state.selectedUnit ?: state.units.firstOrNull()
    var tab by rememberSaveable { mutableIntStateOf(0) }
    val readingsScroll = rememberLazyListState()
    val careScroll = rememberLazyListState()
    val comparisonScroll = rememberLazyListState()
    var sensor by rememberSaveable { mutableStateOf(state.historySensor) }
    var selectedAt by remember(unit?.id, sensor, state.historyRange) { mutableStateOf<Instant?>(null) }
    var journaling by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(state.historySensor) {
        sensor = state.historySensor
    }

    val saveCsvLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/csv")) { uri: Uri? ->
        model.finishCsvDocument(uri)
    }

    LaunchedEffect(unit?.id, tab, state.demo, state.email) {
        if (!state.demo && state.email.isNotBlank() && unit != null) {
            if (tab in 0..1 && (!state.careLoaded || state.careUnitId != unit.id)) model.loadCareJournal(unit.id)
        }
    }

    TitledScreen(
        "Riwayat sensor",
        state = when (tab) { 0 -> readingsScroll; 1 -> careScroll; else -> comparisonScroll },
        subtitle = unit?.let { "${it.name} · ${state.plantCode(it)}" } ?: "Pilih tanaman di tab Tanaman",
        actions = {
            if (unit != null) BarButton(PhosphorPaths.PlusBold, "Catat perawatan", { journaling = true }, enabled = !state.busy)
            RefreshAction(state, model)
        },
    ) {
        notices(state)
        if (state.units.size > 1) {
            item(key = "units-switch") {
                Row(
                    Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                ) {
                    state.units.forEach { u ->
                        Pill(u.name, unit?.id == u.id) { model.selectUnit(u) }
                    }
                }
            }
        }
        item(key = "activity-tabs") {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                Segmented(listOf("Riwayat", "Jurnal", "Banding"), tab, { tab = it })
            }
        }
        if (unit == null) {
            item { Footnote("Belum ada tanaman dengan perangkat aktif. Tambahkan atau pilih dari tab Tanaman.") }
        } else {
            when (tab) {
                0 -> {
                    item(key = "sensor-pills") {
                        Row(
                            Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 6.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Sensor.entries.forEach { s ->
                                Pill(s.label, sensor == s) { sensor = s; model.selectHistorySensor(s) }
                            }
                        }
                    }
                    item(key = "chart") {
                        HistoryTrend(state, model, unit.id, sensor, selectedAt = selectedAt,
                            onSelect = { selectedAt = it?.at })
                    }
                    if (!state.demo) {
                        item(key = "export") {
                            Spacer(Modifier.height(10.dp))
                            Panel {
                                Text("Ekspor bacaan", style = T.headline, color = p.ink)
                                Text("Unduh sampai 31 hari data sensor terverifikasi dalam format CSV.", style = T.subhead, color = p.secondary, modifier = Modifier.padding(top = 2.dp))
                                Row(Modifier.fillMaxWidth().padding(top = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    TintedButton(
                                        "Simpan CSV 7 hari",
                                        {
                                            val now = Instant.now()
                                            val win = HistoryWindow(now.minus(7, ChronoUnit.DAYS), now)
                                            model.exportMeasurementsCsv(unit.id, win) { csv ->
                                                model.prepareCsvDocument(csv)
                                                saveCsvLauncher.launch("smart-agro-${state.plantCode(unit)}.csv")
                                            }
                                        },
                                        Modifier.weight(1f),
                                        enabled = !state.busy,
                                        path = PhosphorPaths.DownloadSimple,
                                    )
                                    TintedButton(
                                        "Bagikan",
                                        {
                                            val now = Instant.now()
                                            val win = HistoryWindow(now.minus(7, ChronoUnit.DAYS), now)
                                            model.exportMeasurementsCsv(unit.id, win) { csv ->
                                                shareTextFile(context, "smart-agro-${state.plantCode(unit)}.csv", "text/csv", "Data sensor ${unit.name}", csv.content)
                                            }
                                        },
                                        enabled = !state.busy,
                                        path = PhosphorPaths.ShareNetwork,
                                    )
                                }
                            }
                        }
                    }
                    val shown = state.history.filter { it.sensor == sensor }
                    item(key = "readings-list-title") { SectionTitle("Bacaan ${sensor.label.lowercase(Locale.ROOT)} (${shown.size})") }
                    if (state.historyLoaded && shown.isEmpty()) {
                        item { Footnote("Belum ada bacaan untuk sensor ini pada jendela waktu yang dimuat.") }
                    } else {
                        itemsIndexed(shown, key = { index, row -> "reading-${row.id ?: index}" }) { _, r ->
                            Group {
                                val picked = selectedAt == r.at
                                Cell(
                                    reading(r.sensor, r.value),
                                    subtitle = if (picked) "Disorot di grafik · ${if (r.synced) "Terverifikasi" else "Jam belum sinkron"}"
                                        else if (r.quality == "ok") (if (r.synced) "Terverifikasi" else "Jam perangkat belum sinkron") else "Galat sensor",
                                    value = time(r.at),
                                    chevron = false,
                                    onClick = if (r.value != null && r.quality == "ok") ({ selectedAt = if (picked) null else r.at }) else null,
                                )
                            }
                        }
                    }
                    if (state.historyHasMore) {
                        item(key = "older-readings") {
                            Box(Modifier.fillMaxWidth().padding(vertical = 8.dp), contentAlignment = Alignment.Center) {
                                PlainButton("Muat bacaan lebih lama", model::loadOlderHistory, enabled = !state.busy)
                            }
                        }
                    }
                }
                1 -> {
                    item(key = "care-action") {
                        Panel {
                            Text("Catatan perawatan pot", style = T.headline, color = p.ink)
                            Text("Catat siraman, pemupukan, dan hasil pemeriksaan agar pola pot makin akurat.", style = T.subhead, color = p.secondary, modifier = Modifier.padding(top = 2.dp))
                            PrimaryButton("Catat perawatan baru", { journaling = true }, Modifier.padding(top = 12.dp).fillMaxWidth(), enabled = !state.busy, path = PhosphorPaths.PlusBold)
                        }
                    }
                    val entries = state.careJournal.filter { it.unitId == unit.id }
                    item(key = "care-title") { SectionTitle("Riwayat jurnal (${entries.size})") }
                    if (entries.isEmpty()) {
                        item(key = "care-empty") {
                            when {
                                state.careLoaded || state.demo -> Footnote("Belum ada catatan perawatan untuk tanaman ini.")
                                state.busy -> Footnote("Memuat catatan perawatan…")
                                else -> PlainButton("Muat catatan perawatan", { model.loadCareJournal(unit.id) })
                            }
                        }
                    } else {
                        items(entries, key = { it.id }) { entry ->
                            val label = CARE_KINDS.find { it.first == entry.kind }?.second ?: entry.kind
                            Panel(Modifier.padding(bottom = 8.dp)) {
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                                    Text(label + (entry.amountMl?.let { " ${it.toInt()} mL" } ?: ""), style = T.headline, color = p.ink)
                                    Text(time(entry.observedAt), style = T.footnote, color = p.secondary)
                                }
                                if (entry.notes.isNotBlank()) Text(entry.notes, style = T.body, color = p.secondary, modifier = Modifier.padding(top = 4.dp))
                            }
                        }
                    }
                    if (state.careNext != null) item(key = "older-care") {
                        PlainButton("Muat catatan lebih lama", model::loadOlderCareJournal, enabled = !state.busy)
                    }
                }
                else -> {
                    item(key = "compare-controls") {
                        Panel {
                            Text("Perbandingan 7 hari", style = T.headline, color = p.ink)
                            Text("Bandingkan rata-rata dan rentang nilai minggu ini terhadap minggu sebelumnya.", style = T.subhead, color = p.secondary, modifier = Modifier.padding(top = 2.dp))
                            if (state.demo) {
                                Text("Perbandingan antar rentang membutuhkan data historis akun.", style = T.footnote, color = p.secondary, modifier = Modifier.padding(top = 8.dp))
                            } else {
                                PrimaryButton(
                                    if (state.busy) "Menghitung…" else "Bandingkan 7 hari terakhir",
                                    {
                                        val now = Instant.now()
                                        val second = HistoryWindow(now.minus(7, ChronoUnit.DAYS), now)
                                        val first = HistoryWindow(now.minus(14, ChronoUnit.DAYS), now.minus(7, ChronoUnit.DAYS))
                                        model.compareMeasurements(unit.id, first, second)
                                    },
                                    Modifier.padding(top = 12.dp).fillMaxWidth(),
                                    enabled = !state.busy,
                                    busy = state.busy,
                                )
                            }
                        }
                    }
                    state.historyComparison?.takeIf { state.comparisonUnitId == unit.id }?.let { cmp ->
                        item(key = "compare-results") {
                            SectionTitle("Hasil minggu ini vs lalu")
                            Group(footer = "Dihitung pada ${time(cmp.snapshot)}") {
                                cmp.sensors.forEach { sc ->
                                    val deltaText = sc.avgDelta?.let {
                                        val sign = if (it >= 0) "+" else ""
                                        "$sign${number(it)} ${sc.sensor.unit}"
                                    } ?: "—"
                                    Cell(
                                        sc.sensor.label,
                                        subtitle = "Minggu ini: ${sc.second.avg?.let { number(it) } ?: "—"} · Lalu: ${sc.first.avg?.let { number(it) } ?: "—"} (${sc.second.eligible}/${sc.second.total} valid)",
                                        value = deltaText,
                                        chevron = false,
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (journaling && unit != null) {
        CareJournalSheet(unit, state, model) { journaling = false }
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

@Composable
internal fun HistoryTrend(
    state: AppState,
    model: AgroViewModel,
    unitId: String,
    sensor: Sensor,
    selectedAt: Instant? = null,
    onSelect: ((Reading?) -> Unit)? = null,
) {
    val p = palette
    Column(Modifier.padding(horizontal = 16.dp)) {
        Segmented(HistoryRange.entries.map { it.label }, state.historyRange.ordinal,
            { model.selectHistoryRange(HistoryRange.entries[it]) })
        Spacer(Modifier.height(12.dp))
        if (!state.historyLoaded) {
            if (state.busy || state.message == null) {
                Footnote("Memuat bacaan ${state.historyRange.label}…")
            }
            PlainButton("Muat riwayat sensor", model::loadHistory, enabled = !state.busy)
        } else {
            val window = state.historyChartWindow ?: if (state.demo) {
                state.history.maxOfOrNull { it.at }?.let { state.historyRange.window(it.plusNanos(1_000)) }
            } else null
            val readings = remember(state.history, sensor, window) {
                state.history.filter { it.sensor == sensor && window != null && it.at >= window.from && it.at < window.to }
            }
            TrendChart(
                readings, sensor,
                when (sensor) { Sensor.Moisture -> p.water; Sensor.Temperature -> p.sun; Sensor.Ph -> p.tint },
                // Practice scenarios hold 2.5 hours of samples; on a 24-hour axis they were a sliver at the right edge.
                // The axis spans the data there, and the full window only for a real device.
                selectedAt = selectedAt, onSelect = onSelect, window = window.takeUnless { state.demo },
                waterings = state.careJournal.filter { it.unitId == unitId && it.kind == "watering" },
            )
        }
    }
}
