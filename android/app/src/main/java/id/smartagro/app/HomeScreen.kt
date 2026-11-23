package id.smartagro.app

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import java.time.temporal.ChronoUnit

private val COUNT = listOf("Tidak ada", "Satu", "Dua", "Tiga", "Empat", "Lima", "Enam", "Tujuh", "Delapan", "Sembilan")

/** What a tile needs; computed once per plant so the list and the summary agree. */
private class PlantCard(val unit: PlantUnit, val species: SpeciesSpec, val day: Int?, val ref: Reference?, val health: Health) {
    val word = moistureWord(health.moisture, ref)
    val needsLook = health.attention || word?.tone == Tone.Dry || word?.tone == Tone.Wet
}

/**
 * The Plants tab: one sentence on what needs a look, then a grid of small cut-away pots whose wet soil is the moisture
 * index. Plants that need a look come first. A tile opens the plant by growing into its stage.
 */
@Composable internal fun PlantsHome(state: AppState, model: AgroViewModel) {
    val p = palette
    val now = rememberNow()
    var query by rememberSaveable { mutableStateOf("") }
    var addingSite by rememberSaveable { mutableStateOf(false) }
    var plantingSlotId by rememberSaveable { mutableStateOf<String?>(null) }
    var practice by rememberSaveable { mutableStateOf(false) }
    val columns = if (LocalConfiguration.current.screenWidthDp / LocalDensity.current.fontScale < 300) 1 else 2
    val cycles = state.garden?.plants.orEmpty().filter { it.endedOn == null }
    val healths = state.units.associate { it.id to health(state, it, now) }
    val cards = state.units.map { u ->
        val cycle = cycles.firstOrNull { it.unitId == u.id }
        val species = cycle?.let { SpeciesCatalog.byCode(it.species) } ?: SpeciesCatalog.ofCrop(u.crop)
        val day = cycle?.let { ChronoUnit.DAYS.between(it.plantedOn, LocalDate.now()).toInt().coerceAtLeast(0) } ?: 35.takeIf { state.demo }
        PlantCard(u, species, day, if (state.demo && species.curated) referenceFor(species.speciesId) else null, healths.getValue(u.id))
    }
    val shown = cards.filter { c ->
        listOf(c.unit.name, c.unit.crop, state.plantCode(c.unit), state.products.find { it.id == c.unit.productId }?.serial.orEmpty())
            .any { it.contains(query.trim(), ignoreCase = true) }
    }.sortedByDescending { it.needsLook }
    val attention = cards.count { it.needsLook }

    TitledScreen("Tanaman saya", accessory = if (state.demo) ({ PracticeCapsule({ practice = true }) }) else null, actions = {
        if (!state.demo) BarButton(PhosphorPaths.PlusBold, "Tambah pot atau kebun", { addingSite = true }, enabled = !state.busy)
        RefreshAction(state, model)
    }) {
        notices(state)
        state.cachedAt?.let { at -> item(key = "offline-time") { Footnote("Offline · Terakhir diperbarui ${time(at)}") } }
        if (!state.demo && state.carePlants.isNotEmpty()) item(key = "care-overview") {
            SectionTitle("Perawatan tanaman")
            Group {
                state.carePlants.forEach { plant ->
                    Cell(plant.name, subtitle = bandSourceLabel(plant.bandSource), value = careStateLabel(careState(plant, now)),
                        chevron = plant.unitId != null, onClick = { state.units.find { it.id == plant.unitId }?.let(model::openUnit) })
                }
            }
        }
        if (cards.isNotEmpty() || cycles.isNotEmpty()) item(key = "summary") {
            Column(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, bottom = 14.dp)) {
                if (cards.isNotEmpty()) Text(when {
                    attention > 0 -> "${COUNT.getOrNull(attention) ?: attention.toString()} tanaman perlu dilihat."
                    cards.all { it.health.moisture == null } -> "Menunggu bacaan sensor."
                    else -> "Tidak ada tanaman yang perlu dilihat."
                }, style = T.title3, color = p.ink)
                Text("${cycles.size.takeIf { state.garden != null } ?: state.units.size} tanaman · ${state.products.size} produk",
                    style = T.subhead, color = p.secondary, modifier = Modifier.padding(top = 2.dp))
            }
        }
        if (cards.size > 6) item(key = "search") {
            SearchField(query, { query = it.take(120) }, "Cari nama, kode, atau produk", Modifier.padding(start = 16.dp, end = 16.dp, bottom = 8.dp))
        }
        items(shown.chunked(columns), key = { row -> "units-" + row.joinToString { it.unit.id } }) { row ->
            TileRow(columns == 2 && row.size < columns) {
                row.forEach { c ->
                    PlantTile(c.unit.name, state.plantCode(c.unit), c.species.speciesId, c.day, c.health.moisture, c.word, c.health.status, c.ref,
                        Modifier.weight(1f), zoomKey = "unit-${c.unit.id}") { model.openUnit(c.unit) }
                }
            }
        }
        if (shown.isEmpty() && cards.isNotEmpty()) item(key = "no-match") { Footnote("Tidak ada tanaman yang cocok. Coba nama atau kode lain.") }

        state.garden?.let { garden ->
            garden.sites.forEach { site ->
                val plants = garden.plants.filter { it.siteId == site.id && it.endedOn == null }
                item(key = "site-${site.id}") {
                    SectionTitle(site.name) { Text(if (site.kind == "garden") "Kebun" else "Pot pribadi", style = T.subhead, color = p.secondary) }
                }
                items(plants.chunked(columns), key = { row -> "plants-" + row.joinToString { it.id } }) { row ->
                    TileRow(columns == 2 && row.size < columns) {
                        row.forEach { plant ->
                            val h = plant.unitId?.let { healths[it] }
                            val species = SpeciesCatalog.byCode(plant.species)
                            val ref = species?.takeIf { it.curated }?.let { referenceFor(it.speciesId) }
                            PlantTile(plant.name, "${plant.tag} · ${plant.zone}", plant.species,
                                ChronoUnit.DAYS.between(plant.plantedOn, LocalDate.now()).toInt().coerceAtLeast(0), h?.moisture,
                                if (h != null) moistureWord(h.moisture, ref) else null, h?.status ?: "Belum ada sensor", ref.takeIf { h != null },
                                Modifier.weight(1f)) { model.openGarden(plant) }
                        }
                    }
                }
            }
            val openSlots = garden.slots.filter { slot -> garden.plants.none { it.slotId == slot.id && it.endedOn == null } }
            if (openSlots.isNotEmpty()) item(key = "empty-slots") {
                SectionTitle("Zona siap ditanami")
                Group {
                    openSlots.forEach { slot ->
                        val siteName = garden.sites.find { it.id == slot.siteId }?.name.orEmpty()
                        Cell(slot.name, subtitle = "$siteName · Ketuk untuk mulai tanam", glyph = PhosphorPaths.PlusBold, glyphColor = p.tint,
                            enabled = !state.busy, onClick = { plantingSlotId = slot.id })
                    }
                }
            } else if (garden.emptySlots > 0) item { Footnote("${garden.emptySlots} zona belum ditanami.") }
        }

        val bare = state.products.filter { product -> state.units.none { it.productId == product.id } }
        if (bare.isNotEmpty()) item(key = "bare") {
            SectionTitle("Produk tanpa tanaman")
            Group { bare.forEach { product -> Cell("${product.label} · ${product.serial}", subtitle = "Belum ada tanaman", enabled = !state.busy, onClick = { model.select(product) }) } }
        }
        if (state.products.isEmpty() && state.garden?.sites.isNullOrEmpty() && state.catalogLoaded && !state.busy) item(key = "empty") {
            EmptyState("Belum ada produk terhubung", "Aktifkan pot Smart Agro atau tambah kebun manual untuk mulai.",
                if (state.demo) "Akhiri latihan" else "Kelola produk & QR") { if (state.demo) model.logout() else model.navigate(Screen.ManageProducts) }
        }
    }

    if (addingSite) AddSiteSheet(state, model) { addingSite = false }
    state.garden?.slots?.find { it.id == plantingSlotId }?.let { slot -> PlantSlotSheet(slot, state, model) { plantingSlotId = null } }
    if (practice) PracticeSheet({ practice = false; model.logout() }) { practice = false }
}

