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
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.delay
import java.time.Duration
import java.time.Instant
import java.util.Locale

private val ID = Locale.forLanguageTag("id-ID")
internal fun percent(value: Double?) = value?.let { String.format(ID, "%.0f%%", it) } ?: "—"
internal fun reading(sensor: Sensor, value: Double?) = when {
    value == null -> "—"
    sensor == Sensor.Moisture -> percent(value)
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
    return Health(samples, statuses, status, attention, stale && !revoked, overview?.at)
}

internal fun mascotMoodFor(h: Health): MascotMood = when {
    h.attention -> MascotMood.Care
    h.moisture != null && h.moisture < 42.0 -> MascotMood.Care
    h.waiting || h.moisture == null -> MascotMood.Reading
    h.moisture in 45.0..78.0 -> MascotMood.Happy
    else -> MascotMood.Smile
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

// ---------------------------------------------------------------- Home (Apple Wallet Plant Stack + 3 Metrics + Mascot Care)

/** The Plants tab: 3 tappable sensor metrics, Apple Wallet vertical stacked plant cards, Mascot care card, and garden slots. */
@Composable internal fun PlantsHome(state: AppState, model: AgroViewModel) {
    val p = palette
    val context = LocalContext.current
    val haptics = rememberHaptics()
    val now = rememberNow()
    var query by rememberSaveable { mutableStateOf("") }
    var productId by rememberSaveable { mutableStateOf<String?>(null) }
    var addingSite by rememberSaveable { mutableStateOf(false) }
    var plantingSlotId by rememberSaveable { mutableStateOf<String?>(null) }
    var autoRotate by rememberSaveable { mutableStateOf(false) }
    var adviceSheetUnitId by rememberSaveable { mutableStateOf<String?>(null) }
    val uri = rememberSafeUriHandler()
    val reduced = remember(context) { reducedMotionEnabled(context) }
    val columns = if (LocalConfiguration.current.screenWidthDp / LocalDensity.current.fontScale < 300) 1 else 2

    val visible = state.units.filter { unit ->
        (productId == null || unit.productId == productId) && listOf(
            unit.name, unit.crop, state.plantCode(unit),
            state.products.find { it.id == unit.productId }?.serial.orEmpty(),
        ).any { it.contains(query.trim(), ignoreCase = true) }
    }
    val healths = state.units.associate { it.id to health(state, it, now) }

    val activeIndex = visible.indexOfFirst { it.id == state.selectedUnit?.id }.let { if (it >= 0) it else 0 }
    val activeUnit = visible.getOrNull(activeIndex)

    // Optional calm 8-second auto-cycle between registered plants (never runs under reduced motion; stops on manual touch).
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    var resumed by remember(lifecycle) { mutableStateOf(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) }
    DisposableEffect(lifecycle) {
        val observer = LifecycleEventObserver { _, _ -> resumed = lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED) }
        lifecycle.addObserver(observer)
        onDispose { lifecycle.removeObserver(observer) }
    }
    LaunchedEffect(autoRotate, visible, activeIndex, reduced, resumed) {
        if (!autoRotate || visible.size <= 1 || reduced || !resumed) return@LaunchedEffect
        delay(8_000)
        val next = visible[(activeIndex + 1) % visible.size]
        model.selectUnit(next)
    }

    val promoteUnit: (PlantUnit) -> Unit = { u ->
        autoRotate = false
        if (activeUnit?.id != u.id) haptics.tick()
        model.selectUnit(u)
    }

    TitledScreen(
        "Tanaman saya",
        subtitle = "${state.garden?.plants?.count { it.endedOn == null } ?: state.units.size} tanaman · ${state.products.size} produk",
        actions = {
            if (!state.demo) BarButton(PhosphorPaths.PlusBold, "Tambah pot atau kebun", { addingSite = true }, enabled = !state.busy)
            RefreshAction(state, model)
        },
    ) {
        notices(state)
        if (state.units.isNotEmpty()) {
            if (activeUnit != null) {
                val activeHealth = healths.getValue(activeUnit.id)
                item(key = "top-metrics") {
                    SensorMetricsStrip(activeHealth) { sensor ->
                        model.openHistoryFor(activeUnit, sensor)
                    }
                }
                item(key = "wallet-deck") {
                    PlantWalletDeck(
                        state = state,
                        units = visible,
                        activeIndex = activeIndex,
                        healths = healths,
                        autoRotate = autoRotate && !reduced,
                        onToggleAuto = if (reduced) null else ({ haptics.tick(); autoRotate = !autoRotate }),
                        onPauseAuto = { autoRotate = false },
                        onPromote = promoteUnit,
                        onOpen = { autoRotate = false; model.openUnit(it) },
                        onOpenHistory = { autoRotate = false; model.openHistoryFor(it, Sensor.Moisture) },
                        onOpenWeb = { uri.openUri(WEB + "#simulasi") },
                    )
                }
                item(key = "care-mascot") {
                    MascotCareCard(
                        state = state,
                        unit = activeUnit,
                        health = activeHealth,
                        onOpenAdvice = { autoRotate = false; adviceSheetUnitId = activeUnit.id },
                    )
                }
            }
            item(key = "search-filter") {
                Column(Modifier.padding(top = 4.dp, bottom = 6.dp)) {
                    SearchField(query, { query = it.take(120); autoRotate = false }, "Cari nama, kode, atau produk", Modifier.padding(horizontal = 16.dp))
                    if (state.products.size > 1) {
                        Row(
                            Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 10.dp),
                            horizontalArrangement = Arrangement.spacedBy(8.dp),
                        ) {
                            Pill("Semua", productId == null) { productId = null; autoRotate = false }
                            state.products.forEach { product ->
                                Pill("${product.label} · ${product.serial}", productId == product.id) { productId = product.id; autoRotate = false }
                            }
                        }
                    } else {
                        Spacer(Modifier.height(8.dp))
                    }
                }
            }
            if (activeUnit != null && visible.size > 3) {
                item(key = "quick-units") {
                    Row(
                        Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 4.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        visible.forEach { u ->
                            Pill(u.name, u.id == activeUnit.id) { promoteUnit(u) }
                        }
                    }
                }
            } else if (activeUnit == null) {
                item(key = "no-match") { Footnote("Tidak ada tanaman yang cocok. Coba nama atau kode lain.") }
            }
        }

        state.garden?.let { garden ->
            garden.sites.forEach { site ->
                val plants = garden.plants.filter { it.siteId == site.id && it.endedOn == null }
                item(key = "site-${site.id}") {
                    SectionTitle(site.name) { Text(if (site.kind == "garden") "Kebun" else "Pot pribadi", style = T.subhead, color = p.secondary) }
                }
                items(plants.chunked(columns), key = { row -> "plants-" + row.joinToString { it.id } }) { row ->
                    TileRow(columns == 2 && row.size < columns) {
                        row.forEach { plant ->
                            val unitHealth = plant.unitId?.let { healths[it] }
                            PlantTile(
                                plant.name, "${plant.tag} · ${plant.zone}", unitHealth?.moisture,
                                unitHealth?.status ?: "Belum ada sensor", unitHealth?.attention == true, Modifier.weight(1f),
                            ) { model.openGarden(plant) }
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
                        Cell(
                            slot.name, subtitle = "$siteName · Ketuk untuk mulai tanam", glyph = PhosphorPaths.PlusBold, glyphColor = p.tint,
                            enabled = !state.busy, onClick = { plantingSlotId = slot.id },
                        )
                    }
                }
            } else if (garden.emptySlots > 0) item { Footnote("${garden.emptySlots} zona belum ditanami.") }
        }

        val bare = state.products.filter { product -> state.units.none { it.productId == product.id } }
        if (bare.isNotEmpty()) item(key = "bare") {
            SectionTitle("Produk tanpa tanaman")
            Group {
                bare.forEach { product ->
                    Cell("${product.label} · ${product.serial}", subtitle = "Belum ada tanaman", enabled = !state.busy, onClick = { model.select(product) })
                }
            }
        }
        if (state.products.isEmpty() && state.garden?.sites.isNullOrEmpty() && state.catalogLoaded && !state.busy) item(key = "empty") {
            EmptyState(
                "Belum ada produk terhubung",
                "Aktifkan pot Smart Agro atau tambah kebun manual untuk mulai.",
                if (state.demo) "Akhiri latihan" else "Kelola produk & QR",
            ) {
                if (state.demo) model.logout() else model.navigate(Screen.ManageProducts)
            }
        }
    }

    if (addingSite) AddSiteSheet(state, model) { addingSite = false }
    state.garden?.slots?.find { it.id == plantingSlotId }?.let { slot -> PlantSlotSheet(slot, state, model) { plantingSlotId = null } }
    adviceSheetUnitId?.let { id ->
        val unit = state.units.find { it.id == id }
        if (unit != null) {
            HomeAdviceSheet(
                state = state,
                unit = unit,
                health = healths[unit.id] ?: health(state, unit, now),
                model = model,
                onDismiss = { adviceSheetUnitId = null },
                onOpenDetail = { adviceSheetUnitId = null; model.openUnit(unit) },
            )
        }
    }
}

