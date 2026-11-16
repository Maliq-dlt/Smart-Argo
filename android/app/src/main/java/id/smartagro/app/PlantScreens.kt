package id.smartagro.app

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
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
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
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

/** What one unit's latest overview says, with stale or revoked data never shown as a current value. */
internal data class Health(val moisture: Double?, val temperature: Double?, val ph: Double?, val status: String,
                           val attention: Boolean, val waiting: Boolean, val at: Instant?) {
    fun value(sensor: Sensor) = when (sensor) { Sensor.Moisture -> moisture; Sensor.Temperature -> temperature; Sensor.Ph -> ph }
}
internal fun health(state: AppState, unit: PlantUnit, now: Instant): Health {
    val overview = state.overviews.find { it.id == unit.id }
    val stale = !state.demo && overview?.stale(now) != false
    val revoked = "device_revoked" in overview?.alerts.orEmpty()
    fun value(sensor: Sensor) = overview?.readings?.find { it.sensor == sensor && it.quality == "ok" && it.synced }
        ?.takeIf { state.demo || !stale && !revoked && fresh(it.at, now) }?.value
    val status = when {
        state.demo -> "Skenario latihan"
        revoked -> "Perangkat dicabut"
        stale -> "Menunggu data terbaru"
        else -> stateLabels[overview?.state] ?: "Data perangkat tersimpan"
    }
    val attention = !stale && (overview?.state in listOf("sedih_perhatian", "waspada_marah") ||
        overview?.alerts.orEmpty().any { it in listOf("sensor_error", "battery_low", "energy_deficit") }) || revoked
    return Health(value(Sensor.Moisture), value(Sensor.Temperature), value(Sensor.Ph), status, attention, stale && !revoked, overview?.at)
}

@Composable private fun rememberNow(): Instant {
    var now by remember { mutableStateOf(Instant.now()) }
    LaunchedEffect(Unit) { while (true) { delay(30_000); now = Instant.now() } }
    return now
}

// ---------------------------------------------------------------- Signature: the moisture ring

