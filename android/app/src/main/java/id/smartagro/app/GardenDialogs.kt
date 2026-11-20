package id.smartagro.app

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import java.time.Instant
import java.time.LocalDate
import java.util.Locale

private val OUTCOMES = listOf("berhasil" to "Panen / berhasil", "gagal" to "Gagal tumbuh", "dihentikan" to "Dihentikan")

@Composable
internal fun AddSiteSheet(state: AppState, model: AgroViewModel, dismiss: () -> Unit) {
    val p = palette
    var name by rememberSaveable { mutableStateOf("") }
    var kindIdx by rememberSaveable { mutableIntStateOf(0) }
    var placementIdx by rememberSaveable { mutableIntStateOf(1) }
    var zonesRaw by rememberSaveable { mutableStateOf("Bedeng A\nBedeng B") }
    var latRaw by rememberSaveable { mutableStateOf("") }
    var lonRaw by rememberSaveable { mutableStateOf("") }
    var plantNow by rememberSaveable { mutableStateOf(true) }
    var speciesQuery by rememberSaveable { mutableStateOf("") }
    var selectedSpecies by rememberSaveable { mutableIntStateOf(1) }
    var nickname by rememberSaveable { mutableStateOf("") }

    val kind = if (kindIdx == 0) "pot" else "garden"
    val placement = listOf("indoor", "outdoor", "rooftop")[placementIdx]
    val zones = remember(kind, zonesRaw) {
        if (kind == "pot") emptyList()
        else zonesRaw.split('\n', ',').map { it.trim() }.filter { it.isNotEmpty() }.distinctBy { it.lowercase(Locale.ROOT) }
    }
    val lat = latRaw.trim().replace(',', '.').toDoubleOrNull()
    val lon = lonRaw.trim().replace(',', '.').toDoubleOrNull()
    val coordsValid = placement == "indoor" || ((latRaw.isBlank() && lonRaw.isBlank()) ||
        (lat != null && lon != null && lat in -90.0..90.0 && lon in -180.0..180.0))
    val siteValid = name.trim().length in 1..60 && (kind == "pot" || zones.size in 1..12) && coordsValid
    val canSave = !state.busy && siteValid && (!plantNow || selectedSpecies in 1..3)

    AgroSheet("Tambah pot atau kebun", dismiss) {
        Group(footer = "Pot pribadi membuat satu zona otomatis. Kebun bisa memiliki sampai 12 zona.") {
            FieldRow("Nama lokasi", name, { name = it.take(60) }, "Teras depan", enabled = !state.busy)
        }
        Spacer(Modifier.height(12.dp))
        Column(Modifier.padding(horizontal = 16.dp)) {
            Segmented(listOf("Pot pribadi", "Kebun"), kindIdx, { kindIdx = it })
            Spacer(Modifier.height(10.dp))
            Segmented(listOf("Dalam ruang", "Luar ruang", "Atap / rooftop"), placementIdx, { placementIdx = it })
        }
        if (kind == "garden") {
            Spacer(Modifier.height(12.dp))
            Group(footer = "Pisahkan nama zona per baris atau koma.") {
                FieldRow("Zona", zonesRaw, { zonesRaw = it.take(400) }, "Bedeng A, Bedeng B", ime = ImeAction.Default, singleLine = false, enabled = !state.busy)
                if (zones.size > 12) Text("Maksimal 12 zona.", style = T.footnote, color = palette.warn)
            }
        }
        if (placement != "indoor") {
            Spacer(Modifier.height(12.dp))
            Group(footer = "Opsional: dipakai untuk prakiraan cuaca lokasi tanaman.") {
                FieldRow("Lintang", latRaw, { latRaw = it.take(20) }, "-6.2000", keyboard = KeyboardType.Decimal, enabled = !state.busy)
                FieldRow("Bujur", lonRaw, { lonRaw = it.take(20) }, "106.8167", keyboard = KeyboardType.Decimal, ime = ImeAction.Done, enabled = !state.busy)
            }
        }
        Spacer(Modifier.height(12.dp))
        Group {
            ToggleCell("Langsung tanam sekarang", plantNow, { plantNow = it }, enabled = !state.busy)
        }
        if (plantNow) {
            Spacer(Modifier.height(10.dp))
            SpeciesPicker(speciesQuery, { speciesQuery = it }, selectedSpecies, { selectedSpecies = it })
            Spacer(Modifier.height(10.dp))
            Group {
                FieldRow("Nama tanaman", nickname, { nickname = it.take(60) }, "Opsional, misal Cabai pagi", ime = ImeAction.Done, enabled = !state.busy)
            }
        }
        if (state.message != null && state.messageIsError) Banner(state.message, Modifier.padding(16.dp), error = true)
        PrimaryButton(
            if (state.busy) "Menyimpan…" else "Simpan & tambah",
            {
                model.createGardenWithOptionalPlant(
                    name, kind, placement, zones,
                    if (placement == "indoor") null else lat,
                    if (placement == "indoor") null else lon,
                    if (plantNow) selectedSpecies else null,
                    nickname.takeIf { it.isNotBlank() },
                    LocalDate.now(),
                    dismiss,
                )
            },
            Modifier.padding(horizontal = 16.dp, vertical = 12.dp).fillMaxWidth(),
            enabled = canSave,
            busy = state.busy,
        )
        Text("Setiap permintaan menyimpan ID antrean lokal agar tidak ganda saat jaringan putus.", Modifier.padding(horizontal = 20.dp), style = T.footnote, color = p.secondary)
    }
}

