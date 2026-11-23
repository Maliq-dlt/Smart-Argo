package id.smartagro.app

import androidx.compose.foundation.layout.*
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/** A garden cycle on the A3 Apple surface kit: species stage, phase guide, learning mode, cycles, and community sharing. */
@Composable
internal fun GardenPlantScreen(state: AppState, model: AgroViewModel) {
    val plant = state.gardenPlant ?: return
    val p = palette
    val site = state.garden?.sites?.find { it.id == plant.siteId }
    val slot = state.garden?.slots?.find { it.id == plant.slotId }
    val unit = plant.unitId?.let { id -> state.units.find { it.id == id } }
    val species = SpeciesCatalog.byCode(plant.species)
    val days = ChronoUnit.DAYS.between(plant.plantedOn, LocalDate.now()).toInt().coerceAtLeast(0)
    var cutaway by rememberSaveable(plant.id) { mutableStateOf(false) }
    var switching by rememberSaveable(plant.id) { mutableStateOf(false) }
    var showCommunity by rememberSaveable(plant.id) { mutableStateOf(false) }
    var shareTargetId by rememberSaveable(plant.id) { mutableStateOf<String?>(null) }

    val weather = state.weather.takeIf { state.weatherSiteId == site?.id }
    val outdoor = site?.placement?.let { it != "indoor" } == true
    val slotHistory = remember(state.garden, plant.slotId) {
        state.garden?.plants.orEmpty().filter { it.slotId == plant.slotId && it.endedOn != null }.sortedByDescending { it.plantedOn }
    }

    TitledScreen(
        plant.name,
        subtitle = "${plant.tag} \u00b7 ${plant.crop}",
        back = "Tanaman",
        onBack = model::back,
        actions = {
            if (!state.demo) BarButton(PhosphorPaths.ArrowsLeftRight, "Ganti tanaman", { switching = true }, enabled = !state.busy)
        },
    ) {
        notices(state)
        if (!state.demo) item(key = "slot-unit") {
            SectionTitle("Perangkat untuk pot ini")
            Group(footer = "Lepaskan unit dari pot lama sebelum memindahkannya ke pot ini.") {
                Cell("Unit terhubung", value = unit?.name ?: "Belum terhubung", chevron = false)
                if (plant.unitId != null) Cell("Lepaskan perangkat", enabled = !state.busy, onClick = { model.assignSlotUnit(plant.slotId, null) })
                // One unit per pot or zone (set_my_slot_unit refuses a unit another active plant holds).
                state.units.filter { u -> state.garden?.plants.orEmpty().none { it.unitId == u.id && it.endedOn == null } }.forEach { available ->
                    Cell("Gunakan ${available.name}", enabled = !state.busy, onClick = { model.assignSlotUnit(plant.slotId, available.id) })
                }
            }
        }
        item(key = "stage") {
            Panel {
                PlantScene(
                    Modifier.fillMaxWidth().height(252.dp),
                    onion = plant.species == 2,
                    speciesId = plant.species,
                    cutaway = cutaway,
                    day = days,
                    interactive = true,
                    daylight = if (outdoor) weather?.condition != "malam" else null,
                    cloudy = weather?.condition in listOf("berawan", "mendung", "hujan"),
                )
                ToggleCell("Lihat akar & media", cutaway, { cutaway = it })
            }
        }
        item(key = "identity") {
            SectionTitle("Siklus berjalan")
            Group(
                footer = if (species?.curated == false) "Mengamati \u00b7 profil perawatan spesies ini belum dikurasi."
                else "Kode permanen ${plant.code} di zona ${plant.zone}.",
            ) {
                Cell("Lokasi", value = listOfNotNull(site?.name, plant.zone).joinToString(" · "), chevron = false)
                Cell("Ditanam", value = "${plant.plantedOn} ($days hari)", chevron = false)
                if (unit != null) {
                    Cell("Unit sensor", value = unit.name, onClick = { model.openUnit(unit) })
                }
            }
        }
        if (unit == null) {
            item(key = "no-unit") {
                Spacer(Modifier.height(12.dp))
                Banner("Belum ada unit sensor terhubung ke zona ini. Aplikasi tidak menampilkan bacaan atau saran perangkat tanpa data.", Modifier.padding(horizontal = 16.dp))
            }
        }
        if (species != null) {
            item(key = "phases") {
                SectionTitle("Panduan fase")
                Group {
                    SpeciesCatalog.phaseRanges(species.speciesId).forEach { (range, label) ->
                        Cell(label, value = "HST $range", chevron = false)
                    }
                }
            }
        }
        if (site != null) {
            item(key = "weather-title") { SectionTitle("Cuaca di ${site.name}") }
            item(key = "weather") { WeatherSection(site, weather, state.weatherBusy, state.weatherMessage, model::loadWeather) }
        }
        item(key = "community") {
            SectionTitle("Komunitas & opsi")
            Group(inset = 60.dp) {
                if (slot != null && !state.demo) {
                    ToggleCell(
                        "Bagikan pola siklus ke komunitas",
                        slot.share,
                        { model.setSlotSharing(slot.id, it) },
                        subtitle = "Membagikan siklus selesai secara anonim di zona Anda.",
                        glyph = PhosphorPaths.ShareNetwork,
                        glyphColor = p.tint,
                        enabled = !state.busy,
                    )
                }
                Cell("Pengetahuan komunitas", subtitle = "Ringkasan pola dari pemilik di zona iklim sama", glyph = PhosphorPaths.UsersThree, glyphColor = p.secondary, onClick = { showCommunity = true })
                if (!state.demo) {
                    Cell("Ganti atau tutup siklus", subtitle = "Catat hasil panen lalu mulai spesies baru", glyph = PhosphorPaths.ArrowsLeftRight, glyphColor = p.tint, onClick = { switching = true })
                }
            }
        }
        if (slotHistory.isNotEmpty()) {
            item(key = "cycle-history") {
                SectionTitle("Riwayat siklus zona ini")
                Group {
                    slotHistory.forEach { old ->
                        Cell(
                            "${old.tag} · ${old.name}",
                            subtitle = "${old.plantedOn} s/d ${old.endedOn} · ${old.outcome ?: "selesai"}",
                            chevron = false,
                            trailing = {
                                when {
                                    old.shared && !state.demo -> PlainButton("Tarik", { model.unshareGardenCycle(old.id) }, enabled = !state.busy)
                                    slot?.share == true && old.outcome == "berhasil" && !state.demo -> PlainButton("Bagikan", { shareTargetId = old.id }, enabled = !state.busy)
                                }
                            },
                        )
                    }
                }
            }
        }
    }

    if (switching) SwitchPlantSheet(plant, state, model) { switching = false }
    if (showCommunity) CommunityKnowledgeSheet(plant.species, state, model) { showCommunity = false }
    slotHistory.find { it.id == shareTargetId }?.let { target -> ShareCycleSheet(target, state, model) { shareTargetId = null } }
}