/**
 * Soil moisture as a ring, drawn once from empty to its value on a spring, like the Activity rings. The number and the
 * status in text carry the meaning; the ring only reinforces it (nothing by color alone).
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

// ---------------------------------------------------------------- Home

/** The Plants tab: one status line for everything, then each place with its plants as tiles (Apple Home's structure). */
@Composable internal fun PlantsHome(state: AppState, model: AgroViewModel) {
    val p = palette
    val now = rememberNow()
    var query by rememberSaveable { mutableStateOf("") }
    var productId by rememberSaveable { mutableStateOf<String?>(null) }
    val uri = rememberSafeUriHandler()
    val columns = if (LocalConfiguration.current.screenWidthDp / LocalDensity.current.fontScale < 300) 1 else 2
    val visible = state.units.filter { unit ->
        (productId == null || unit.productId == productId) && listOf(unit.name, unit.crop, state.plantCode(unit),
            state.products.find { it.id == unit.productId }?.serial.orEmpty()).any { it.contains(query.trim(), ignoreCase = true) }
    }
    val healths = state.units.associate { it.id to health(state, it, now) }
    TitledScreen("Tanaman saya", subtitle = "${state.garden?.plants?.count { it.endedOn == null } ?: state.units.size} tanaman · ${state.products.size} produk",
        actions = { RefreshAction(state, model) }) {
        notices(state)
        if (state.units.isNotEmpty()) item(key = "highlight") { Highlight(state, healths, model::openUnit) }
        state.garden?.let { garden ->
            garden.sites.forEach { site ->
                val plants = garden.plants.filter { it.siteId == site.id && it.endedOn == null }
                item(key = "site-${site.id}") {
                    SectionTitle(site.name) { Text(if (site.kind == "garden") "Kebun" else "Pot pribadi", style = T.subhead, color = p.secondary) }
                }
                items(plants.chunked(columns), key = { row -> "plants-" + row.joinToString { it.id } }) { row ->
                    TileRow(columns) {
                        row.forEach { plant ->
                            val unitHealth = plant.unitId?.let { healths[it] }
                            PlantTile(plant.name, "${plant.tag} · ${plant.zone}", unitHealth?.moisture,
                                unitHealth?.status ?: "Belum ada sensor", unitHealth?.attention == true, Modifier.weight(1f)) { model.openGarden(plant) }
                        }
                    }
                }
            }
            if (garden.emptySlots > 0) item { Footnote("${garden.emptySlots} zona belum ditanami. Atur di website.") }
        }
        if (state.units.isNotEmpty()) {
            item(key = "units-title") { SectionTitle(if (state.garden == null) "Unit perangkat" else "Unit perangkat terhubung") }
            item(key = "search") { SearchField(query, { query = it.take(120) }, "Cari nama, kode, atau produk", Modifier.padding(horizontal = 16.dp)) }
            if (state.products.size > 1) item(key = "filter") {
                Row(Modifier.horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Pill("Semua", productId == null) { productId = null }
                    state.products.forEach { product -> Pill("${product.label} · ${product.serial}", productId == product.id) { productId = product.id } }
                }
            } else item { Spacer(Modifier.height(10.dp)) }
            items(visible.chunked(columns), key = { row -> "units-" + row.joinToString { it.id } }) { row ->
                TileRow(columns) {
                    row.forEach { unit ->
                        val h = healths.getValue(unit.id)
                        PlantTile(unit.name, "${unit.crop} \u00b7 ${state.plantCode(unit)}", h.moisture, h.status, h.attention, Modifier.weight(1f), zoomKey = "unit-${unit.id}",
                            menu = listOf(MenuAction("Buka", PhosphorPaths.ArrowUpRight) { model.openUnit(unit) },
                                MenuAction("Riwayat sensor", PhosphorPaths.ClockCounterClockwise) { model.openUnit(unit); model.navigate(Screen.History) },
                                MenuAction("Kelola di website", PhosphorPaths.LinkSimple) { uri.openUri(WEB + "#simulasi") })) { model.openUnit(unit) }
                    }
                }
            }
            if (visible.isEmpty()) item { Footnote("Tidak ada tanaman yang cocok. Coba nama atau kode lain.") }
        }
        val bare = state.products.filter { product -> state.units.none { it.productId == product.id } }
        if (bare.isNotEmpty()) item(key = "bare") {
            SectionTitle("Produk tanpa tanaman")
            Group { bare.forEach { product -> Cell("${product.label} · ${product.serial}", subtitle = "Belum ada tanaman", enabled = !state.busy, onClick = { model.select(product) }) } }
        }
        if (state.products.isEmpty() && state.garden?.sites.isNullOrEmpty() && state.catalogLoaded && !state.busy) item(key = "empty") {
            EmptyState("Belum ada produk terhubung", "Aktifkan pot Smart Agro Anda, lalu tanamannya muncul di sini.", "Aktifkan produk di website") { uri.openUri(WEB + "#profil") }
        }
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

@Composable private fun TileRow(columns: Int, content: @Composable RowScope.() -> Unit) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        content()
        if (columns == 2) Unit
    }
}