@Composable
internal fun PlantSlotSheet(slot: GardenSlot, state: AppState, model: AgroViewModel, dismiss: () -> Unit) {
    var query by rememberSaveable { mutableStateOf("") }
    var speciesId by rememberSaveable { mutableIntStateOf(1) }
    var nickname by rememberSaveable { mutableStateOf("") }
    AgroSheet("Tanam di ${slot.name}", dismiss) {
        SpeciesPicker(query, { query = it }, speciesId, { speciesId = it })
        Spacer(Modifier.height(12.dp))
        Group {
            FieldRow("Nama panggilan", nickname, { nickname = it.take(60) }, "Opsional", ime = ImeAction.Done, enabled = !state.busy)
        }
        if (state.message != null && state.messageIsError) Banner(state.message, Modifier.padding(16.dp), error = true)
        PrimaryButton(
            if (state.busy) "Menyimpan…" else "Mulai tanam hari ini",
            { model.plantInSlot(slot.id, speciesId, LocalDate.now(), nickname.takeIf { it.isNotBlank() }, dismiss) },
            Modifier.padding(horizontal = 16.dp, vertical = 14.dp).fillMaxWidth(),
            enabled = !state.busy,
            busy = state.busy,
        )
    }
}

@Composable
internal fun SwitchPlantSheet(plant: GardenPlant, state: AppState, model: AgroViewModel, dismiss: () -> Unit) {
    var outcomeIdx by rememberSaveable { mutableIntStateOf(0) }
    var query by rememberSaveable { mutableStateOf("") }
    var nextSpecies by rememberSaveable { mutableIntStateOf(if (plant.species == 1) 2 else 1) }
    var nickname by rememberSaveable { mutableStateOf("") }
    AgroSheet("Ganti tanaman", dismiss) {
        Group(footer = "Siklus ${plant.tag} (${plant.name}) ditutup, lalu siklus baru dimulai di zona ${plant.zone}.") {
            OUTCOMES.forEachIndexed { idx, (_, label) ->
                Cell(
                    label,
                    chevron = false,
                    trailing = { if (outcomeIdx == idx) Icon(icon(PhosphorPaths.CheckBold), "Dipilih", Modifier.size(18.dp), tint = palette.tint) },
                    onClick = { outcomeIdx = idx },
                )
            }
        }
        Spacer(Modifier.height(12.dp))
        SectionTitle("Tanaman pengganti")
        SpeciesPicker(query, { query = it }, nextSpecies, { nextSpecies = it })
        Spacer(Modifier.height(12.dp))
        Group {
            FieldRow("Nama baru", nickname, { nickname = it.take(60) }, "Opsional", ime = ImeAction.Done, enabled = !state.busy)
        }
        PrimaryButton(
            if (state.busy) "Menyimpan…" else "Tutup & mulai baru",
            { model.switchGardenPlant(plant.slotId, nextSpecies, LocalDate.now(), OUTCOMES[outcomeIdx].first, nickname.takeIf { it.isNotBlank() }, dismiss) },
            Modifier.padding(horizontal = 16.dp, vertical = 14.dp).fillMaxWidth(),
            enabled = !state.busy,
            busy = state.busy,
        )
    }
}

