package id.smartagro.app

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathMeasure
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.hazeSource
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit

private val clock = DateTimeFormatter.ofPattern("HH.mm")
internal fun hhmm(at: Instant): String = clock.format(at.atZone(ZoneId.systemDefault()))

/** One tick per day from [from] to [to]: watered, another care note, or nothing recorded. */
internal fun careMarks(entries: List<CareEntry>, from: LocalDate, to: LocalDate, zone: ZoneId = ZoneId.systemDefault()): List<CareMark> {
    if (to.isBefore(from)) return emptyList()
    val byDay = entries.groupBy { it.observedAt.atZone(zone).toLocalDate() }
    return generateSequence(from) { it.plusDays(1) }.takeWhile { !it.isAfter(to) }.map { day ->
        val kinds = byDay[day].orEmpty().map { it.kind }
        when { "watering" in kinds -> CareMark.Water; kinds.isNotEmpty() -> CareMark.Check; else -> CareMark.None }
    }.toList()
}

/** Content that scrolls over the stage sits on the canvas, so the stage shows only above it. */
@Composable private fun Sheet(content: @Composable ColumnScope.() -> Unit) =
    Column(Modifier.fillMaxWidth().background(palette.canvas), content = content)

/**
 * A plant: the pot stage stays in place at the top while the content scrolls over it like a sheet (Apple Weather), so the
 * plant is the header. The stage shows the soil's wetness and the plant's posture; the title block names the state in
 * words; one action card says what to do; the rulers below give the numbers.
 */