/** Three tappable top sensor summary metrics for the front stacked plant; each jumps to Peak Chart for that sensor. */
@Composable private fun SensorMetricsStrip(h: Health, onSelect: (Sensor) -> Unit) {
    val p = palette
    val haptics = rememberHaptics()
    val narrow = LocalConfiguration.current.screenWidthDp / LocalDensity.current.fontScale < 310
    val items = listOf(
        Triple(Sensor.Moisture, PhosphorPaths.DropFill, p.water),
        Triple(Sensor.Temperature, PhosphorPaths.Thermometer, p.sun),
        Triple(Sensor.Ph, PhosphorPaths.Flask, p.tint),
    )
    if (narrow) {
        Group(Modifier.padding(bottom = 12.dp), inset = 54.dp) {
            items.forEach { (sensor, glyph, accent) ->
                Cell(
                    sensor.label,
                    value = reading(sensor, h.value(sensor)),
                    glyph = glyph,
                    glyphColor = accent,
                    onClick = { haptics.tick(); onSelect(sensor) },
                )
            }
        }
    } else {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(bottom = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            items.forEach { (sensor, glyph, accent) ->
                val value = reading(sensor, h.value(sensor))
                Column(
                    Modifier
                        .weight(1f)
                        .clip(RoundedCornerShape(20.dp))
                        .background(p.cell)
                        .border(.75.dp, p.separator, RoundedCornerShape(20.dp))
                        .clickable(role = Role.Button) { haptics.tick(); onSelect(sensor) }
                        .padding(horizontal = 12.dp, vertical = 11.dp)
                        .semantics(mergeDescendants = true) {
                            contentDescription = "${sensor.label} $value. Ketuk untuk membuka grafik."
                        },
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Box(
                            Modifier.size(22.dp).clip(CircleShape).background(accent.copy(alpha = if (p.dark) .22f else .14f)),
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(icon(glyph), null, Modifier.size(13.dp), tint = accent)
                        }
                        Text(value, style = T.headline, color = p.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    }
                    Spacer(Modifier.height(4.dp))
                    Text(sensor.label, style = T.caption, color = p.secondary, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
        }
    }
}

/**
 * Apple Wallet-style vertical layered plant stack: up to two back cards peek above the active front card.
 * Tapping a back card or swiping the front card rotates registered plants smoothly with zero bounce.
 */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable private fun PlantWalletDeck(
    state: AppState,
    units: List<PlantUnit>,
    activeIndex: Int,
    healths: Map<String, Health>,
    autoRotate: Boolean,
    onToggleAuto: (() -> Unit)?,
    onPauseAuto: () -> Unit,
    onPromote: (PlantUnit) -> Unit,
    onOpen: (PlantUnit) -> Unit,
    onOpenHistory: (PlantUnit) -> Unit,
    onOpenWeb: () -> Unit,
) {
    val p = palette
    val haptics = rememberHaptics()
    val active = units[activeIndex]
    val activeHealth = healths.getValue(active.id)
    val nextUnit = if (units.size >= 2) units[(activeIndex + 1) % units.size] else null
    val thirdUnit = if (units.size >= 3) units[(activeIndex + 2) % units.size] else null
    var cutaway by rememberSaveable(active.id) { mutableStateOf(false) }
    var cardBounds by remember { mutableStateOf<androidx.compose.ui.geometry.Rect?>(null) }
    var menuOpen by remember { mutableStateOf(false) }
    var dragAccum by remember { mutableFloatStateOf(0f) }
    val pauseAuto by rememberUpdatedState(onPauseAuto)
    val promote by rememberUpdatedState(onPromote)

    val linkedCycle = state.garden?.plants?.firstOrNull { it.unitId == active.id && it.endedOn == null }
    val species = remember(linkedCycle?.species, active.crop) {
        linkedCycle?.let { SpeciesCatalog.byCode(it.species) } ?: SpeciesCatalog.ofCrop(active.crop)
    }
    val cycleDays = remember(linkedCycle?.plantedOn, state.demo, java.time.LocalDate.now()) {
        linkedCycle?.let { java.time.temporal.ChronoUnit.DAYS.between(it.plantedOn, java.time.LocalDate.now()).toInt().coerceAtLeast(0) }
            ?: 35.takeIf { state.demo }
    }

    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
        // Deck header + auto-cycle switch
        Row(
            Modifier.fillMaxWidth().padding(start = 4.dp, end = 2.dp, bottom = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Text("Kartu tanaman", style = T.title3, color = p.ink, modifier = Modifier.weight(1f))
            if (units.size > 1) {
                Text("${activeIndex + 1}/${units.size}", style = T.footnote.copy(fontWeight = FontWeight.Medium), color = p.secondary)
                Row(
                    Modifier
                        .clip(RoundedCornerShape(50))
                        .background(if (autoRotate) p.tint else p.fill)
                        .clickable(enabled = onToggleAuto != null, role = Role.Switch) { onToggleAuto?.invoke() }
                        .padding(horizontal = 12.dp, vertical = 6.dp)
                        .semantics(mergeDescendants = true) {
                            stateDescription = when {
                                 onToggleAuto == null -> "Gerakan dikurangi"
                                 autoRotate -> "Aktif"
                                 else -> "Nonaktif"
                             }
                        },
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(5.dp),
                ) {
                    Icon(icon(PhosphorPaths.ArrowsClockwise), null, Modifier.size(13.dp), tint = if (autoRotate) p.onTint else p.secondary)
                    Text(if (onToggleAuto == null) "Gerakan dikurangi" else "Putar otomatis", style = T.caption, color = if (autoRotate) p.onTint else p.ink, maxLines = 1)
                }
            }
        }

        // Stacked back cards + active front card (Apple Wallet layered overlap)
        val back2Offset = 0.dp
        val back1Offset = if (thirdUnit != null) 38.dp else 0.dp
        val frontOffset = when {
            thirdUnit != null -> 76.dp
            nextUnit != null -> 40.dp
            else -> 0.dp
        }
        val sageBackBg = if (p.dark) Color(0xFF234A34) else Color(0xFF7BE089)
        val sageBackInk = if (p.dark) Color(0xFFE6F6E9) else Color(0xFF0E2918)
        val darkBackBg = if (p.dark) Color(0xFF0C1510) else Color(0xFF15241B)
        val darkBackInk = Color(0xFFF0F6F1)

        // Front active card content shared between main deck and long-press context menu preview.
        val frontFace: @Composable (Modifier) -> Unit = { m ->
            Column(
                m
                    .clip(RoundedCornerShape(28.dp))
                    .background(p.cell)
                    .border(.75.dp, p.separator, RoundedCornerShape(28.dp))
                    .padding(14.dp),
            ) {
                AnimatedContent(
                    active,
                    transitionSpec = { fadeIn(tween(220)) togetherWith fadeOut(tween(180)) },
                    label = "Kartu depan",
                ) { u ->
                    val h = healths.getValue(u.id)
                    val sp = state.garden?.plants?.firstOrNull { it.unitId == u.id && it.endedOn == null }
                        ?.let { SpeciesCatalog.byCode(it.species) } ?: SpeciesCatalog.ofCrop(u.crop)
                    Column {
                        Row(
                            Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(14.dp))
                                .combinedClickable(
                                    interactionSource = remember { MutableInteractionSource() },
                                    indication = null,
                                    role = Role.Button,
                                    onLongClickLabel = "Pilihan lainnya",
                                    onLongClick = { haptics.success(); menuOpen = true },
                                ) { haptics.press(); onOpen(u) },
                            verticalAlignment = Alignment.Top,
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(u.name, style = T.title2, color = p.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
                                Text("${u.crop} \u00b7 ${state.plantCode(u)}", style = T.subhead, color = p.secondary, modifier = Modifier.padding(top = 2.dp))
                            }
                            Row(
                                Modifier
                                    .clip(RoundedCornerShape(50))
                                    .background(if (h.attention) p.warn.copy(alpha = .15f) else p.soft)
                                    .padding(horizontal = 10.dp, vertical = 6.dp),
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(6.dp),
                            ) {
                                Box(Modifier.size(7.dp).clip(CircleShape).background(if (h.attention) p.warn else p.tint))
                                Text(
                                    h.status,
                                    style = T.caption,
                                    color = if (h.attention) p.warn else p.onSoft,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                            }
                        }
                        Spacer(Modifier.height(8.dp))
                        Box(
                            Modifier
                                .fillMaxWidth()
                                .height(156.dp)
                                .clip(RoundedCornerShape(20.dp))
                                .background(
                                    Brush.verticalGradient(
                                        if (p.dark) listOf(Color(0xFF17241D), Color(0xFF1E2A23))
                                        else listOf(Color(0xFFEAF3E4), Color(0xFFF6F9F2)),
                                    ),
                                ),
                        ) {
                            PlantScene(
                                Modifier.fillMaxSize().padding(vertical = 2.dp),
                                onion = sp.speciesId == 2,
                                speciesId = sp.speciesId,
                                moisture = h.moisture,
                                cutaway = cutaway,
                                day = cycleDays,
                                interactive = true,
                            )
                            Box(
                                Modifier
                                    .align(Alignment.TopEnd)
                                    .padding(8.dp)
                                    .clip(RoundedCornerShape(50))
                                    .background(if (p.dark) p.raised.copy(alpha = .88f) else Color.White.copy(alpha = .86f))
                                    .border(.75.dp, p.separator, RoundedCornerShape(50))
                                    .clickable(role = Role.Switch) { haptics.tick(); cutaway = !cutaway }
                                    .padding(horizontal = 10.dp, vertical = 5.dp),
                            ) {
                                Text(if (cutaway) "Tutup pot" else "Lihat akar", style = T.caption, color = p.ink)
                            }
                        }
                        Spacer(Modifier.height(10.dp))
                        Row(
                            Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            PrimaryButton("Buka detail", { onOpen(u) }, Modifier.weight(1f), path = PhosphorPaths.ArrowUpRight)
                            if (units.size > 1 && nextUnit != null) {
                                TintedButton("Ganti", { onPromote(nextUnit) }, path = PhosphorPaths.ArrowsLeftRight)
                            }
                        }
                    }
                }
            }
        }

        Box(Modifier.fillMaxWidth()) {
            // Layer 0 (topmost peeking sage card)
            if (thirdUnit != null) {
                val h3 = healths.getValue(thirdUnit.id)
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(top = back2Offset, start = 20.dp, end = 20.dp)
                        .height(62.dp)
                        .clip(RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp))
                        .background(sageBackBg)
                        .clickable(role = Role.Button) { onPromote(thirdUnit) }
                        .padding(horizontal = 16.dp, vertical = 10.dp)
                        .semantics(mergeDescendants = true) {
                            contentDescription = "Pilih kartu ${thirdUnit.name}, kelembapan ${percent(h3.moisture)}"
                        },
                    verticalAlignment = Alignment.Top,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(thirdUnit.name, style = T.subhead.copy(fontWeight = FontWeight.SemiBold), color = sageBackInk, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    Text(percent(h3.moisture), style = T.subhead.copy(fontWeight = FontWeight.SemiBold), color = sageBackInk, modifier = Modifier.padding(start = 10.dp))
                }
            }
            // Layer 1 (middle deep-forest card)
            if (nextUnit != null) {
                val h2 = healths.getValue(nextUnit.id)
                Row(
                    Modifier
                        .fillMaxWidth()
                        .padding(top = back1Offset, start = 10.dp, end = 10.dp)
                        .height(64.dp)
                        .clip(RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp))
                        .background(darkBackBg)
                        .border(.75.dp, Color.White.copy(alpha = .1f), RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp))
                        .clickable(role = Role.Button) { onPromote(nextUnit) }
                        .padding(horizontal = 16.dp, vertical = 10.dp)
                        .semantics(mergeDescendants = true) {
                            contentDescription = "Pilih kartu ${nextUnit.name}, kelembapan ${percent(h2.moisture)}"
                        },
                    verticalAlignment = Alignment.Top,
                    horizontalArrangement = Arrangement.SpaceBetween,
                ) {
                    Text(nextUnit.name, style = T.subhead.copy(fontWeight = FontWeight.SemiBold), color = darkBackInk, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                    Text(percent(h2.moisture), style = T.subhead.copy(fontWeight = FontWeight.SemiBold), color = Color(0xFFA6E39D), modifier = Modifier.padding(start = 10.dp))
                }
            }

            Box(
                Modifier
                    .fillMaxWidth()
                    .padding(top = frontOffset)
                    .onGloballyPositioned { cardBounds = it.boundsInWindow() }
                    .shadow(16.dp, RoundedCornerShape(28.dp), ambientColor = p.shadow, spotColor = p.shadow)
                    .zoom("unit-${active.id}")
                    .pointerInput(Unit) {
                         awaitEachGesture {
                             awaitFirstDown(requireUnconsumed = false, pass = PointerEventPass.Initial)
                             pauseAuto()
                         }
                     }
                     .pointerInput(units, activeIndex) {
                        if (units.size <= 1) return@pointerInput
                        detectHorizontalDragGestures(
                            onDragStart = { dragAccum = 0f },
                            onHorizontalDrag = { _, amount -> dragAccum += amount },
                            onDragEnd = {
                                if (dragAccum < -64.dp.toPx()) promote(units[(activeIndex + 1) % units.size])
                                else if (dragAccum > 64.dp.toPx()) promote(units[(activeIndex - 1 + units.size) % units.size])
                                dragAccum = 0f
                            },
                            onDragCancel = { dragAccum = 0f },
                        )
                    },
            ) {
                frontFace(Modifier.fillMaxWidth())
            }
        }

        val anchor = cardBounds
        if (menuOpen && anchor != null) {
            ContextMenu(
                anchor,
                { menuOpen = false },
                listOf(
                    MenuAction("Buka detail", PhosphorPaths.ArrowUpRight) { onOpen(active) },
                    MenuAction("Riwayat sensor", PhosphorPaths.ClockCounterClockwise) { onOpenHistory(active) },
                    MenuAction("Kelola di website", PhosphorPaths.LinkSimple) { onOpenWeb() },
                ),
            ) { frontFace(Modifier.fillMaxSize()) }
        }
    }
}

/** Interactive mascot care card paired directly beneath the Apple Wallet plant card stack. */
@Composable private fun MascotCareCard(state: AppState, unit: PlantUnit, health: Health, onOpenAdvice: () -> Unit) {
    val p = palette
    val haptics = rememberHaptics()
    val mood = mascotMoodFor(health)
    val stored = state.explanation.takeIf { state.explanationUnitId == unit.id }
    val (headline, detail) = when {
        stored != null -> stored.action to stored.reason
        state.demoAdvice[unit.id] != null -> state.demoAdvice.getValue(unit.id)
        health.attention -> "${unit.name} perlu dicek" to health.status
        health.waiting -> "Menunggu bacaan terbaru" to "Perangkat belum mengirim paket dalam 75 menit terakhir."
        else -> "Tanaman tampak tenang" to "Ketuk untuk melihat panduan perawatan dan ekspresi maskot."
    }
    Row(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 14.dp)
            .clip(RoundedCornerShape(24.dp))
            .background(p.cell)
            .border(.75.dp, p.separator, RoundedCornerShape(24.dp))
            .clickable(role = Role.Button) { haptics.press(); onOpenAdvice() }
            .padding(14.dp)
            .semantics(mergeDescendants = true) { },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Mascot(Modifier.size(66.dp, 76.dp), mood = mood, interactive = false)
        Column(Modifier.weight(1f)) {
            MascotPill(mood)
            Text(headline, style = T.headline, color = p.ink, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 6.dp))
            Text(detail, style = T.footnote, color = p.secondary, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 2.dp))
        }
        Icon(icon(PhosphorPaths.CaretRightBold), null, Modifier.size(16.dp), tint = p.tertiary)
    }
}