@Composable private fun Highlight(state: AppState, healths: Map<String, Health>, open: (PlantUnit) -> Unit) {
    val p = palette
    val attention = state.units.filter { healths[it.id]?.attention == true }
    val waiting = state.units.count { healths[it.id]?.waiting == true }
    val (path, color, title, detail) = when {
        attention.size == 1 -> Quad(PhosphorPaths.WarningFill, p.warn, "${attention[0].name} perlu perhatian", healths.getValue(attention[0].id).status)
        attention.size > 1 -> Quad(PhosphorPaths.WarningFill, p.warn, "${attention.size} tanaman perlu perhatian", "Buka satu per satu untuk saran dan alasannya.")
        state.demo -> Quad(PhosphorPaths.Leaf, p.tint, "Skenario latihan", "Bacaan sintetis untuk mencoba aplikasi tanpa perangkat.")
        waiting == state.units.size -> Quad(PhosphorPaths.ClockCounterClockwise, p.secondary, "Menunggu data terbaru", "Perangkat belum mengirim bacaan dalam 75 menit terakhir.")
        else -> Quad(PhosphorPaths.CheckCircleFill, p.tint, "Semua tanaman tenang", "Bacaan terakhir dalam rentang rutin.")
    }
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp).clip(RoundedCornerShape(22.dp)).background(if (pressed) p.cell.copy(alpha = .7f) else p.cell)
        .then(if (attention.isNotEmpty()) Modifier.clickable(source, null, role = Role.Button) { open(attention.first()) } else Modifier)
        .padding(16.dp).semantics(mergeDescendants = true) { }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Box(Modifier.size(42.dp).clip(CircleShape).background(color.copy(alpha = .14f)), contentAlignment = Alignment.Center) {
            Icon(icon(path), null, Modifier.size(22.dp), tint = color)
        }
        Column(Modifier.weight(1f)) {
            Text(title, style = T.headline, color = p.ink)
            Text(detail, style = T.subhead, color = p.secondary, modifier = Modifier.padding(top = 2.dp))
        }
        if (attention.isNotEmpty()) Icon(icon(PhosphorPaths.CaretRightBold), null, Modifier.size(14.dp), tint = p.tertiary)
    }
}
private data class Quad(val path: String, val color: Color, val title: String, val detail: String)

/** A plant as an Apple Home-style tile: the moisture ring with the plant inside, its name, and its status in words. */
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
            Text(status, style = T.footnote.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Medium), color = if (attention) p.warn else p.secondary)
        }
    }
}