@Composable internal fun PlantDetail(state: AppState, model: AgroViewModel) {
    val p = palette
    val unit = state.selectedUnit ?: return
    val now = rememberNow()
    val h = health(state, unit, now)
    val product = state.products.find { it.id == unit.productId }
    var renaming by rememberSaveable(unit.id) { mutableStateOf(false) }
    var why by rememberSaveable(unit.id) { mutableStateOf(false) }
    var diagnostics by rememberSaveable(unit.id) { mutableStateOf(false) }
    var practice by rememberSaveable { mutableStateOf(false) }
    var confirmingRise by remember(unit.id) { mutableStateOf<WateringRise?>(null) }
    var watering by rememberSaveable(unit.id) { mutableStateOf(false) }
    var chart by rememberSaveable(unit.id) { mutableStateOf<Sensor?>(null) }
    val uri = rememberSafeUriHandler()
    val scope = rememberCoroutineScope()
    val cycle = state.garden?.plants?.firstOrNull { it.unitId == unit.id && it.endedOn == null }
    val species = remember(cycle?.species, unit.crop) { cycle?.let { SpeciesCatalog.byCode(it.species) } ?: SpeciesCatalog.ofCrop(unit.crop) }
    val ref = if (state.demo && species.curated) referenceFor(species.speciesId) else null
    val today = remember(cycle?.plantedOn, state.demo, LocalDate.now()) {
        (cycle?.let { ChronoUnit.DAYS.between(it.plantedOn, LocalDate.now()).toInt().coerceAtLeast(0) } ?: 35.takeIf { state.demo })?.coerceAtMost(species.maxDay)
    }
    var shownDay by rememberSaveable(unit.id, today) { mutableIntStateOf(today ?: 0) }
    LaunchedEffect(unit.id, state.demo, state.email) {
        if (!state.demo && state.email.isNotBlank() && (!state.careLoaded || state.careUnitId != unit.id)) model.loadCareJournal(unit.id)
        if (!state.demo && state.email.isNotBlank()) model.loadCareDetails(unit.id)
    }
    val weather = state.weather.takeIf { state.weatherSiteId == state.weatherSite?.id }
    val outdoor = state.weatherSite?.placement?.let { it != "indoor" } == true
    val hour = weather?.at?.substring(11, 13)?.toIntOrNull() ?: java.time.LocalTime.now().hour
    val sky = skyFor(hour, weather?.condition, outdoor)
    val moistureAt = h.samples[Sensor.Moisture]?.at
    val word = moistureWord(h.moisture, ref)

    val list = rememberLazyListState()
    val density = LocalDensity.current
    val top = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()
    val stage = 380.dp
    val covered by remember(density, top) {
        derivedStateOf { list.firstVisibleItemIndex > 0 || list.firstVisibleItemScrollOffset > with(density) { (stage - 26.dp - 52.dp - top).toPx() } }
    }
    val glass by animateFloatAsState(if (covered) 1f else 0f, tween(200), label = "Bar detail")
    val overMedia = LocalStatusOverMedia.current
    SideEffect { overMedia.value = !covered }
    DisposableEffect(Unit) { onDispose { overMedia.value = false } }
    val haze = remember { HazeState() }

    Box(Modifier.fillMaxSize().zoom("unit-${unit.id}").background(p.canvas)) {
        Box(Modifier.fillMaxWidth().height(stage)) {
            SkyBackdrop(sky, weather?.condition, Modifier.matchParentSize())
            PlantScene(Modifier.fillMaxSize().padding(top = top + 44.dp, bottom = 34.dp), onion = species.speciesId == 2, speciesId = species.speciesId,
                moisture = h.moisture, cutaway = true, day = if (today != null) shownDay else null, arrival = moistureAt)
        }
        LazyColumn(Modifier.fillMaxSize().hazeSource(haze), state = list, contentPadding = PaddingValues(bottom = LocalBottomClearance.current + 24.dp)) {
            item(key = "stage") {
                Spacer(Modifier.fillMaxWidth().height(stage - 26.dp).semantics { contentDescription = "Penampang pot ${unit.name}, ${word?.text ?: h.status}" })
            }
            item(key = "title") {
                Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(topStart = 26.dp, topEnd = 26.dp)).background(p.canvas)
                    .padding(start = 20.dp, end = 20.dp, top = 22.dp, bottom = 18.dp)) {
                    Text(unit.name, style = T.largeTitle, color = p.ink, modifier = Modifier.semantics { heading() })
                    Text(word?.text ?: h.status, style = T.title1.copy(fontSize = 22.sp, lineHeight = 28.sp), color = word?.let { toneColor(it.tone) } ?: p.secondary,
                        modifier = Modifier.padding(top = 4.dp))
                    Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(listOfNotNull("${unit.crop} · ${state.plantCode(unit)}", today?.let { "Hari ke-$it" }).joinToString(" · "),
                            Modifier.weight(1f, fill = false), style = T.subhead.copy(fontWeight = FontWeight.Medium), color = p.secondary)
                        if (state.demo) PracticeCapsule({ practice = true })
                    }
                    Text(when { state.demo -> "Data sintetis"; moistureAt != null -> "Diukur ${time(moistureAt)}"; else -> "Menunggu bacaan pertama" },
                        style = T.footnote, color = p.secondary, modifier = Modifier.padding(top = 2.dp))
                }
            }
            state.message?.let { message -> item(key = "message") { Sheet { Banner(message, Modifier.padding(horizontal = 16.dp, vertical = 4.dp), state.messageIsError) } } }
            if (!state.demo) item(key = "server-care") {
                Sheet {
                    SectionTitle("Perawatan")
                    Panel {
                        val plant = state.carePlants.firstOrNull { it.unitId == unit.id }
                        Text(plant?.let { careStateLabel(careState(it, now)) } ?: "Menunggu data perawatan", style = T.headline, color = p.ink)
                        Text(bandSourceLabel(plant?.bandSource), style = T.subhead, color = p.secondary)
                        if (state.careDetailsUnit == unit.id) {
                            val outlook = state.wateringOutlook
                            Text(when(outlook?.state) {
                                "window" -> "Siram sekitar ${hhmm(outlook.from!!)} - ${hhmm(outlook.to!!)}"
                                "below" -> "Tanah sudah mencapai batas siram pot ini."
                                "learning" -> "Catat inspeksi dan siram untuk membentuk pola pot."
                                else -> "Menunggu rangkaian bacaan untuk memperkirakan siram."
                            }, style = T.subhead, color = p.secondary)
                        }
                        PlainButton("Catat siram", { watering = true }, enabled = !state.busy && state.pendingCare == null)
                        PlainButton("Minta saran", { why = true }, enabled = !state.busy)
                        state.pendingCare?.takeIf { it.unitId == unit.id }?.let {
                            if (state.pendingCareSending) PlainButton("Coba simpan lagi", model::retryPendingCare, enabled = !state.busy)
                            else PlainButton("Urungkan", model::undoCare)
                        }
                    }
                    if (state.careDetailsUnit == unit.id) {
                        state.wateringRises.forEach { rise ->
                            Panel {
                                Text("Sepertinya Anda menyiram pukul ${hhmm(rise.to)}. Catat?", style = T.headline, color = p.ink)
                                PlainButton("Catat", { confirmingRise = rise }, enabled = !state.busy && state.pendingCare == null)
                                PlainButton("Bukan", { model.dismissRise(unit.id, rise) }, enabled = !state.busy)
                            }
                        }
                        state.unitHealth?.let { device ->
                            SectionTitle("Perangkat")
                            Group {
                                Cell("Baterai", value = device.volts?.let { "%.2f V".format(it) } ?: "Belum ada bacaan", chevron = false)
                                Cell("Perkiraan daya", value = device.daysLeft?.let { "%.1f hari".format(it) } ?: "Belum cukup data", chevron = false)
                                Cell("Jeda kiriman", value = "${device.gaps} dalam 7 hari", chevron = false)
                                Cell("Kalibrasi kelembapan", value = device.moistureAt?.let(::time) ?: "Belum dikalibrasi", chevron = false)
                                Cell("Kalibrasi pH", value = device.phAt?.let(::time) ?: "Belum dikalibrasi", chevron = false)
                            }
                        }
                    }
                }
            }
            if (species.curated && state.demo) item(key = "action") {
                Sheet {
                    ActionCard(state, unit, word, moistureAt, h.moisture, onWater = { watering = true }, onWhy = { why = true }, onUndo = model::undoCare,
                        onSimulate = { scope.launch { list.animateScrollToItem(0); delay(380); model.simulateDemoReading(unit.id) } })
                }
            } else if (!species.curated) item(key = "learning") {
                Sheet {
                    SectionTitle("Mode belajar")
                    if (!state.demo && (!state.careLoaded || state.careUnitId != unit.id || state.careNext != null)) {
                        Footnote("Muat riwayat perawatan sebelum menghitung pola pot.")
                        PlainButton("Muat riwayat perawatan", { if (state.careNext != null) model.loadOlderCareJournal() else model.loadCareJournal(unit.id) },
                            Modifier.padding(horizontal = 16.dp), enabled = !state.busy)
                    } else {
                        val journal = state.careJournal.filter { it.unitId == unit.id }
                        val (summary, lastCheck) = remember(species.name, state.history, journal) { ObservationEngine.fromHistory(species.name, state.history, journal) }
                        ModeBelajarCard(species.name, summary, lastCheck, state.busy) { picked -> logLearningCheck(model, unit.id, picked) }
                    }
                }
            }
            if (today != null) item(key = "growth") {
                Sheet {
                    SectionTitle("Umur")
                    Panel {
                        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text(if (shownDay == today) "Hari ke-$shownDay" else "Ilustrasi hari ke-$shownDay", Modifier.weight(1f), style = T.headline, color = p.ink)
                            Text(phaseAt(species.phases, shownDay), style = T.subhead.copy(fontWeight = FontWeight.Medium), color = p.secondary)
                        }
                        DayRuler(shownDay, today, species.maxDay, species.phases, { shownDay = it }, Modifier.padding(top = 12.dp))
                        Row(Modifier.padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text(if (shownDay == today) "Geser penggaris untuk melihat fase." else "Gambar saja; bacaan tidak berubah.", Modifier.weight(1f),
                                style = T.footnote, color = p.secondary)
                            if (shownDay != today) LinkButton("Hari ini", p.tint) { shownDay = today }
                        }
                    }
                }
            }
            item(key = "kondisi") {
                Sheet {
                    SectionTitle("Kondisi")
                    Group(footer = product?.let { "Perangkat ${it.serial} · bacaan tiap 30 menit" }) {
                        Sensor.entries.forEach { s -> ConditionRow(s, h, ref, state.demo) { chart = s } }
                        Cell("Diagnostik sensor", glyph = PhosphorPaths.Info, glyphColor = p.secondary, onClick = { diagnostics = true })
                    }
                }
            }
            if (state.demo || (state.careLoaded && state.careUnitId == unit.id)) item(key = "care") {
                Sheet {
                    val to = LocalDate.now()
                    val from = cycle?.plantedOn?.let { maxOf(it, to.minusDays(89)) } ?: to.minusDays(29)
                    val marks = remember(state.careJournal, unit.id, from, to) { careMarks(state.careJournal.filter { it.unitId == unit.id }, from, to) }
                    val waters = marks.count { it == CareMark.Water }
                    SectionTitle("Siklus ini")
                    Panel {
                        Text(if (waters == 0) "Belum ada siraman tercatat dalam ${marks.size} hari" else "Siram tercatat pada $waters dari ${marks.size} hari",
                            style = T.body.copy(fontWeight = FontWeight.Medium), color = p.ink)
                        CareStrip(marks, Modifier.padding(top = 12.dp))
                    }
                }
            }
            state.weatherSite?.takeIf { !state.demo }?.let { site ->
                item(key = "weather") {
                    Sheet {
                        SectionTitle("Cuaca di ${site.name}")
                        WeatherSection(site, state.weather.takeIf { state.weatherSiteId == site.id }, state.weatherBusy, state.weatherMessage, model::loadWeather)
                    }
                }
            }
            item(key = "more") {
                Sheet {
                    Spacer(Modifier.height(20.dp))
                    Group(inset = 60.dp) {
                        Cell("Riwayat sensor", glyph = PhosphorPaths.ClockCounterClockwise, glyphColor = p.secondary, onClick = { model.openHistoryFor(unit, Sensor.Moisture) })
                        Cell("Kelola pot di website", glyph = PhosphorPaths.LinkSimple, glyphColor = p.secondary, onClick = { uri.openUri(WEB + "#simulasi") })
                    }
                }
            }
        }
        NavBar(unit.name, glass, Modifier.align(Alignment.TopCenter), glass, if (state.dashboardFromGarden) "Kebun" else "Tanaman", model::back, haze,
            floating = !covered, actions = { BarButton(PhosphorPaths.PencilSimple, "Ubah nama tanaman", { renaming = true }, enabled = !state.busy, floating = !covered) })
    }
    if (renaming) RenameSheet(unit.name, state.busy, { renaming = false }) { model.renameUnit(it); renaming = false }
    if (why) AgroSheet("Kenapa?", { why = false }) {
        ExplanationSection(state.explanation.takeIf { state.explanationUnitId == unit.id }, state.explanationBusy, state.explanationMessage,
            model::loadExplanation, model::explain, state.explanationUnitId == unit.id && state.explanationDeviceId != null)
    }
    chart?.let { s -> ChartSheet(state, model, s, ref) { chart = null } }
    if (diagnostics) SensorDiagnosticsSheet(unit, h, state.demo) { diagnostics = false }
    if (practice) PracticeSheet({ practice = false; model.logout() }) { practice = false }
    confirmingRise?.let { rise ->
        WaterSheet(unit.name, null, { confirmingRise = null }) { amount ->
            confirmingRise = null
            model.recordCareWithUndo(unit.id, "watering", amount, rise.to)
        }
    }
    if (watering) {
        val last = state.careJournal.filter { it.unitId == unit.id && it.kind == "watering" }.maxByOrNull { it.observedAt }?.amountMl
        WaterSheet(unit.name, last, { watering = false }) { amount -> watering = false; model.recordCareWithUndo(unit.id, "watering", amount) }
    }
}

