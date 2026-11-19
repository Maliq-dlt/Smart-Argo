package id.smartagro.app

import androidx.compose.animation.AnimatedContentTransitionScope
import androidx.compose.animation.ContentTransform
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.*
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.togetherWith
import androidx.compose.ui.unit.IntOffset
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.*
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.HazeStyle
import dev.chrisbanes.haze.HazeTint
import dev.chrisbanes.haze.hazeEffect
import dev.chrisbanes.haze.hazeSource
import kotlin.math.abs
import kotlin.math.min

/* Smart Agro's Apple-style kit. Navigation and controls keep iOS sizes, placement and behavior; identity lives in the
 * Sage palette, Fraunces titles and the plant content (HIG branding: restyled components keep familiar behavior). */

/** Room the floating tab bar takes at the bottom, so lists can scroll their last row above it. */
val LocalBottomClearance = staticCompositionLocalOf { 0.dp }
/** The shell's blur source; bars sample the content behind them. Null in tests and previews: bars fall back to a tint. */
val LocalShellHaze = staticCompositionLocalOf<HazeState?> { null }

private fun glass(p: Palette) = HazeStyle(backgroundColor = p.canvas, tints = listOf(HazeTint(p.bar)), blurRadius = 24.dp, noiseFactor = 0f)
private fun Modifier.glassOver(state: HazeState?, p: Palette): Modifier =
    if (state == null) background(p.bar.copy(alpha = .96f)) else hazeEffect(state, glass(p))

/** Text that grows with the system size up to [cap]; for bar labels that cannot reflow, like iOS (HIG large content). */
@Composable private fun capped(size: Int, cap: Float = 1.35f) = with(LocalDensity.current) { (size * min(fontScale, cap) / fontScale).sp }

// ---------------------------------------------------------------- Navigation

/**
 * The iOS navigation stack: a pushed screen slides in from the trailing edge on a critically damped spring while the
 * old one drifts a quarter width and dims to 40 % (never to nothing, so no frame is blank); a pop reverses it.
 */
fun <S> AnimatedContentTransitionScope<S>.stack(forward: Boolean): ContentTransform {
    val push = spring(dampingRatio = 1f, stiffness = 420f, visibilityThreshold = IntOffset.VisibilityThreshold)
    return if (forward) slideInHorizontally(push) { it } togetherWith (slideOutHorizontally(push) { -it / 4 } + fadeOut(tween(260), .4f))
    else ((slideInHorizontally(push) { -it / 4 } + fadeIn(tween(220), .4f)) togetherWith slideOutHorizontally(push) { it }).apply { targetContentZIndex = -1f }
}

/**
 * A navigation bar: back button with the previous screen's name, an inline title that appears once the large title
 * has scrolled away, and trailing actions. Glass only when content is under it (HIG materials: navigation layer only).
 */
@Composable fun NavBar(title: String, glass: Float, modifier: Modifier = Modifier, titleAlpha: Float = glass, back: String? = null,
                       onBack: (() -> Unit)? = null, haze: HazeState? = null, actions: @Composable RowScope.() -> Unit = {}) {
    val p = palette
    val progress = titleAlpha
    Box(modifier.fillMaxWidth()) {
        Box(Modifier.matchParentSize().graphicsLayer { alpha = glass }.glassOver(haze, p)
            .drawBehind { drawLine(p.separator, Offset(0f, size.height), Offset(size.width, size.height), 1f) })
        Box(Modifier.fillMaxWidth().statusBarsPadding().heightIn(min = 52.dp).padding(horizontal = 4.dp), contentAlignment = Alignment.Center) {
            if (progress > .01f) Text(title, Modifier.padding(start = if (back != null) 128.dp else 64.dp, end = 64.dp).graphicsLayer { alpha = progress },
                style = T.headline.copy(fontSize = capped(17)), color = p.ink, textAlign = TextAlign.Center, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                if (back != null && onBack != null) BackButton(back, onBack)
                Spacer(Modifier.weight(1f))
                Row(horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically, content = actions)
            }
        }
    }
}