/** Advice modal sheet featuring the interactive 6-state Mascot Stage, real advice text, and Peak Chart preview. */
@Composable private fun HomeAdviceSheet(
    state: AppState,
    unit: PlantUnit,
    health: Health,
    model: AgroViewModel,
    onDismiss: () -> Unit,
    onOpenDetail: () -> Unit,
) {
    val p = palette
    val defaultMood = remember(unit.id, health) { mascotMoodFor(health) }
    var previewMood by remember(unit.id, defaultMood) { mutableStateOf(defaultMood) }
    val stored = state.explanation.takeIf { state.explanationUnitId == unit.id }
    val demoPair = state.demoAdvice[unit.id]
    val moistureReadings = remember(state.history, unit.id) {
        if (state.selectedUnit?.id == unit.id) state.history.filter { it.sensor == Sensor.Moisture } else emptyList()
    }

    AgroSheet("Saran · ${unit.name}", onDismiss) {
        MascotStage(
            mood = previewMood,
            caption = if (previewMood == defaultMood) "${unit.name}: ${health.status}" else previewMood.caption,
            previewMoods = listOf(MascotMood.Care, MascotMood.Reading, MascotMood.Working, MascotMood.Happy),
            onSelectMood = { previewMood = it },
        )
        Spacer(Modifier.height(14.dp))
        Panel {
            when {
                stored != null -> {
                    Text(stored.action, style = T.title3, color = p.ink)
                    Text(stored.reason, style = T.body, color = p.secondary, modifier = Modifier.padding(top = 6.dp))
                }
                demoPair != null -> {
                    Text(demoPair.first, style = T.title3, color = p.ink)
                    Text(demoPair.second, style = T.body, color = p.secondary, modifier = Modifier.padding(top = 6.dp))
                    Text("Hasil aturan dari skenario latihan; bukan diagnosis tanaman fisik Anda.", style = T.footnote, color = p.secondary, modifier = Modifier.padding(top = 8.dp))
                }
                else -> {
                    Text("Kondisi ${unit.name}", style = T.title3, color = p.ink)
                    Text("Kelembapan ${percent(health.moisture)} · Suhu ${reading(Sensor.Temperature, health.temperature)} · pH ${reading(Sensor.Ph, health.ph)}.", style = T.body, color = p.secondary, modifier = Modifier.padding(top = 4.dp))
                    if (!state.demo) {
                        TintedButton("Muat saran berbasis bukti", model::loadExplanation, Modifier.padding(top = 12.dp).fillMaxWidth(), busy = state.explanationBusy, path = PhosphorPaths.Sparkle)
                    }
                }
            }
        }
        if (moistureReadings.size >= 2) {
            Spacer(Modifier.height(12.dp))
            Box(Modifier.padding(horizontal = 16.dp)) {
                TrendChart(moistureReadings, Sensor.Moisture, p.water)
            }
        }
        PrimaryButton("Buka detail tanaman", onOpenDetail, Modifier.padding(16.dp).fillMaxWidth(), path = PhosphorPaths.ArrowUpRight)
    }
}