/**
 * The one action card. Its words come from the stored rule result (or the practice scenario); the card is green only when
 * the index asks for action. "Catat siram" records with one tap after the amount is picked, then offers Urungkan while
 * the note waits to be sent.
 */
@Composable private fun ActionCard(state: AppState, unit: PlantUnit, word: Word?, readingAt: Instant?, moisture: Double?,
                                   onWater: () -> Unit, onWhy: () -> Unit, onUndo: () -> Unit, onSimulate: () -> Unit) {
    val p = palette
    val stored = state.explanation.takeIf { state.explanationUnitId == unit.id }
    val (action, reason) = stored?.let { it.action to it.reason } ?: state.demoAdvice[unit.id] ?: (null to null)
    val pending = state.pendingCare?.takeIf { it.unitId == unit.id && it.kind == "watering" }
    val recent = state.careJournal.filter { it.unitId == unit.id && it.kind == "watering" }.maxByOrNull { it.observedAt }
        ?.takeIf { Duration.between(it.observedAt, Instant.now()).toHours() < 3 }
    val loggedAt = pending?.at ?: recent?.observedAt
    val act = action != null && word?.tone in setOf(Tone.Dry, Tone.Wet)
    val fg = if (act) p.onTint else p.ink
    val fg2 = if (act) p.onTint2 else p.secondary
    Column(Modifier.padding(horizontal = 16.dp, vertical = 4.dp).fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(if (act) p.tint else p.cell)
        .padding(start = 18.dp, end = 18.dp, top = 18.dp, bottom = 14.dp)) {
        when {
            action != null -> {
                Text(action, style = T.title3, color = fg, modifier = Modifier.semantics { heading() })
                Text(reason.orEmpty(), style = T.subhead, color = fg2, modifier = Modifier.padding(top = 6.dp))
            }
            state.explanationBusy -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                ActivityIndicator(color = fg2); Text("Memuat saran tersimpan…", style = T.body, color = fg2)
            }
            else -> Text(state.explanationMessage ?: "Belum ada saran tersimpan untuk tanaman ini. Minta saran dari bacaan terbaru.", style = T.body, color = fg2)
        }
        if (loggedAt != null) {
            val after = readingAt?.takeIf { it.isAfter(loggedAt) }
            Row(Modifier.padding(top = 14.dp).semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
                verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                DrawnCheck(fg)
                Text("Siram dicatat ${hhmm(loggedAt)}", Modifier.weight(1f), style = T.headline, color = fg)
            }
            Text(if (after != null && moisture != null) "Bacaan ${hhmm(after)} sesudah disiram: indeks ${formatValue(Sensor.Moisture, moisture)}."
                else "Bacaan berikutnya akan menunjukkan hasilnya.", style = T.subhead, color = fg2, modifier = Modifier.padding(top = 4.dp))
            Row(Modifier.padding(top = 4.dp)) {
                if (pending != null) LinkButton("Urungkan", fg, onUndo)
                if (state.demo && pending == null && after == null) LinkButton("Simulasikan bacaan berikutnya", fg, onSimulate)
            }
        } else Row(Modifier.padding(top = 14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            if (word?.tone == Tone.Dry) CardButton("Catat siram", PhosphorPaths.Drop, if (act) p.onTint else p.tint, if (act) p.tint else p.onTint, onWater)
            if (!state.demo) LinkButton(if (action == null) "Minta saran" else "Kenapa?", fg, onWhy)
        }
        if (state.demo) Text("Hasil aturan dari skenario web; bukan diagnosis tanaman Anda.", style = T.footnote, color = fg2, modifier = Modifier.padding(top = 10.dp))
    }
}