@Composable internal fun Pill(text: String, selected: Boolean, onClick: () -> Unit) {
    val p = palette
    val haptics = rememberHaptics()
    Box(Modifier.heightIn(min = 40.dp).clip(RoundedCornerShape(50)).background(if (selected) p.tint else p.fill)
        .clickable(role = Role.RadioButton) { if (!selected) haptics.tick(); onClick() }.padding(horizontal = 16.dp, vertical = 9.dp)
        .semantics { stateDescription = if (selected) "Dipilih" else "Tidak dipilih" }, contentAlignment = Alignment.Center) {
        Text(text, style = T.subhead.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Medium), color = if (selected) p.onTint else p.ink, maxLines = 1)
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

/** One plant: the ring with its number, the advice and why, the three readings, the trend, and the weather over it. */
@Composable internal fun PlantDetail(state: AppState, model: AgroViewModel) {
    val p = palette
    val unit = state.selectedUnit ?: return
    val now = rememberNow()
    val h = health(state, unit, now)
    val product = state.products.find { it.id == unit.productId }
    var renaming by rememberSaveable(unit.id) { mutableStateOf(false) }
    var why by rememberSaveable(unit.id) { mutableStateOf(false) }
    var sensor by rememberSaveable(unit.id) { mutableStateOf(Sensor.Moisture) }
    var range by rememberSaveable(unit.id) { mutableIntStateOf(0) }
    val uri = rememberSafeUriHandler()
    val weather = state.weather.takeIf { state.weatherSiteId == state.weatherSite?.id }
    val outdoor = state.weatherSite?.placement?.let { it != "indoor" } == true
    val hour = weather?.at?.substring(11, 13)?.toIntOrNull() ?: java.time.LocalTime.now().hour
    val sky = skyFor(hour, weather?.condition, outdoor)
    TitledScreen(unit.name, Modifier.zoom("unit-${unit.id}"), subtitle = "${unit.crop} \u00b7 ${state.plantCode(unit)}", back = "Tanaman", onBack = model::back,
        actions = { BarButton(PhosphorPaths.PencilSimple, "Ubah nama tanaman", { renaming = true }, enabled = !state.busy) }) {
        notices(state)
        item(key = "hero") {
            // The signature: the pot's moisture as a ring under the sky the pot actually lives under.
            Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp).padding(top = 4.dp).clip(RoundedCornerShape(28.dp)), contentAlignment = Alignment.Center) {
                SkyBackdrop(sky, weather?.condition, Modifier.matchParentSize())
                Column(Modifier.padding(vertical = 28.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    MoistureRing(h.moisture, size = 188.dp, stroke = 15.dp, color = Color.White) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            RollingText(percent(h.moisture), T.figure, Color.White)
                            Text("kelembapan tanah", style = T.subhead.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Medium), color = Color.White, textAlign = TextAlign.Center)
                        }
                    }
                    Text(h.status, Modifier.padding(top = 16.dp, start = 20.dp, end = 20.dp), style = T.title3, color = Color.White, textAlign = TextAlign.Center)
                    weather?.takeIf { outdoor }?.let { Text("${it.label} \u00b7 ${number(it.tempC)}\u00b0", style = T.headline, color = Color.White, modifier = Modifier.padding(top = 2.dp)) }
                }
            }
            Text(if (state.demo) "Data sintetis" else "Diperbarui ${ago(h.at, now).lowercase(ID)}", Modifier.fillMaxWidth().padding(top = 8.dp),
                style = T.footnote, color = p.secondary, textAlign = TextAlign.Center)
        }
        item(key = "advice-title") { SectionTitle("Saran") }
        item(key = "advice") { Advice(state, unit) { why = true } }
        item(key = "readings-title") { SectionTitle("Bacaan") }
        item(key = "readings") {
            Group(inset = 60.dp, footer = product?.let { "Perangkat ${it.serial} · bacaan tiap 30 menit" }) {
                Sensor.entries.forEach { s ->
                    val (path, color) = when (s) { Sensor.Moisture -> PhosphorPaths.DropFill to p.water; Sensor.Temperature -> PhosphorPaths.Thermometer to p.sun; Sensor.Ph -> PhosphorPaths.Flask to p.tint }
                    Cell(s.label.let { if (s == Sensor.Moisture) "Kelembapan" else it }, glyph = path, glyphColor = color, value = reading(s, h.value(s)),
                        subtitle = if (h.value(s) == null && !state.demo) "Tidak ada bacaan baru" else null, chevron = false,
                        trailing = { if (sensor == s) Icon(icon(PhosphorPaths.ChartLine), "Ditampilkan di tren", Modifier.size(18.dp), tint = p.tint) },
                        onClick = { sensor = s })
                }
            }
        }
        item(key = "trend-title") { SectionTitle("Tren") }
        item(key = "trend") {
            Panel {
                Segmented(listOf("24 jam", "7 hari"), range, { range = it })
                Spacer(Modifier.height(14.dp))
                val latest = state.history.maxOfOrNull { it.at }
                val since = latest?.minus(if (range == 0) Duration.ofHours(24) else Duration.ofDays(7))
                TrendChart(state.history.filter { it.sensor == sensor && it.value != null && since != null && !it.at.isBefore(since) }, sensor,
                    when (sensor) { Sensor.Moisture -> p.water; Sensor.Temperature -> p.sun; Sensor.Ph -> p.tint })
                if (state.historyHasMore) PlainButton("Muat bacaan lebih lama", model::loadOlderHistory, Modifier.padding(top = 4.dp), enabled = !state.busy)
            }
        }
        state.weatherSite?.takeIf { !state.demo }?.let { site ->
            item(key = "weather-title") { SectionTitle("Cuaca di ${site.name}") }
            item(key = "weather") { WeatherSection(site, state.weather.takeIf { state.weatherSiteId == site.id }, state.weatherBusy, state.weatherMessage, model::loadWeather) }
        }
        item(key = "more") {
            Spacer(Modifier.height(20.dp))
            Group(inset = 60.dp) {
                Cell("Riwayat sensor", glyph = PhosphorPaths.ClockCounterClockwise, glyphColor = p.secondary, onClick = { model.navigate(Screen.History) })
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

@Composable private fun Advice(state: AppState, unit: PlantUnit, why: () -> Unit) {
    val p = palette
    val stored = state.explanation.takeIf { state.explanationUnitId == unit.id }
    val (action, reason) = stored?.let { it.action to it.reason } ?: state.demoAdvice[unit.id] ?: (null to null)
    Panel {
        when {
            action != null -> {
                Text(action, style = T.title3, color = p.ink)
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

/**
 * A line chart people can scrub: drag across it and the headline shows that reading, with a tick per point (Health).
 * Vertical drags pass through to the page. The summary is spoken for TalkBack.
 */
@Composable internal fun TrendChart(readings: List<Reading>, sensor: Sensor, color: Color, modifier: Modifier = Modifier) {
    val p = palette
    val haptics = rememberHaptics()
    val points = remember(readings) { readings.sortedBy { it.at } }
    var pick by remember(points) { mutableStateOf<Int?>(null) }
    if (points.size < 2) {
        Text("Belum cukup bacaan untuk grafik ini.", style = T.subhead, color = p.secondary, modifier = modifier.padding(vertical = 24.dp))
        return
    }
    val values = points.map { it.value!! }
    val span = when (sensor) { Sensor.Moisture -> 10.0; Sensor.Temperature -> 2.0; Sensor.Ph -> .5 }
    val mid = (values.max() + values.min()) / 2
    val lo = minOf(values.min(), mid - span / 2)
    val hi = maxOf(values.max(), mid + span / 2)
    val shown = points[pick ?: points.lastIndex]
    Column(modifier) {
        Row(verticalAlignment = Alignment.Bottom) {
            Text(reading(sensor, shown.value), style = T.title2, color = p.ink)
            Spacer(Modifier.weight(1f))
            Text(if (pick == null) "Terakhir · ${time(shown.at)}" else time(shown.at), style = T.footnote, color = p.secondary)
        }
        fun index(x: Float, width: Float) = ((x / width) * (points.size - 1)).toInt().coerceIn(0, points.lastIndex)
        fun choose(i: Int) { if (pick != i) { pick = i; haptics.tick() } }
        Canvas(Modifier.fillMaxWidth().height(168.dp).padding(top = 10.dp)
            .pointerInput(points) { detectTapGestures(onPress = { choose(index(it.x, size.width.toFloat())); tryAwaitRelease(); pick = null }) }
            .pointerInput(points) { detectHorizontalDragGestures(onDragEnd = { pick = null }, onDragCancel = { pick = null }) { change, _ -> choose(index(change.position.x, size.width.toFloat())) } }
            .semantics { contentDescription = "${sensor.label}: terendah ${reading(sensor, values.min())}, tertinggi ${reading(sensor, values.max())}, terakhir ${reading(sensor, values.last())}" }) {
            fun x(i: Int) = size.width * i / (points.size - 1)
            fun y(v: Double) = (size.height * (1 - (v - lo) / (hi - lo))).toFloat().coerceIn(4f, size.height - 4f)
            for (k in 0..2) { val gy = size.height * k / 2; drawLine(p.separator, Offset(0f, gy), Offset(size.width, gy), 1f) }
            val line = Path().apply { points.forEachIndexed { i, r -> if (i == 0) moveTo(x(i), y(r.value!!)) else lineTo(x(i), y(r.value!!)) } }
            val area = Path().apply { addPath(line); lineTo(size.width, size.height); lineTo(0f, size.height); close() }
            drawPath(area, Brush.verticalGradient(listOf(color.copy(alpha = .28f), color.copy(alpha = 0f))))
            drawPath(line, color, style = Stroke(2.5.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
            val at = pick ?: points.lastIndex
            if (pick != null) drawLine(p.secondary.copy(alpha = .5f), Offset(x(at), 0f), Offset(x(at), size.height), 1.dp.toPx())
            drawCircle(p.cell, 6.dp.toPx(), Offset(x(at), y(points[at].value!!)))
            drawCircle(color, 4.5.dp.toPx(), Offset(x(at), y(points[at].value!!)))
        }
        Row(Modifier.padding(top = 6.dp)) {
            Text(time(points.first().at), style = T.footnote, color = p.secondary)
            Spacer(Modifier.weight(1f))
            Text("Rendah ${reading(sensor, values.min())} · Tinggi ${reading(sensor, values.max())}", style = T.footnote, color = p.secondary)
        }
    }
}