@Composable internal fun RefreshAction(state: AppState, model: AgroViewModel) {
    if (state.demo) return
    if (state.busy) Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) { ActivityIndicator() }
    else BarButton(PhosphorPaths.ArrowsClockwise, "Segarkan", model::refreshCurrent)
}

/** Demo and status messages at the top of a screen, in the interface rather than in a dialog. */
internal fun androidx.compose.foundation.lazy.LazyListScope.notices(state: AppState) {
    if (state.demo) item(key = "demo") { Banner("Mode latihan · data sintetis dari skenario web", Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) }
    state.message?.let { message -> item(key = "message") { Banner(message, Modifier.padding(horizontal = 16.dp, vertical = 4.dp), state.messageIsError) } }
}

@Composable private fun TileRow(padEmptyHalf: Boolean, content: @Composable RowScope.() -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        content()
        if (padEmptyHalf) Spacer(Modifier.weight(1f))
    }
}

/** A plant as an Apple Home-style tile (used for garden sites without dedicated sensor stack). */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable private fun PlantTile(name: String, detail: String, moisture: Double?, status: String, attention: Boolean, modifier: Modifier,
                                  zoomKey: String? = null, menu: List<MenuAction> = emptyList(), onClick: () -> Unit) {
    val haptics = rememberHaptics()
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) .96f else 1f, Springs.snappy(), label = "Tekan ubin")
    var bounds by remember { mutableStateOf<androidx.compose.ui.geometry.Rect?>(null) }
    var menuOpen by remember { mutableStateOf(false) }
    val face: @Composable (Modifier) -> Unit = { m -> TileFace(name, detail, moisture, status, attention, m) }
    Box(modifier.onGloballyPositioned { bounds = it.boundsInWindow() }.graphicsLayer { scaleX = scale; scaleY = scale }
        .then(if (zoomKey != null) Modifier.zoom(zoomKey) else Modifier).clip(RoundedCornerShape(22.dp))
        .combinedClickable(source, null, role = Role.Button, onLongClickLabel = if (menu.isEmpty()) null else "Pilihan lainnya",
            onLongClick = if (menu.isEmpty()) null else ({ haptics.success(); menuOpen = true })) { haptics.press(); onClick() }
        .semantics(mergeDescendants = true) { stateDescription = "Kelembapan ${percent(moisture)}, $status" }) { face(Modifier) }
    val anchor = bounds
    if (menuOpen && anchor != null) ContextMenu(anchor, { menuOpen = false }, menu) { face(Modifier.fillMaxSize()) }
}

