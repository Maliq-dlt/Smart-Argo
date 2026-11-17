package id.smartagro.app

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.items
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
    var sensor by rememberSaveable { mutableStateOf(Sensor.Moisture) }
    var range by rememberSaveable { mutableIntStateOf(0) }
    var journaling by rememberSaveable { mutableStateOf(false) }
    var pendingCsv by remember { mutableStateOf<String?>(null) }

    val saveCsvLauncher = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/csv")) { uri: Uri? ->
        val csvText = pendingCsv
        pendingCsv = null
        if (uri != null && csvText != null) {
            runCatching { context.contentResolver.openOutputStream(uri)?.use { it.write(csvText.toByteArray(Charsets.UTF_8)) } }
        }
    }

    LaunchedEffect(unit?.id, tab, state.demo, state.email, state.busy) {
        if (!state.demo && state.email.isNotBlank() && !state.busy && unit != null) {
            if (tab == 1 && state.careUnitId != unit.id) model.loadCareJournal(unit.id)
        }
    }

    TitledScreen(
        "Riwayat sensor",
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
                                Pill(s.label, sensor == s) { sensor = s }
                            }
                        }
                    }
                    item(key = "chart") {
                        val color = when (sensor) { Sensor.Moisture -> p.water; Sensor.Temperature -> p.sun; Sensor.Ph -> p.tint }
                        Panel {
                            Segmented(listOf("24 jam", "7 hari"), range, { range = it })
                            Spacer(Modifier.height(14.dp))
                            val latest = state.history.maxOfOrNull { it.at }
                            val since = latest?.minus(if (range == 0) 24L else 24L * 7, ChronoUnit.HOURS)
                            TrendChart(
                                state.history.filter { it.sensor == sensor && it.value != null && since != null && !it.at.isBefore(since) },
                                sensor,
                                color,
                            )
                        }
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
                                                pendingCsv = csv.content
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
                    if (!state.historyLoaded && !state.demo) {
                        item(key = "load-history") {
                            Panel {
                                PrimaryButton("Muat riwayat sensor", model::loadHistory, Modifier.fillMaxWidth(), enabled = !state.busy, busy = state.busy)
                            }
                        }
                    } else if (shown.isEmpty()) {
                        item { Footnote("Belum ada bacaan untuk sensor ini pada jendela waktu yang dimuat.") }
                    } else {
                        item(key = "readings-group") {
                            Group {
                                shown.take(40).forEach { r ->
                                    Cell(
                                        reading(r.sensor, r.value),
                                        subtitle = if (r.quality == "ok") (if (r.synced) "Terverifikasi" else "Jam perangkat belum sinkron") else "Galat sensor",
                                        value = time(r.at),
                                        chevron = false,
                                    )
                                }
                            }
                        }
                        if (state.historyHasMore) {
                            item {
                                Box(Modifier.fillMaxWidth().padding(vertical = 8.dp), contentAlignment = Alignment.Center) {
                                    PlainButton("Muat bacaan lebih lama", model::loadOlderHistory, enabled = !state.busy)
                                }
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
                        item { Footnote(if (state.careLoaded || state.demo) "Belum ada catatan perawatan untuk tanaman ini." else "Memuat catatan perawatan…") }
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