@Composable
internal fun ShareCycleSheet(cycle: GardenPlant, state: AppState, model: AgroViewModel, dismiss: () -> Unit) {
    var intervalRaw by rememberSaveable { mutableStateOf("2.0") }
    var lowRaw by rememberSaveable { mutableStateOf("45") }
    var highRaw by rememberSaveable { mutableStateOf("75") }
    val interval = intervalRaw.replace(',', '.').toDoubleOrNull()
    val low = lowRaw.replace(',', '.').toDoubleOrNull()
    val high = highRaw.replace(',', '.').toDoubleOrNull()
    val valid = interval != null && interval in 0.5..60.0 && low != null && high != null && low in 0.0..100.0 && high in low..100.0 && !state.busy
    AgroSheet("Bagikan siklus ${cycle.tag}", dismiss) {
        Group(footer = "Data diringkas secara anonim ke zona iklim Anda.") {
            FieldRow("Jeda siram (hari)", intervalRaw, { intervalRaw = it.take(8) }, "2.0", keyboard = KeyboardType.Decimal)
            FieldRow("Kelembapan bawah", lowRaw, { lowRaw = it.take(6) }, "45", keyboard = KeyboardType.Number)
            FieldRow("Kelembapan atas", highRaw, { highRaw = it.take(6) }, "75", keyboard = KeyboardType.Number, ime = ImeAction.Done)
        }
        PrimaryButton(
            if (state.busy) "Mengirim…" else "Bagikan ke komunitas",
            { model.shareGardenCycle(cycle.id, interval!!, low!!, high!!, dismiss) },
            Modifier.padding(horizontal = 16.dp, vertical = 14.dp).fillMaxWidth(),
            enabled = valid,
            busy = state.busy,
        )
    }
}