@Composable private fun TileFace(name: String, detail: String, moisture: Double?, status: String, attention: Boolean, modifier: Modifier) {
    val p = palette
    Column(modifier.clip(RoundedCornerShape(22.dp)).background(p.cell).padding(14.dp)) {
        Row(verticalAlignment = Alignment.Top) {
            MoistureRing(moisture, size = 48.dp, stroke = 5.dp) {
                Icon(icon(PhosphorPaths.PlantFill), null, Modifier.size(22.dp), tint = if (attention) p.warn else p.tint)
            }
            Spacer(Modifier.weight(1f))
            RollingText(percent(moisture), T.headline, p.ink)
        }
        Spacer(Modifier.height(14.dp))
        Text(name, style = T.headline, color = p.ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
        Text(detail, style = T.footnote, color = p.secondary, maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(top = 2.dp))
        Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Box(Modifier.size(8.dp).clip(CircleShape).background(if (attention) p.warn else p.tint))
            Text(status, style = T.footnote.copy(fontWeight = FontWeight.Medium), color = if (attention) p.warn else p.secondary)
        }
    }
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

// ---------------------------------------------------------------- Plant detail

/** One plant: the ring with its number, interactive 2D stage, advice + mascot, readings, Peak Chart, and weather. */
@Composable internal fun PlantDetail(state: AppState, model: AgroViewModel) {
    val p = palette
    val unit = state.selectedUnit ?: return
    val now = rememberNow()
    val h = health(state, unit, now)
    val product = state.products.find { it.id == unit.productId }
    var renaming by rememberSaveable(unit.id) { mutableStateOf(false) }
    var why by rememberSaveable(unit.id) { mutableStateOf(false) }
    var cutaway by rememberSaveable(unit.id) { mutableStateOf(false) }
    var sensor by rememberSaveable(unit.id) { mutableStateOf(Sensor.Moisture) }
    var range by rememberSaveable(unit.id) { mutableIntStateOf(0) }
    val uri = rememberSafeUriHandler()
    val linkedCycle = state.garden?.plants?.firstOrNull { it.unitId == unit.id && it.endedOn == null }
    val species = remember(linkedCycle?.species, unit.crop) {
        linkedCycle?.let { SpeciesCatalog.byCode(it.species) } ?: SpeciesCatalog.ofCrop(unit.crop)
    }
    val cycleDays = remember(linkedCycle?.plantedOn, state.demo, java.time.LocalDate.now()) {
        linkedCycle?.let { java.time.temporal.ChronoUnit.DAYS.between(it.plantedOn, java.time.LocalDate.now()).toInt().coerceAtLeast(0) }
            ?: 35.takeIf { state.demo }
    }
    LaunchedEffect(unit.id, state.demo, state.email) {
        if (!state.demo && state.email.isNotBlank() && (!state.careLoaded || state.careUnitId != unit.id)) {
            model.loadCareJournal(unit.id)
        }
    }
    val weather = state.weather.takeIf { state.weatherSiteId == state.weatherSite?.id }
    val outdoor = state.weatherSite?.placement?.let { it != "indoor" } == true
    val hour = weather?.at?.substring(11, 13)?.toIntOrNull() ?: java.time.LocalTime.now().hour
    val sky = skyFor(hour, weather?.condition, outdoor)
    TitledScreen(unit.name, Modifier.zoom("unit-${unit.id}"), subtitle = "${unit.crop} \u00b7 ${state.plantCode(unit)}", back = if (state.dashboardFromGarden) "Kebun" else "Tanaman", onBack = model::back,
        actions = { BarButton(PhosphorPaths.PencilSimple, "Ubah nama tanaman", { renaming = true }, enabled = !state.busy) }) {
        notices(state)
        item(key = "hero") {
            Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(top = 4.dp).clip(RoundedCornerShape(28.dp)), contentAlignment = Alignment.Center) {
                SkyBackdrop(sky, weather?.condition, Modifier.matchParentSize())
                Column(Modifier.padding(vertical = 28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    MoistureRing(h.moisture, size = 188.dp, stroke = 15.dp, color = Color.White) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            RollingText(percent(h.moisture), T.figure, Color.White)
                            Text("kelembapan tanah", style = T.subhead.copy(fontWeight = FontWeight.Medium), color = Color.White, textAlign = TextAlign.Center)
                        }
                    }
                    Text(h.status, Modifier.padding(top = 16.dp, start = 20.dp, end = 20.dp), style = T.title3, color = Color.White, textAlign = TextAlign.Center)
                    weather?.takeIf { outdoor }?.let { Text("${it.label} \u00b7 ${number(it.tempC)}\u00b0", style = T.headline, color = Color.White, modifier = Modifier.padding(top = 2.dp)) }
                }
            }
            val moistureSample = h.samples[Sensor.Moisture]
            Text(when {
                state.demo -> "Data sintetis"
                moistureSample != null -> "Diukur ${time(moistureSample.at)}"
                else -> "Menunggu bacaan pertama"
            }, Modifier.fillMaxWidth().padding(top = 8.dp),
                style = T.footnote, color = p.secondary, textAlign = TextAlign.Center)
        }
        item(key = "stage-title") { SectionTitle("Kondisi pot") }
        item(key = "stage") {
            Panel {
                PlantScene(
                    Modifier.fillMaxWidth().height(232.dp),
                    onion = species.speciesId == 2,
                    speciesId = species.speciesId,
                    moisture = h.moisture,
                    cutaway = cutaway,
                    day = cycleDays,
                    interactive = true,
                    daylight = if (outdoor) weather?.condition != "malam" else null,
                    cloudy = weather?.condition in listOf("berawan", "mendung", "hujan"),
                )
                ToggleCell("Lihat akar & media", cutaway, { cutaway = it })
                val moistureStatus = h.sensorStatuses.getValue(Sensor.Moisture)
                Text(
                    if (!state.demo && moistureStatus != SensorStatus.Ready) moistureStatus.label
                    else "Ketuk daun untuk melihat respons pot.",
                    style = T.footnote, color = p.secondary,
                )
                if (cycleDays == null) Text("Tanggal tanam belum dicatat", style = T.footnote, color = p.secondary)
            }
        }
        item(key = "advice-title") { SectionTitle("Saran") }
        item(key = "advice") { Advice(state, unit, h) { why = true } }
        if (!species.curated) {
            item(key = "learning-title") { SectionTitle("Mode belajar") }
            item(key = "learning") {
                if (!state.demo && (!state.careLoaded || state.careUnitId != unit.id || state.careNext != null)) {
                    Footnote("Muat riwayat perawatan sebelum menghitung pola pot.")
                    PlainButton("Muat riwayat perawatan", {
                        if (state.careNext != null) model.loadOlderCareJournal() else model.loadCareJournal(unit.id)
                    }, Modifier.padding(horizontal = 16.dp), enabled = !state.busy)
                } else {
                    val journal = state.careJournal.filter { it.unitId == unit.id }
                    val (summary, lastCheck) = remember(species.name, state.history, journal) {
                        ObservationEngine.fromHistory(species.name, state.history, journal)
                    }
                    ModeBelajarCard(species.name, summary, lastCheck, state.busy) { picked ->
                        logLearningCheck(model, unit.id, picked)
                    }
                }
            }
        }
        item(key = "readings-title") { SectionTitle("Bacaan") }
        item(key = "readings") {
            Group(inset = 60.dp, footer = product?.let { "Perangkat ${it.serial} · bacaan tiap 30 menit" }) {
                Sensor.entries.forEach { s ->
                    val (path, color) = when (s) { Sensor.Moisture -> PhosphorPaths.DropFill to p.water; Sensor.Temperature -> PhosphorPaths.Thermometer to p.sun; Sensor.Ph -> PhosphorPaths.Flask to p.tint }
                    Cell(s.label.let { if (s == Sensor.Moisture) "Kelembapan" else it }, glyph = path, glyphColor = color, value = reading(s, h.value(s)),
                        subtitle = h.sensorStatuses.getValue(s).takeUnless { state.demo || it == SensorStatus.Ready }?.label, chevron = false,
                        trailing = { if (sensor == s) Icon(icon(PhosphorPaths.ChartLine), "Ditampilkan di tren", Modifier.size(18.dp), tint = p.tint) },
                        onClick = { sensor = s })
                }
            }
        }
        item(key = "trend-title") { SectionTitle("Tren") }
        item(key = "trend") {
            Column(Modifier.padding(horizontal = 16.dp)) {
                Segmented(listOf("24 jam", "7 hari"), range, { range = it })
                Spacer(Modifier.height(12.dp))
                val latest = state.history.maxOfOrNull { it.at }
                val since = latest?.minus(if (range == 0) Duration.ofHours(24) else Duration.ofDays(7))
                TrendChart(
                    state.history.filter { it.sensor == sensor && since != null && !it.at.isBefore(since) },
                    sensor,
                    when (sensor) { Sensor.Moisture -> p.water; Sensor.Temperature -> p.sun; Sensor.Ph -> p.tint },
                    waterings = state.careJournal.filter { it.unitId == unit.id && it.kind == "watering" },
                )
                if (state.historyHasMore) PlainButton("Muat bacaan lebih lama", model::loadOlderHistory, Modifier.padding(top = 6.dp), enabled = !state.busy)
            }
        }
        state.weatherSite?.takeIf { !state.demo }?.let { site ->
            item(key = "weather-title") { SectionTitle("Cuaca di ${site.name}") }
            item(key = "weather") { WeatherSection(site, state.weather.takeIf { state.weatherSiteId == site.id }, state.weatherBusy, state.weatherMessage, model::loadWeather) }
        }
        item(key = "more") {
            Spacer(Modifier.height(20.dp))
            Group(inset = 60.dp) {
                Cell("Riwayat sensor", glyph = PhosphorPaths.ClockCounterClockwise, glyphColor = p.secondary, onClick = { model.openHistoryFor(unit, sensor) })
                Cell("Kelola pot di website", glyph = PhosphorPaths.LinkSimple, glyphColor = p.secondary, onClick = { uri.openUri(WEB + "#simulasi") })
            }
        }
    }
    if (renaming) RenameSheet(unit.name, state.busy, { renaming = false }) { model.renameUnit(it); renaming = false }
    if (why) AgroSheet("Kenapa?", { why = false }) {
        ExplanationSection(state.explanation.takeIf { state.explanationUnitId == unit.id }, state.explanationBusy, state.explanationMessage,
            model::loadExplanation, model::explain, state.explanationUnitId == unit.id && state.explanationDeviceId != null)
    }
}