@Composable fun BackButton(label: String, onClick: () -> Unit) {
    val p = palette
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    Row(Modifier.heightIn(min = 48.dp).clip(RoundedCornerShape(12.dp)).clickable(source, null, role = Role.Button, onClick = onClick)
        .graphicsLayer { alpha = if (pressed) .45f else 1f }.padding(end = 10.dp).semantics(mergeDescendants = true) { contentDescription = "Kembali ke $label" },
        verticalAlignment = Alignment.CenterVertically) {
        Icon(icon(PhosphorPaths.CaretLeftBold), null, Modifier.padding(start = 6.dp).size(22.dp), tint = p.tint)
        Text(label, style = T.body.copy(fontSize = capped(17)), color = p.tint, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

/** A round toolbar button (icon only) with a spoken label and a 48 dp target. */
@Composable fun BarButton(path: String, label: String, onClick: () -> Unit, enabled: Boolean = true) {
    val p = palette
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    Box(Modifier.size(48.dp).clip(CircleShape).clickable(source, null, enabled = enabled, role = Role.Button, onClick = onClick)
        .semantics { contentDescription = label }, contentAlignment = Alignment.Center) {
        Box(Modifier.size(34.dp).clip(CircleShape).background(if (pressed) p.separator else p.fill), contentAlignment = Alignment.Center) {
            Icon(icon(path), null, Modifier.size(19.dp), tint = if (enabled) p.tint else p.tertiary)
        }
    }
}

/**
 * The standard screen: a large Fraunces title that scrolls with the content and hands over to the inline title in a
 * glass bar (HIG: large titles on top-level screens; the bar becomes opaque-glass once content scrolls under it).
 * Set [large] false for detail screens that show the title only in the bar.
 */
@Composable fun TitledScreen(title: String, modifier: Modifier = Modifier, subtitle: String? = null, large: Boolean = true,
                             back: String? = null, onBack: (() -> Unit)? = null, state: LazyListState = rememberLazyListState(),
                             actions: @Composable RowScope.() -> Unit = {}, content: LazyListScope.() -> Unit) {
    val p = palette
    val haze = remember { HazeState() }
    var titleHeight by remember { mutableIntStateOf(1) }
    val collapsed by remember(large) { derivedStateOf { !large || state.firstVisibleItemIndex > 0 || state.firstVisibleItemScrollOffset > titleHeight * .6f } }
    val scrolled by remember { derivedStateOf { state.firstVisibleItemIndex > 0 || state.firstVisibleItemScrollOffset > 4 } }
    val titleIn by animateFloatAsState(if (collapsed) 1f else 0f, Springs.smooth(), label = "Judul bar")
    val glassIn by animateFloatAsState(if (scrolled) 1f else 0f, Springs.smooth(), label = "Kaca bar")
    val top = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()
    Box(modifier.fillMaxSize().background(p.canvas)) {
        LazyColumn(Modifier.fillMaxSize().hazeSource(haze), state = state,
            contentPadding = PaddingValues(top = top + 52.dp, bottom = LocalBottomClearance.current + 24.dp)) {
            if (large) item(key = "large-title") {
                Column(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 2.dp, bottom = 14.dp).onSizeChanged { titleHeight = it.height }) {
                    Text(title, style = T.largeTitle, color = p.ink, modifier = Modifier.semantics { heading() })
                    subtitle?.let { Text(it, style = T.subhead, color = p.secondary, modifier = Modifier.padding(top = 4.dp)) }
                }
            }
            content()
        }
        // The glass follows any scroll; the inline title waits until the large title has gone.
        NavBar(title, glassIn, Modifier.align(Alignment.TopCenter), titleIn, back, onBack, haze, actions)
    }
}

data class TabItem(val label: String, val path: String, val selectedPath: String)

/**
 * Floating Liquid Glass tab bar: translucent capsule over Haze with a smooth critically-damped gliding glass lens
 * (subtle fluid width stretch in transit, specular top rim, zero bounce), filled active icons, and tick haptics.
 */
@Composable fun GlassTabBar(items: List<TabItem>, selected: Int, onSelect: (Int) -> Unit, modifier: Modifier = Modifier) {
    val p = palette
    val haptics = rememberHaptics()
    val shape = RoundedCornerShape(50)
    val lens by animateFloatAsState(selected.toFloat(), spring(dampingRatio = 1f, stiffness = 460f), label = "Lensa tab")
    val barSheen = if (p.dark) listOf(Color.White.copy(alpha = .11f), Color.Transparent) else listOf(Color.White.copy(alpha = .58f), Color.Transparent)
    val lensTop = if (p.dark) p.tint.copy(alpha = .24f) else Color.White.copy(alpha = .82f)
    val lensBottom = if (p.dark) p.tint.copy(alpha = .11f) else p.soft.copy(alpha = .62f)
    val lensRim = if (p.dark) Color.White.copy(alpha = .18f) else Color.White.copy(alpha = .92f)
    Row(modifier.navigationBarsPadding().padding(horizontal = 20.dp, vertical = 10.dp).widthIn(max = 440.dp).fillMaxWidth()
        .shadow(22.dp, shape, ambientColor = p.shadow, spotColor = p.shadow).clip(shape).glassOver(LocalShellHaze.current, p)
        .background(Brush.verticalGradient(barSheen))
        .border(.75.dp, p.barEdge, shape).padding(4.dp)
        .drawBehind {
            val w = size.width / items.size
            val travel = abs(selected - lens).coerceIn(0f, 1f)
            val stretch = w * (.09f * travel)
            val left = (w * lens - stretch * .5f).coerceIn(0f, size.width - w)
            val width = (w + stretch).coerceAtMost(size.width - left)
            val cr = CornerRadius(size.height / 2)
            drawRoundRect(Brush.verticalGradient(listOf(lensTop, lensBottom)), Offset(left, 0f), Size(width, size.height), cr)
            drawRoundRect(lensRim, Offset(left + .6f, .6f), Size(width - 1.2f, size.height - 1.2f), cr, style = Stroke(1.dp.toPx()))
        }.selectableGroup()) {
        items.forEachIndexed { index, item ->
            val on = index == selected
            val tint by animateColorAsState(if (on) p.tint else p.secondary, Springs.smooth(), label = "Warna tab")
            Column(Modifier.weight(1f).heightIn(min = 54.dp).clip(shape)
                .selectable(on, interactionSource = null, indication = null, role = Role.Tab) { if (!on) { haptics.tick(); onSelect(index) } }
                .padding(vertical = 6.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
                Icon(icon(if (on) item.selectedPath else item.path), null, Modifier.size(24.dp), tint = tint)
                Text(item.label, style = T.caption.copy(fontSize = capped(11, 1.3f), lineHeight = capped(13, 1.3f)), color = tint, maxLines = 1, softWrap = false)
            }
        }
    }
}

// ---------------------------------------------------------------- Lists

/** A section title in Title 3; HIG section headers without the small all-caps eyebrow this product avoids. */
@Composable fun SectionTitle(text: String, modifier: Modifier = Modifier, trailing: @Composable RowScope.() -> Unit = {}) {
    Row(modifier.fillMaxWidth().padding(start = 20.dp, end = 12.dp, top = 22.dp, bottom = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(text, Modifier.weight(1f).semantics { heading() }, style = T.title3, color = palette.ink)
        trailing()
    }
}

/** An inset grouped list: rows on one rounded cell with hairlines between them, indented to the text (HIG lists). */
@Composable fun Group(modifier: Modifier = Modifier, footer: String? = null, inset: Dp = 16.dp, content: @Composable () -> Unit) {
    val p = palette
    // Filled during placement and read while drawing, which always follows layout; not state, so layout never recomposes.
    val edges = remember { IntArray(64) }
    val drawn = remember { IntArray(1) }
    Column(modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
        Layout(content, Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(p.cell).drawBehind {
            val x = inset.toPx()
            for (i in 0 until drawn[0]) drawLine(p.separator, Offset(x, edges[i].toFloat()), Offset(size.width, edges[i].toFloat()), 1f)
        }) { measurables, constraints ->
            val placeables = measurables.map { it.measure(constraints.copy(minHeight = 0)) }
            val height = placeables.sumOf { it.height }
            layout(constraints.maxWidth, height) {
                var y = 0
                placeables.forEachIndexed { i, placeable ->
                    if (i > 0 && i - 1 < edges.size) edges[i - 1] = y
                    placeable.placeRelative(0, y); y += placeable.height
                }
                drawn[0] = (placeables.size - 1).coerceIn(0, edges.size)
            }
        }
        footer?.let { Text(it, Modifier.padding(start = 16.dp, end = 16.dp, top = 8.dp), style = T.footnote, color = p.secondary) }
    }
}

/** The leading symbol in a colored rounded square, as in Settings. */
@Composable fun Glyph(path: String, color: Color, modifier: Modifier = Modifier) {
    val square = if (palette.dark) lerp(color, Color.Black, .35f) else color
    Box(modifier.size(30.dp).clip(RoundedCornerShape(8.dp)).background(square), contentAlignment = Alignment.Center) {
        Icon(icon(path), null, Modifier.size(18.dp), tint = Color.White)
    }
}

/** A list row. With [onClick] it highlights on press and shows a chevron (HIG: feedback on selection, disclosure). */
@Composable fun Cell(title: String, modifier: Modifier = Modifier, subtitle: String? = null, value: String? = null,
                     glyph: String? = null, glyphColor: Color = palette.tint, destructive: Boolean = false, chevron: Boolean = true,
                     enabled: Boolean = true, onClick: (() -> Unit)? = null, trailing: (@Composable () -> Unit)? = null) {
    val p = palette
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    Row(modifier.fillMaxWidth().heightIn(min = 52.dp).background(if (pressed) p.pressed else Color.Transparent)
        .then(if (onClick != null) Modifier.clickable(source, null, enabled = enabled, role = Role.Button, onClick = onClick) else Modifier)
        .padding(horizontal = 16.dp, vertical = 11.dp).semantics(mergeDescendants = true) { },
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        glyph?.let { Glyph(it, glyphColor) }
        Column(Modifier.weight(1f)) {
            Text(title, style = T.body, color = when { destructive -> p.warn; enabled -> p.ink; else -> p.tertiary })
            subtitle?.let { Text(it, style = T.subhead, color = p.secondary, modifier = Modifier.padding(top = 2.dp)) }
        }
        value?.let { Text(it, style = T.body, color = p.secondary, textAlign = TextAlign.End, modifier = Modifier.widthIn(max = 180.dp)) }
        trailing?.invoke()
        if (onClick != null && chevron && !destructive) Icon(icon(PhosphorPaths.CaretRightBold), null, Modifier.size(14.dp), tint = p.tertiary)
    }
}

/** A row whose whole width toggles the switch, with the switch role for TalkBack. */
@Composable fun ToggleCell(title: String, checked: Boolean, onChange: (Boolean) -> Unit, modifier: Modifier = Modifier,
                           subtitle: String? = null, glyph: String? = null, glyphColor: Color = palette.tint, enabled: Boolean = true) {
    val p = palette
    val haptics = rememberHaptics()
    Row(modifier.fillMaxWidth().heightIn(min = 52.dp).toggleable(checked, enabled = enabled, role = Role.Switch) { haptics.tick(); onChange(it) }
        .padding(horizontal = 16.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        glyph?.let { Glyph(it, glyphColor) }
        Column(Modifier.weight(1f)) {
            Text(title, style = T.body, color = if (enabled) p.ink else p.tertiary)
            subtitle?.let { Text(it, style = T.subhead, color = p.secondary, modifier = Modifier.padding(top = 2.dp)) }
        }
        AgroSwitch(checked)
    }
}

/** The iOS switch (51 x 31): track fills with the tint, the knob travels on a snappy spring. Visual only; the row toggles. */
@Composable fun AgroSwitch(checked: Boolean, modifier: Modifier = Modifier) {
    val p = palette
    val at by animateFloatAsState(if (checked) 1f else 0f, Springs.snappy(), label = "Sakelar")
    Canvas(modifier.size(51.dp, 31.dp)) {
        drawRoundRect(lerp(p.separator, p.tint, at), cornerRadius = CornerRadius(size.height / 2))
        val r = 13.5.dp.toPx()
        val x = (2.dp.toPx() + r) + (size.width - 4.dp.toPx() - 2 * r) * at
        drawCircle(Color.Black.copy(alpha = .14f), r + 1f, Offset(x, center.y + 1.5f))
        drawCircle(Color.White, r, Offset(x, center.y))
    }
}

// ---------------------------------------------------------------- Controls

/** The segmented control: a raised thumb that slides on a snappy spring; each segment is a radio button for TalkBack. */
@Composable fun Segmented(options: List<String>, selected: Int, onSelect: (Int) -> Unit, modifier: Modifier = Modifier) {
    val p = palette
    val haptics = rememberHaptics()
    val at by animateFloatAsState(selected.toFloat(), Springs.snappy(), label = "Segmen")
    Row(modifier.fillMaxWidth().clip(RoundedCornerShape(13.dp)).background(p.fill).padding(3.dp).drawBehind {
        val w = size.width / options.size
        drawRoundRect(p.shadow.copy(alpha = .18f), Offset(w * at, 1.5f), Size(w, size.height), CornerRadius(10.dp.toPx()))
        drawRoundRect(if (p.dark) lerp(p.raised, Color.White, .16f) else p.raised, Offset(w * at, 0f), Size(w, size.height), CornerRadius(10.dp.toPx()))
    }.selectableGroup()) {
        options.forEachIndexed { index, label ->
            val on = index == selected
            Box(Modifier.weight(1f).heightIn(min = 40.dp).selectable(on, interactionSource = null, indication = null, role = Role.RadioButton) {
                if (!on) { haptics.tick(); onSelect(index) }
            }.padding(horizontal = 6.dp, vertical = 6.dp), contentAlignment = Alignment.Center) {
                Text(label, style = T.subhead.copy(fontSize = capped(15, 1.3f), lineHeight = capped(18, 1.3f), fontWeight = if (on) androidx.compose.ui.text.font.FontWeight.SemiBold else androidx.compose.ui.text.font.FontWeight.Medium),
                    color = p.ink, textAlign = TextAlign.Center, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

private enum class Kind { Filled, Tinted, Plain }
@Composable private fun AgroButton(kind: Kind, text: String, onClick: () -> Unit, modifier: Modifier, enabled: Boolean, busy: Boolean,
                                   path: String?, destructive: Boolean) {
    val p = palette
    val haptics = rememberHaptics()
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed) .97f else 1f, Springs.snappy(), label = "Tekan tombol")
    val accent = if (destructive) p.warn else p.tint
    val (bg, fg) = when {
        !enabled -> (if (kind == Kind.Plain) Color.Transparent else p.fill) to p.tertiary
        kind == Kind.Filled -> accent to (if (destructive) Color.White else p.onTint)
        kind == Kind.Tinted -> (if (destructive) p.warn.copy(alpha = .14f) else p.soft) to (if (destructive) p.warn else p.onSoft)
        else -> Color.Transparent to accent
    }
    Row(modifier.heightIn(min = if (kind == Kind.Plain) 44.dp else 52.dp).graphicsLayer { scaleX = scale; scaleY = scale; alpha = if (pressed) .82f else 1f }
        .clip(RoundedCornerShape(50)).background(bg)
        .clickable(source, null, enabled = enabled && !busy, role = Role.Button) { haptics.press(); onClick() }
        .padding(horizontal = if (kind == Kind.Plain) 12.dp else 22.dp, vertical = 12.dp)
        .semantics { if (busy) stateDescription = "Sedang diproses" },
        horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally), verticalAlignment = Alignment.CenterVertically) {
        if (busy) ActivityIndicator(Modifier.size(20.dp), fg)
        else path?.let { Icon(icon(it), null, Modifier.size(20.dp), tint = fg) }
        Text(text, style = if (kind == Kind.Plain) T.body else T.headline, color = fg, textAlign = TextAlign.Center)
    }
}
/** The prominent action of a screen (HIG buttons: one prominent style per view). */
@Composable fun PrimaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, busy: Boolean = false,
                              path: String? = null, destructive: Boolean = false) = AgroButton(Kind.Filled, text, onClick, modifier, enabled, busy, path, destructive)
@Composable fun TintedButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true, busy: Boolean = false,
                             path: String? = null, destructive: Boolean = false) = AgroButton(Kind.Tinted, text, onClick, modifier, enabled, busy, path, destructive)
@Composable fun PlainButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true,
                            path: String? = null, destructive: Boolean = false) = AgroButton(Kind.Plain, text, onClick, modifier, enabled, false, path, destructive)

/** The activity indicator: eight spokes with a trailing fade, turning continuously (no stepping, so it never flickers). */
@Composable fun ActivityIndicator(modifier: Modifier = Modifier.size(20.dp), color: Color = palette.secondary) {
    val spin = rememberInfiniteTransition(label = "Memuat")
    val turn by spin.animateFloat(0f, 360f, infiniteRepeatable(tween(1_000, easing = LinearEasing)), label = "Putar")
    Canvas(modifier.semantics { contentDescription = "Memuat" }) {
        rotate(turn) {
            for (i in 0 until 8) rotate(i * 45f) {
                drawLine(color.copy(alpha = .25f + .75f * i / 7f), Offset(center.x, size.height * .1f), Offset(center.x, size.height * .32f), size.width * .09f, StrokeCap.Round)
            }
        }
    }
}

/** Status in the interface, not in an alert (HIG feedback). Announced politely. */
@Composable fun Banner(text: String, modifier: Modifier = Modifier, error: Boolean = false) {
    val p = palette
    val accent = if (error) p.warn else p.tint
    Row(modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(accent.copy(alpha = if (p.dark) .16f else .1f))
        .padding(horizontal = 14.dp, vertical = 12.dp).semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
        horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        Icon(icon(if (error) PhosphorPaths.WarningFill else PhosphorPaths.Info), null, Modifier.size(20.dp), tint = accent)
        Text(text, style = T.subhead, color = p.ink)
    }
}

/** A content card on the canvas. */
@Composable fun Panel(modifier: Modifier = Modifier, padding: Dp = 16.dp, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier.fillMaxWidth().padding(horizontal = 16.dp).clip(RoundedCornerShape(22.dp)).background(palette.cell).padding(padding), content = content)
}

/**
 * A sheet with a grabber, a medium detent first, and a close button besides the swipe (HIG sheets: a way out besides Done).
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable fun AgroSheet(title: String, onDismiss: () -> Unit, modifier: Modifier = Modifier, action: String? = null, onAction: (() -> Unit)? = null,
                          actionEnabled: Boolean = true, content: @Composable ColumnScope.() -> Unit) {
    val p = palette
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = false)
    ModalBottomSheet(onDismissRequest = onDismiss, modifier = modifier, sheetState = state, containerColor = if (p.dark) p.cell else p.canvas,
        contentColor = p.ink, shape = RoundedCornerShape(topStart = 30.dp, topEnd = 30.dp), scrimColor = Color.Black.copy(alpha = .3f),
        dragHandle = { Box(Modifier.padding(top = 8.dp).size(36.dp, 5.dp).clip(CircleShape).background(p.separator)) }) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.weight(1f)) { BarButton(PhosphorPaths.XBold, "Tutup", onDismiss) }
            Text(title, Modifier.weight(2.4f).semantics { heading() }, style = T.headline, color = p.ink, textAlign = TextAlign.Center)
            Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) {
                if (action != null && onAction != null) Text(action, Modifier.clip(RoundedCornerShape(12.dp))
                    .clickable(enabled = actionEnabled, role = Role.Button, onClick = onAction).padding(horizontal = 10.dp, vertical = 12.dp),
                    style = T.headline, color = if (actionEnabled) p.tint else p.tertiary)
            }
        }
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).navigationBarsPadding().imePadding().padding(top = 8.dp, bottom = 16.dp), content = content)
    }
}