/** The check draws itself once (320 ms) to show the note was taken; it does not repeat. */
@Composable private fun DrawnCheck(color: Color) {
    val draw = remember { Animatable(0f) }
    LaunchedEffect(Unit) { draw.animateTo(1f, tween(320, easing = CubicBezierEasing(.2f, .8f, .2f, 1f))) }
    Canvas(Modifier.size(22.dp)) {
        val s = size.width / 24f
        val full = Path().apply { moveTo(5f * s, 12.5f * s); lineTo(9.5f * s, 17f * s); lineTo(19f * s, 7.5f * s) }
        val measure = PathMeasure().apply { setPath(full, false) }
        val part = Path().also { measure.getSegment(0f, measure.length * draw.value, it, true) }
        drawPath(part, color, style = Stroke(2.6f * s, cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
}

@Composable private fun CardButton(text: String, path: String, bg: Color, fg: Color, onClick: () -> Unit) {
    val haptics = rememberHaptics()
    Row(Modifier.heightIn(min = 48.dp).clip(RoundedCornerShape(50)).background(bg).clickable(role = Role.Button) { haptics.press(); onClick() }
        .padding(horizontal = 18.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Icon(icon(path), null, Modifier.size(18.dp), tint = fg)
        Text(text, style = T.headline, color = fg)
    }
}

@Composable internal fun LinkButton(text: String, color: Color, onClick: () -> Unit) {
    Text(text, Modifier.heightIn(min = 44.dp).clip(RoundedCornerShape(12.dp)).clickable(role = Role.Button, onClick = onClick)
        .padding(horizontal = 12.dp, vertical = 11.dp), style = T.headline, color = color)
}

/** One Kondisi row: the name, the word for its state, the value, and its tape. Opens that sensor's chart in place. */
@Composable private fun ConditionRow(sensor: Sensor, h: Health, ref: Reference?, demo: Boolean, onClick: () -> Unit) {
    val p = palette
    val value = h.value(sensor)
    val word = when (sensor) {
        Sensor.Moisture -> moistureWord(value, ref).takeIf { value != null }
        Sensor.Temperature -> temperatureWord(value, ref)
        Sensor.Ph -> phWord(value, ref)
    }
    val status = h.sensorStatuses.getValue(sensor).takeUnless { demo || it == SensorStatus.Ready }?.label
    val band = bandOf(sensor, ref)
    val unitText = when (sensor) { Sensor.Moisture -> "/100"; Sensor.Temperature -> "°C"; Sensor.Ph -> "" }
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    Column(Modifier.fillMaxWidth().background(if (pressed) p.pressed else Color.Transparent).clickable(source, null, role = Role.Button, onClick = onClick)
        .padding(start = 16.dp, end = 16.dp, top = 14.dp, bottom = 12.dp).semantics(mergeDescendants = true) { }) {
        Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Column(Modifier.weight(1f)) {
                Text(sensor.label, style = T.body.copy(fontWeight = FontWeight.Medium), color = p.ink)
                (status ?: word?.text)?.let { Text(it, style = T.subhead.copy(fontWeight = FontWeight.Medium), color = if (status != null || word == null) p.secondary else toneColor(word.tone)) }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                RollingText(value?.let { formatValue(sensor, it) } ?: "—", T.title3, p.ink)
                if (value != null && unitText.isNotEmpty()) Text(unitText, style = T.subhead, color = p.secondary, modifier = Modifier.padding(start = 2.dp))
                Icon(icon(PhosphorPaths.CaretRightBold), null, Modifier.padding(start = 8.dp).size(14.dp), tint = p.tertiary)
            }
        }
        val range = band?.let { b ->
            if (sensor == Sensor.Temperature) ", batas panas ${formatValue(sensor, b.endInclusive)} °C"
            else ", rentang acuan ${formatValue(sensor, b.start)} sampai ${formatValue(sensor, b.endInclusive)}"
        }.orEmpty()
        MeasureTape(value, scaleOf(sensor), band, "${sensor.label} ${value?.let { formatValue(sensor, it) } ?: "belum ada bacaan"}$range", Modifier.padding(top = 10.dp))
    }
}

/** Picking the amount is the one input a watering note needs; the last amount used is chosen already. */
@Composable private fun WaterSheet(unitName: String, last: Double?, onDismiss: () -> Unit, onSave: (Double) -> Unit) {
    val p = palette
    val options = listOf(100.0, 250.0, 500.0, 1000.0)
    var pick by rememberSaveable { mutableIntStateOf(options.indexOf(last).takeIf { it >= 0 } ?: 1) }
    var amount by rememberSaveable { mutableStateOf((last ?: 250.0).toInt().toString()) }
    val actual = amount.replace(',', '.').toDoubleOrNull()?.takeIf { it.isFinite() && it > 0 && it <= 100_000 }
    AgroSheet("Catat siram", onDismiss) {
        Text("Takaran untuk $unitName", Modifier.padding(horizontal = 20.dp), style = T.subhead, color = p.secondary)
        Box(Modifier.padding(16.dp)) { Segmented(options.map { "${it.toInt()} mL" }, pick, { pick = it; amount = options[it].toInt().toString() }) }
        Group { FieldRow("Volume (mL)", amount, { amount = it.take(12) }, "250", keyboard = androidx.compose.ui.text.input.KeyboardType.Decimal) }
        Footnote("Catatan dikirim lima detik setelah disimpan. Sebelum itu masih bisa diurungkan.")
        PrimaryButton("Simpan", { actual?.let(onSave) }, Modifier.padding(16.dp).fillMaxWidth(), path = PhosphorPaths.Drop, enabled = actual != null)
    }
}