@Composable private fun Advice(state: AppState, unit: PlantUnit, health: Health, why: () -> Unit) {
    val p = palette
    val stored = state.explanation.takeIf { state.explanationUnitId == unit.id }
    val (action, reason) = stored?.let { it.action to it.reason } ?: state.demoAdvice[unit.id] ?: (null to null)
    val mood = mascotMoodFor(health)
    Panel {
        when {
            action != null -> {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(action, style = T.title3, color = p.ink, modifier = Modifier.weight(1f))
                    MascotPill(mood)
                }
                Text(reason.orEmpty(), style = T.body, color = p.secondary, modifier = Modifier.padding(top = 6.dp))
                if (state.demo) Text("Hasil aturan dari skenario web; bukan diagnosis tanaman Anda.", style = T.footnote, color = p.secondary, modifier = Modifier.padding(top = 8.dp))
            }
            state.explanationBusy -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                ActivityIndicator(); Text("Memuat saran tersimpan…", style = T.body, color = p.secondary)
            }
            else -> Text(state.explanationMessage ?: "Belum ada saran tersimpan untuk tanaman ini. Minta saran dari bacaan terbaru.", style = T.body, color = p.secondary)
        }
        if (!state.demo) TintedButton(if (action == null) "Minta saran" else "Kenapa?", why, Modifier.padding(top = 14.dp).fillMaxWidth(), path = PhosphorPaths.Sparkle)
    }
}