@Composable private fun TileRow(padEmptyHalf: Boolean, content: @Composable RowScope.() -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        content()
        if (padEmptyHalf) Spacer(Modifier.weight(1f))
    }
}

/** A plant tile: the mini pot and its code, the name, the status word, and a compact moisture tape when there is a reference. */
@Composable private fun PlantTile(name: String, tag: String, speciesId: Int, day: Int?, moisture: Double?, word: Word?, fallback: String,
                                  ref: Reference?, modifier: Modifier, zoomKey: String? = null, onClick: () -> Unit) {
    val p = palette
    val haptics = rememberHaptics()
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) .97f else 1f, Springs.snappy(), label = "Tekan ubin")
    val status = word?.text ?: fallback
    Column(modifier.graphicsLayer { scaleX = scale; scaleY = scale }.then(if (zoomKey != null) Modifier.zoom(zoomKey) else Modifier)
        .clip(RoundedCornerShape(22.dp)).background(p.cell).clickable(source, null, role = Role.Button) { haptics.press(); onClick() }
        .padding(start = 14.dp, end = 14.dp, top = 12.dp, bottom = 14.dp)
        .semantics(mergeDescendants = true) { stateDescription = moisture?.let { "${Sensor.Moisture.label} ${formatValue(Sensor.Moisture, it)} dari 100" } ?: "" }) {
        Row(verticalAlignment = Alignment.Top) {
            MiniPot(speciesId, day, moisture, Modifier.offset(x = (-8).dp, y = (-6).dp))
            // The code takes what the pot leaves, so a one-column grid at large text keeps "T-CASE2" on one line.
            Text(tag, style = T.caption.copy(fontWeight = FontWeight.SemiBold), color = p.secondary, maxLines = 2, overflow = TextOverflow.Ellipsis,
                textAlign = TextAlign.End, modifier = Modifier.weight(1f).padding(start = 4.dp, top = 4.dp))
        }
        Text(name, style = T.headline, color = p.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text(status, style = T.subhead.copy(fontWeight = FontWeight.Medium), color = word?.let { toneColor(it.tone) } ?: p.secondary,
            modifier = Modifier.padding(top = 2.dp))
        if (ref != null) MeasureTape(moisture, MoistureScale, ref.low..ref.wet, "Pita kelembapan, rentang acuan ${ref.low.toInt()} sampai ${ref.wet.toInt()}",
            Modifier.padding(top = 10.dp), compact = true)
    }
}