@Composable
internal fun CommunityKnowledgeSheet(speciesId: Int, state: AppState, model: AgroViewModel, dismiss: () -> Unit) {
    val p = palette
    val data = state.community.takeIf { state.communitySpeciesId == speciesId }
    LaunchedEffect(speciesId, state.demo) {
        if (!state.demo && data == null) model.loadCommunityKnowledge(speciesId)
    }
    AgroSheet("Pengetahuan komunitas", dismiss) {
        Banner("Label komunitas: belum dikurasi · ringkasan rata-rata pola pemilik zona lain.", Modifier.padding(horizontal = 16.dp, vertical = 6.dp))
        when {
            state.demo -> Footnote("Pengetahuan komunitas tersedia setelah masuk akun.")
            data == null && state.busy -> Row(Modifier.padding(20.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                ActivityIndicator(); Text("Memuat data komunitas…", style = T.body, color = p.secondary)
            }
            data == null -> {
                state.communityError?.let { Banner(it, Modifier.padding(horizontal = 16.dp), error = true) }
                PlainButton("Coba lagi", { model.loadCommunityKnowledge(speciesId) }, enabled = !state.busy)
            }
            data.zones.isEmpty() -> Footnote("Belum cukup siklus anonim (minimal 3 pemilik & 5 siklus di zona sama) untuk spesies ini.")
            else -> Group(footer = "Sumber: ${data.source} (${data.label})") {
                data.zones.forEach { z ->
                    Cell(
                        z.zone.replace('_', ' ').replaceFirstChar { it.uppercase() },
                        subtitle = "${z.owners} pemilik · ${z.cycles} siklus",
                        value = "Siram ${z.wateringMedianDays}h\n${z.moistureLow}–${z.moistureHigh}%",
                        chevron = false,
                    )
                }
            }
        }
    }
}

@Composable
internal fun SpeciesPicker(query: String, onQuery: (String) -> Unit, selectedId: Int, onSelect: (Int) -> Unit) {
    val p = palette
    val matches = remember(query) { SpeciesCatalog.search(query) }
    SearchField(query, onQuery, "Cari spesies, nama Latin, atau alias", Modifier.padding(horizontal = 16.dp))
    Spacer(Modifier.height(10.dp))
    Group {
        if (matches.isEmpty()) {
            Cell("Tidak ada spesies yang cocok", chevron = false)
        } else matches.forEach { sp ->
            val on = sp.speciesId == selectedId
            val tierTag = if (sp.curated) "Acuan terkurasi" else "Mode belajar"
            Cell(
                sp.name,
                subtitle = "${sp.latin} · $tierTag" + if (!sp.plantable) " · Belum bisa ditanam" else "",
                chevron = false,
                enabled = sp.plantable,
                trailing = {
                    if (on) Icon(icon(PhosphorPaths.CheckCircleFill), "Dipilih", Modifier.size(20.dp), tint = p.tint)
                },
                onClick = if (sp.plantable) ({ onSelect(sp.speciesId) }) else null,
            )
        }
    }
}

@Composable
internal fun ModeBelajarCard(
    speciesName: String,
    summary: LearningSummary,
    lastCheck: InspectionState?,
    busy: Boolean,
    onInspect: (InspectionState) -> Unit,
) {
    val p = palette
    val haptics = rememberHaptics()
    val ev = summary.evidence
    Panel {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Glyph(PhosphorPaths.Sparkle, p.tint)
            Column(Modifier.weight(1f)) {
                Text(if (ev.level == 1) "Pola pot Anda" else "Mengamati dulu", style = T.title3, color = p.ink)
                Text("Mode belajar · $speciesName", style = T.subhead, color = p.secondary)
            }
        }
        Text(summary.text, style = T.body, color = p.ink, modifier = Modifier.padding(top = 12.dp))
        Text(summary.originLabel, style = T.footnote, color = p.tint, modifier = Modifier.padding(top = 6.dp))
        Spacer(Modifier.height(12.dp))
        listOf(
            Triple("Hari diamati", ev.days, ObservationEngine.THRESHOLDS.days),
            Triple("Pengecekan", ev.inspections, ObservationEngine.THRESHOLDS.inspections),
            Triple("Siraman terukur", ev.waterings, ObservationEngine.THRESHOLDS.waterings),
        ).forEach { (label, cur, goal) ->
            Row(Modifier.fillMaxWidth().padding(vertical = 3.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(label, Modifier.weight(1f), style = T.subhead, color = p.secondary)
                Text("${cur.coerceAtMost(goal)}/$goal", style = T.subhead.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold), color = p.ink)
            }
            Box(Modifier.fillMaxWidth().height(6.dp).clip(CircleShape).background(p.fill)) {
                Box(Modifier.fillMaxWidth((cur.toFloat() / goal.coerceAtLeast(1)).coerceIn(0f, 1f)).fillMaxHeight().clip(CircleShape).background(p.tint))
            }
        }
        Text(summary.nextAction, style = T.subhead, color = p.secondary, modifier = Modifier.padding(top = 10.dp))
        Row(Modifier.fillMaxWidth().padding(top = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            InspectionState.entries.forEach { st ->
                val active = lastCheck == st
                Box(
                    Modifier.weight(1f).heightIn(min = 42.dp).clip(RoundedCornerShape(14.dp))
                        .background(if (active) p.soft else p.fill)
                        .clickable(enabled = !busy, role = Role.Button) { haptics.tick(); onInspect(st) }
                        .padding(horizontal = 8.dp, vertical = 10.dp)
                        .semantics { stateDescription = if (active) "Terakhir dipilih" else "" },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(st.label, style = T.subhead.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Medium), color = if (active) p.onSoft else p.ink)
                }
            }
        }
        lastCheck?.let { Text("Pengecekan terakhir: ${it.label.lowercase(Locale.ROOT)}.", style = T.footnote, color = p.secondary, modifier = Modifier.padding(top = 8.dp)) }
    }
}

internal fun logLearningCheck(model: AgroViewModel, unitId: String, state: InspectionState) {
    model.recordCare(unitId, "inspection", Instant.now(), null, "[${state.key}] Kondisi ${state.label.lowercase(Locale.ROOT)}")
}