@Composable private fun RenameSheet(current: String, busy: Boolean, dismiss: () -> Unit, save: (String) -> Unit) {
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

internal fun chartTimeFraction(at: Instant, first: Instant, last: Instant): Float {
    val span = Duration.between(first, last).toMillis()
    return if (span <= 0) .5f else (Duration.between(first, at).toMillis().toDouble() / span).toFloat().coerceIn(0f, 1f)
}

internal fun chartSampleIndex(x: Float, width: Float, inset: Float, positions: List<Float>): Int {
    val fraction = (x - inset) / (width - 2 * inset).coerceAtLeast(1f)
    return positions.indices.minBy { kotlin.math.abs(positions[it] - fraction) }
}

@Composable internal fun TrendChart(
    readings: List<Reading>,
    sensor: Sensor,
    color: Color,
    modifier: Modifier = Modifier,
    selectedAt: Instant? = null,
    onSelect: ((Reading?) -> Unit)? = null,
    waterings: List<CareEntry> = emptyList(),
) {
    val p = palette
    val haptics = rememberHaptics()
    val segments = remember(readings, sensor) { chartSegments(readings, sensor) }
    val points = remember(segments) { segments.flatten() }
    var scrubIdx by remember(points) { mutableStateOf<Int?>(null) }

    val cardBg = Brush.verticalGradient(
        if (p.dark) listOf(Color(0xFF192720), p.cell) else listOf(Color(0xFFEFF6E9), p.cell),
    )

    if (points.size < 2) {
        Box(
            modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(22.dp))
                .background(cardBg)
                .border(.75.dp, p.separator, RoundedCornerShape(22.dp))
                .padding(horizontal = 18.dp, vertical = 26.dp),
        ) {
            Text("Belum cukup bacaan untuk grafik ini.", style = T.subhead, color = p.secondary)
        }
        return
    }

    val first = points.first().at
    val last = points.last().at
    val positions = remember(points) { points.map { chartTimeFraction(it.at, first, last) } }
    val visibleWaterings = remember(waterings, sensor, first, last) {
        if (sensor == Sensor.Moisture) waterings.filter { it.observedAt in first..last }.sortedBy { it.observedAt }
        else emptyList()
    }
    val reveal = remember(points, sensor) { Animatable(0f) }
    LaunchedEffect(points, sensor) {
        reveal.snapTo(0f)
        reveal.animateTo(1f, tween(520, easing = CubicBezierEasing(0.22f, 1f, 0.36f, 1f)))
    }

    val values = remember(points) { points.map { it.value!! } }
    val minVal = values.min()
    val peakIdx = remember(values) { values.indices.maxByOrNull { values[it] } ?: values.lastIndex }
    val peakVal = values[peakIdx]
    val span = when (sensor) { Sensor.Moisture -> 10.0; Sensor.Temperature -> 2.0; Sensor.Ph -> .5 }
    val mid = (peakVal + minVal) / 2.0
    val lo = minOf(minVal, mid - span / 2.0)
    val hi = maxOf(peakVal, mid + span / 2.0)

    val syncedIdx = remember(points, selectedAt) { selectedAt?.let { target -> points.indexOfFirst { it.at == target }.takeIf { it >= 0 } } }
    val activeIdx = scrubIdx ?: syncedIdx ?: points.lastIndex
    val shown = points[activeIdx]
    val isPinned = scrubIdx != null || syncedIdx != null
    val currentSelection by rememberUpdatedState(syncedIdx)
    val selectReading by rememberUpdatedState(onSelect)
    val chartInset = 6.dp
    fun selectSample(index: Int) {
        haptics.tick()
        val listener = selectReading
        if (listener == null) {
            scrubIdx = index
        } else {
            scrubIdx = null
            listener(points[index])
        }
    }

    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(22.dp))
            .background(cardBg)
            .border(.75.dp, p.separator, RoundedCornerShape(22.dp))
            .padding(16.dp),
    ) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Column(Modifier.weight(1f)) {
                Text(sensor.label, style = T.caption, color = p.secondary)
                Text(reading(sensor, shown.value), style = T.title1, color = p.ink, modifier = Modifier.padding(top = 2.dp))
            }
            Column(horizontalAlignment = Alignment.End) {
                Box(
                    Modifier
                        .clip(RoundedCornerShape(50))
                        .background(color.copy(alpha = if (p.dark) .24f else .14f))
                        .padding(horizontal = 10.dp, vertical = 5.dp),
                ) {
                    Text(
                        "Puncak ${reading(sensor, peakVal)}",
                        style = T.caption.copy(fontWeight = FontWeight.SemiBold),
                        color = if (p.dark) p.ink else color,
                        maxLines = 1,
                    )
                }
                Text(
                    if (!isPinned) "Terakhir · ${time(shown.at)}" else time(shown.at),
                    style = T.footnote,
                    color = p.secondary,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
        }

        if (isPinned) {
            shown.receivedAt?.let {
                Text("Diterima ${time(it)}", style = T.footnote, color = p.secondary, modifier = Modifier.padding(top = 4.dp))
            }
        }
        val dashEffect = remember { PathEffect.dashPathEffect(floatArrayOf(6f, 6f), 0f) }
        Canvas(
            Modifier
                .fillMaxWidth()
                .height(182.dp)
                .padding(top = 12.dp)
                .pointerInput(points) {
                    detectTapGestures(onTap = { pos ->
                        val i = chartSampleIndex(pos.x, size.width.toFloat(), chartInset.toPx(), positions)
                        val listener = selectReading
                        haptics.tick()
                        if (listener != null) {
                            scrubIdx = null
                            listener(if (currentSelection == i) null else points[i])
                        } else {
                            scrubIdx = if (scrubIdx == i) null else i
                        }
                    })
                }
                .pointerInput(points) {
                    detectHorizontalDragGestures(
                        onDragEnd = { if (selectReading != null) scrubIdx = null },
                        onDragCancel = { scrubIdx = null },
                    ) { change, _ ->
                        val i = chartSampleIndex(change.position.x, size.width.toFloat(), chartInset.toPx(), positions)
                        if (scrubIdx != i) {
                            scrubIdx = i
                            haptics.tick()
                            selectReading?.invoke(points[i])
                        }
                    }
                }
                .semantics {
                    contentDescription = "${sensor.label}: terendah ${reading(sensor, minVal)}, puncak ${reading(sensor, peakVal)}, terakhir ${reading(sensor, values.last())}"
                    stateDescription = "Sampel ${activeIdx + 1} dari ${points.size}, ${time(shown.at)}, ${reading(sensor, shown.value)}"
                    customActions = buildList {
                        if (activeIdx > 0) {
                            add(CustomAccessibilityAction("Sampel sebelumnya") {
                                selectSample(activeIdx - 1)
                                true
                            })
                        }
                        if (activeIdx < points.lastIndex) {
                            add(CustomAccessibilityAction("Sampel berikutnya") {
                                selectSample(activeIdx + 1)
                                true
                            })
                        }
                    }
                },
        ) {
            val padY = 12.dp.toPx()
            val padX = chartInset.toPx()
            val usableW = (size.width - padX * 2).coerceAtLeast(1f)
            val usableH = (size.height - padY * 2).coerceAtLeast(1f)
            fun x(i: Int) = padX + usableW * positions[i]
            fun y(v: Double) = (padY + usableH * (1.0 - (v - lo) / (hi - lo))).toFloat().coerceIn(padY, size.height - padY)

            // Calm dashed horizontal guides
            for (k in 0..2) {
                val gy = padY + usableH * k / 2f
                drawLine(p.separator, Offset(0f, gy), Offset(size.width, gy), 1f, pathEffect = dashEffect)
            }

            val xs = FloatArray(points.size) { x(it) }
            val ys = FloatArray(points.size) { y(values[it]) }
            clipRect(right = size.width * reveal.value.coerceIn(0.02f, 1f)) {
                var start = 0
                for (segment in segments) {
                    val end = start + segment.lastIndex
                    if (end == start) {
                        drawCircle(color, 2.8.dp.toPx(), Offset(xs[start], ys[start]))
                    } else {
                        val line = Path().apply {
                            moveTo(xs[start], ys[start])
                            for (i in start until end) {
                                val midX = (xs[i] + xs[i + 1]) / 2f
                                cubicTo(midX, ys[i], midX, ys[i + 1], xs[i + 1], ys[i + 1])
                            }
                        }
                        val area = Path().apply {
                            addPath(line)
                            lineTo(xs[end], size.height)
                            lineTo(xs[start], size.height)
                            close()
                        }
                        drawPath(area, Brush.verticalGradient(listOf(color.copy(alpha = if (p.dark) .30f else .22f), Color.Transparent)))
                        drawPath(line, color, style = Stroke(2.8.dp.toPx(), cap = StrokeCap.Round))
                    }
                    start = end + 1
                }
            }

            for (event in visibleWaterings) {
                val markX = padX + usableW * chartTimeFraction(event.observedAt, first, last)
                drawLine(p.tint.copy(alpha = .65f), Offset(markX, padY), Offset(markX, size.height - padY),
                    strokeWidth = 1.dp.toPx(), pathEffect = dashEffect)
                drawCircle(p.tint, 3.dp.toPx(), Offset(markX, size.height - padY))
            }

            // Steady peak/active vertical cursor and halo.
            val markerIdx = if (isPinned) activeIdx else peakIdx
            val mx = xs[markerIdx]
            val my = ys[markerIdx]
            drawLine(color.copy(alpha = if (isPinned) .52f else .26f), Offset(mx, padY), Offset(mx, size.height - padY), 1.2.dp.toPx(), pathEffect = dashEffect)
            drawCircle(color.copy(alpha = .18f), 12.dp.toPx(), Offset(mx, my))
            drawCircle(p.cell, 6.5.dp.toPx(), Offset(mx, my))
            drawCircle(color, 4.5.dp.toPx(), Offset(mx, my))
        }

        Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(time(points.first().at), style = T.footnote, color = p.secondary)
            Text("Rendah ${reading(sensor, minVal)} · Tinggi ${reading(sensor, peakVal)}", style = T.footnote, color = p.secondary)
        }
        visibleWaterings.lastOrNull()?.let { event ->
            Text("${visibleWaterings.size} catatan siram · Terakhir ${time(event.observedAt)}",
                style = T.caption, color = p.tint, modifier = Modifier.padding(top = 4.dp))
        }
        Text("Geser atau ketuk grafik untuk memeriksa tiap titik.", style = T.caption, color = p.secondary, modifier = Modifier.padding(top = 4.dp))
    }
}
