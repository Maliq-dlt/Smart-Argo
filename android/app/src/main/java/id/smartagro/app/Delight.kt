package id.smartagro.app

import android.content.Context
import android.graphics.RuntimeShader
import android.os.Build
import android.provider.Settings
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.AnimatedVisibilityScope
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionScope
import androidx.compose.animation.core.*
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.ShaderBrush
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import dev.chrisbanes.haze.hazeEffect
import dev.chrisbanes.haze.HazeStyle
import dev.chrisbanes.haze.HazeTint
import java.time.LocalTime

/* The moments that make the app feel alive, each with a job: the zoom shows where a screen came from, the sky shows the
 * weather the pot is under, rolling digits show that a reading changed, and the context menu offers shortcuts in place. */

// ---------------------------------------------------------------- Zoom transition (iOS 18 navigation zoom)

val LocalSharedScope = staticCompositionLocalOf<SharedTransitionScope?> { null }
val LocalNavScope = staticCompositionLocalOf<AnimatedVisibilityScope?> { null }

/** The tile and the screen it opens share bounds, so the screen grows out of the tile and shrinks back into it. */
@OptIn(ExperimentalSharedTransitionApi::class)
@Composable fun Modifier.zoom(key: String): Modifier {
    val shared = LocalSharedScope.current ?: return this
    val nav = LocalNavScope.current ?: return this
    return with(shared) {
        this@zoom.sharedBounds(rememberSharedContentState("zoom-$key"), nav,
            enter = fadeIn(tween(220)), exit = fadeOut(tween(140, delayMillis = 200)),
            boundsTransform = { _, _ -> spring(dampingRatio = 1f, stiffness = 340f, visibilityThreshold = Rect.VisibilityThreshold) },
            resizeMode = SharedTransitionScope.ResizeMode.scaleToBounds(),
            clipInOverlayDuringTransition = OverlayClip(RoundedCornerShape(26.dp)))
    }
}

// ---------------------------------------------------------------- Rolling digits

/** Text whose changed characters roll up or down, like SwiftUI's numericText content transition. */
@Composable fun RollingText(text: String, style: TextStyle, color: Color, modifier: Modifier = Modifier) {
    Row(modifier.semantics(mergeDescendants = true) { }) {
        text.forEachIndexed { index, char ->
            key(index) {
                AnimatedContent(char, transitionSpec = {
                    val up = targetState > initialState
                    (slideInVertically(Springs.smooth()) { if (up) it / 2 else -it / 2 } + fadeIn(tween(220))) togetherWith
                        (slideOutVertically(Springs.smooth()) { if (up) -it / 2 else it / 2 } + fadeOut(tween(220)))
                }, label = "Digit") { Text(it.toString(), style = style, color = color) }
            }
        }
    }
}

// ---------------------------------------------------------------- The sky over the pot

/** Where the plant lives decides its backdrop: the forecast sky outdoors, the brand's moss indoors or without a site. */
internal enum class Sky(val top: Color, val bottom: Color) {
    Day(Color(0xFF2F6FA8), Color(0xFF4F86BA)), Cloud(Color(0xFF55697C), Color(0xFF74889A)), Rain(Color(0xFF3F5163), Color(0xFF5E7083)),
    Dawn(Color(0xFFB5694B), Color(0xFF6F7FA6)), Dusk(Color(0xFF6E4A6E), Color(0xFFB0603F)), Night(Color(0xFF0F1B2D), Color(0xFF26405F)),
    Moss(Color(0xFF24472F), Color(0xFF3F6B3C));
}
/** White text on every sky stays at or above 3.6:1 (large text needs 3:1); small text is kept off the sky. */
internal fun skyFor(hour: Int, condition: String?, outdoor: Boolean): Sky = when {
    !outdoor || condition == null -> Sky.Moss
    hour < 5 || hour >= 20 -> Sky.Night
    condition in listOf("hujan", "badai") -> Sky.Rain
    condition in listOf("berawan", "mendung") -> Sky.Cloud
    hour < 7 -> Sky.Dawn
    hour >= 17 -> Sky.Dusk
    else -> Sky.Day
}

/**
 * A quiet, living backdrop. The only motion is clouds drifting across in about two minutes; nothing blinks, pulses or
 * falls (the owner's rule against motion sickness, and HIG motion: purposeful, never distracting). With animations
 * turned off in the system the clouds hold still, since Compose follows the animator duration scale.
 */
@Composable internal fun SkyBackdrop(sky: Sky, condition: String?, modifier: Modifier = Modifier) {
    val cloudy = sky == Sky.Cloud || sky == Sky.Rain || condition == "berawan"
    val drift = if (cloudy) rememberInfiniteTransition(label = "Langit")
        .animateFloat(0f, 1f, infiniteRepeatable(tween(120_000, easing = LinearEasing)), label = "Awan").value else 0f
    Canvas(modifier) {
        drawRect(Brush.verticalGradient(listOf(sky.top, sky.bottom)))
        when (sky) {
            Sky.Night -> { stars(); moon() }
            Sky.Day, Sky.Dawn, Sky.Dusk -> sun(if (sky == Sky.Day) Color(0xFFFFF4C2) else Color(0xFFFFD2A6))
            Sky.Moss -> glow()
            else -> Unit
        }
        if (cloudy) clouds(drift, if (sky == Sky.Rain) .3f else .45f)
        if (sky == Sky.Rain) rain()
    }
}
private fun DrawScope.sun(color: Color) {
    val c = Offset(size.width * .82f, size.height * .2f)
    drawCircle(Brush.radialGradient(listOf(color.copy(alpha = .5f), Color.Transparent), c, size.minDimension * .44f), size.minDimension, c)
    drawCircle(color, size.minDimension * .075f, c)
}
private fun DrawScope.moon() {
    val c = Offset(size.width * .8f, size.height * .22f)
    val r = size.minDimension * .07f
    drawCircle(Color(0xFFF3EFD9).copy(alpha = .22f), r * 2.6f, c)
    drawCircle(Color(0xFFF3EFD9), r, c)
}
private fun DrawScope.stars() {
    for (i in 0 until 26) {
        val x = ((i * 73 + 17) % 100) / 100f * size.width
        val y = ((i * 41 + 9) % 60) / 100f * size.height
        val a = if (i % 3 == 0) .7f else .45f
        drawCircle(Color.White.copy(alpha = a), if (i % 5 == 0) 1.8f * density else 1.1f * density, Offset(x, y))
    }
}
private fun DrawScope.glow() {
    val c = Offset(size.width * .72f, size.height * .28f)
    drawCircle(Brush.radialGradient(listOf(Color(0xFFC3DF95).copy(alpha = .22f), Color.Transparent), c, size.minDimension * .7f), size.minDimension, c)
}
private fun DrawScope.clouds(drift: Float, alpha: Float) {
    listOf(Triple(.15f, .2f, 1f), Triple(.62f, .1f, .8f), Triple(.9f, .34f, .65f)).forEachIndexed { i, (x0, y, scale) ->
        val w = size.width * .42f * scale
        val x = ((x0 + drift * (1f + i * .35f)) % 1.4f - .2f) * size.width
        val cy = size.height * y + w * .2f
        val color = Color.White.copy(alpha = alpha)
        drawCircle(color, w * .22f, Offset(x, cy))
        drawCircle(color, w * .3f, Offset(x + w * .25f, cy - w * .1f))
        drawCircle(color, w * .2f, Offset(x + w * .52f, cy))
        drawRoundRect(color, Offset(x - w * .02f, cy - w * .02f), androidx.compose.ui.geometry.Size(w * .56f, w * .22f), androidx.compose.ui.geometry.CornerRadius(w * .11f))
    }
}
private fun DrawScope.rain() {
    for (i in 0 until 28) {
        val x = ((i * 37 + 11) % 100) / 100f * size.width
        val y = ((i * 53) % 100) / 100f * size.height
        drawLine(Color.White.copy(alpha = .22f), Offset(x, y), Offset(x - 3f * density, y + 12f * density), 1.2f * density, StrokeCap.Round)
    }
}

// ---------------------------------------------------------------- Context menu

private object WindowOrigin : androidx.compose.ui.window.PopupPositionProvider {
    override fun calculatePosition(anchorBounds: androidx.compose.ui.unit.IntRect, windowSize: androidx.compose.ui.unit.IntSize,
                                   layoutDirection: androidx.compose.ui.unit.LayoutDirection, popupContentSize: androidx.compose.ui.unit.IntSize) = IntOffset.Zero
}
data class MenuAction(val label: String, val path: String, val destructive: Boolean = false, val run: () -> Unit)

/**
 * The iOS context menu: on long press the item lifts above a blurred, dimmed screen and a short list of actions appears
 * next to it. Tap outside or press back to close (HIG context menus: a preview that clarifies the target).
 */
@Composable fun ContextMenu(anchor: Rect, onDismiss: () -> Unit, actions: List<MenuAction>, preview: @Composable () -> Unit) {
    val p = palette
    val density = LocalDensity.current
    val shown = remember { Animatable(0f) }
    LaunchedEffect(Unit) { shown.animateTo(1f, Springs.smooth()) }
    // Positioned at the window origin so the anchor's window bounds place the lifted preview over the real item.
    Popup(popupPositionProvider = WindowOrigin, onDismissRequest = onDismiss, properties = PopupProperties(focusable = true)) {
        Box(Modifier.fillMaxSize().clickable(remember { MutableInteractionSource() }, null, onClick = onDismiss)) {
            val haze = LocalShellHaze.current
            Box(Modifier.fillMaxSize().graphicsLayer { alpha = shown.value.coerceIn(0f, 1f) }
                .then(if (haze != null) Modifier.hazeEffect(haze, HazeStyle(Color.Black.copy(alpha = .25f), listOf(HazeTint(Color.Black.copy(alpha = .18f))), 18.dp, 0f))
                    else Modifier.background(Color.Black.copy(alpha = .4f))))
            val (x, y) = with(density) { anchor.left.toDp() to anchor.top.toDp() }
            val (w, h) = with(density) { anchor.width.toDp() to anchor.height.toDp() }
            Box(Modifier.offset { IntOffset(anchor.left.toInt(), anchor.top.toInt()) }.size(w, h)
                .graphicsLayer { val s = 1f + .04f * shown.value; scaleX = s; scaleY = s }) { preview() }
            Column(Modifier.offset(x = x.coerceAtMost(with(density) { anchor.right.toDp() } - 250.dp).coerceAtLeast(16.dp), y = y + h + 12.dp)
                .width(250.dp).graphicsLayer { alpha = shown.value.coerceIn(0f, 1f); val s = .85f + .15f * shown.value; scaleX = s; scaleY = s; transformOrigin = androidx.compose.ui.graphics.TransformOrigin(0f, 0f) }
                .shadow(24.dp, RoundedCornerShape(18.dp)).clip(RoundedCornerShape(18.dp)).background(if (p.dark) p.raised else Color(0xF7FBFCF9))) {
                actions.forEachIndexed { i, action ->
                    if (i > 0) Box(Modifier.fillMaxWidth().height(1.dp).background(p.separator))
                    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(role = Role.Button) { onDismiss(); action.run() }.padding(horizontal = 16.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        Text(action.label, Modifier.weight(1f), style = T.body, color = if (action.destructive) p.warn else p.ink)
                        Icon(icon(action.path), null, Modifier.size(20.dp), tint = if (action.destructive) p.warn else p.ink)
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------- Local-time botanical sky & terasering

internal enum class TimePhase(
    val greeting: String,
    val glyph: String,
    val skyColors: List<Color>,
    val hillBack: Color,
    val hillMid: Color,
    val hillFront: Color,
    val isNight: Boolean,
    val sunColor: Color?,
    val heroText: Color,
) {
    Pagi(
        "Selamat pagi",
        PhosphorPaths.CloudSun,
        listOf(Color(0xFF4C7C6B), Color(0xFFA6C9A9), Color(0xFFEBD6A8)),
        Color(0xFF2B604A),
        Color(0xFF1F4E3C),
        Color(0xFF14382B),
        false,
        Color(0xFFFFF0BF),
        Color(0xFF10241A),
    ),
    Siang(
        "Selamat siang",
        PhosphorPaths.Sun,
        listOf(Color(0xFF2E6B63), Color(0xFF6DA691), Color(0xFFCDE2CE)),
        Color(0xFF245A45),
        Color(0xFF1A4737),
        Color(0xFF103327),
        false,
        Color(0xFFFFF8D6),
        Color(0xFFF6FBF4),
    ),
    Sore(
        "Selamat sore",
        PhosphorPaths.CloudSun,
        listOf(Color(0xFF2E494D), Color(0xFF8B7364), Color(0xFFD9A074)),
        Color(0xFF234B3C),
        Color(0xFF193B2F),
        Color(0xFF102820),
        false,
        Color(0xFFFFCF9E),
        Color(0xFFFDF8F0),
    ),
    Malam(
        "Selamat malam",
        PhosphorPaths.Moon,
        listOf(Color(0xFF0A171C), Color(0xFF132A30), Color(0xFF1B3C36)),
        Color(0xFF15342B),
        Color(0xFF102922),
        Color(0xFF0A1D18),
        true,
        null,
        Color(0xFFEAF3EC),
    ),
}

internal fun timePhaseFor(hour: Int = LocalTime.now().hour): TimePhase = when (hour) {
    in 5..9 -> TimePhase.Pagi
    in 10..15 -> TimePhase.Siang
    in 16..18 -> TimePhase.Sore
    else -> TimePhase.Malam
}

internal fun reducedMotionEnabled(context: Context): Boolean = runCatching {
    Settings.Global.getFloat(context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f
}.getOrDefault(false)

/** Full-bleed 4-phase local-time sky + layered botanical terasering hills (no sun at night, zero blink). */
@Composable
internal fun BotanicalSkyBackdrop(phase: TimePhase, modifier: Modifier = Modifier) {
    Canvas(modifier) {
        val w = size.width
        val h = size.height
        drawRect(Brush.verticalGradient(phase.skyColors))

        if (phase.isNight) {
            // Static gentle stars + soft crescent moon (no sun, no twinkle/blink).
            for (i in 0 until 24) {
                val sx = ((i * 79 + 13) % 96 + 2) / 100f * w
                val sy = ((i * 37 + 7) % 44 + 4) / 100f * h
                val alpha = if (i % 4 == 0) .62f else .32f
                drawCircle(Color(0xFFEAF4EC).copy(alpha = alpha), if (i % 5 == 0) 1.7f * density else 1.05f * density, Offset(sx, sy))
            }
            val mc = Offset(w * .8f, h * .16f)
            val mr = size.minDimension * .062f
            drawCircle(Color(0xFFE9F2DE).copy(alpha = .16f), mr * 2.5f, mc)
            drawCircle(Color(0xFFF3F6E4), mr, mc)
            drawCircle(phase.skyColors[0], mr * .88f, Offset(mc.x + mr * .38f, mc.y - mr * .18f))
        } else {
            val sc = Offset(w * .86f, h * .11f)
            val sr = size.minDimension * .064f
            val sun = phase.sunColor ?: Color(0xFFFFF4C2)
            drawCircle(Brush.radialGradient(listOf(sun.copy(alpha = .42f), Color.Transparent), sc, sr * 4.8f), sr * 4.8f, sc)
            drawCircle(sun.copy(alpha = .92f), sr, sc)
        }

        // Three organic terraced hill ridges (terasering) anchored at the bottom.
        fun terrace(topRatio: Float, crestA: Float, crestB: Float, fill: Color, ridgeTint: Color) {
            val y0 = h * topRatio
            val p = Path().apply {
                moveTo(0f, y0)
                cubicTo(w * .28f, h * crestA, w * .68f, h * crestB, w, h * (topRatio - .04f))
                lineTo(w, h)
                lineTo(0f, h)
                close()
            }
            drawPath(p, fill)
            val rim = Path().apply {
                moveTo(0f, y0)
                cubicTo(w * .28f, h * crestA, w * .68f, h * crestB, w, h * (topRatio - .04f))
            }
            drawPath(rim, ridgeTint, style = Stroke(1.3f * density, cap = StrokeCap.Round))
        }
        val ridge = Color.White.copy(alpha = if (phase.isNight) .08f else .16f)
        terrace(.57f, .50f, .62f, phase.hillBack, ridge)
        terrace(.68f, .74f, .61f, phase.hillMid, ridge)
        terrace(.80f, .74f, .86f, phase.hillFront, ridge)
    }
}

// ---------------------------------------------------------------- Liquid Glass Logo Reveal (AGSL + Canvas fallback)

private const val LIQUID_GLASS_AGSL = """
uniform float2 uSize;
uniform float uProgress;

half4 main(float2 fragCoord) {
    float2 uv = fragCoord / max(uSize, float2(1.0));
    float2 p = (uv - 0.5) * 2.0;
    float r = length(p);

    // Droplet refraction lens coalescing calmly from outer ring into a glass squircle.
    float wave = sin(r * 9.0 - uProgress * 4.4) * exp(-r * 1.9) * (1.0 - uProgress) * 0.16;
    float2 d = abs(p + p * wave);
    float squircle = pow(pow(d.x, 4.2) + pow(d.y, 4.2), 1.0 / 4.2);

    float tileMask = 1.0 - smoothstep(0.84, 0.90, squircle);
    float rim = smoothstep(0.72, 0.87, squircle) * tileMask;
    float specular = exp(-pow((p.x + p.y + 0.62 - uProgress * 0.35), 2.0) * 5.2) * tileMask;

    half3 emeraldTop = half3(0.18, 0.45, 0.34);
    half3 emeraldBot = half3(0.04, 0.24, 0.20);
    half3 base = mix(emeraldTop, emeraldBot, clamp(uv.y + wave, 0.0, 1.0));
    half3 frost = half3(0.84, 0.96, 0.86);

    half3 col = base + frost * half(rim * 0.36 + specular * 0.28);
    float alpha = tileMask * smoothstep(0.0, 0.24, uProgress);
    return half4(col * half(alpha), half(alpha));
}
"""

/**
 * Full-screen Liquid Glass Logo Reveal transition (ported from @shepovalovdenis/components/liquid-glass-logo-reveal):
 * AGSL RuntimeShader refraction on Android 13+, smooth Canvas glass fallback on API 26-32, kinetic Fraunces wordmark,
 * zero bounce/blink, tap-to-skip, and automatic reduced-motion handling.
 */
@Composable
internal fun LiquidGlassRevealOverlay(
    visible: Boolean,
    subtitle: String,
    onFinished: () -> Unit,
) {
    val context = LocalContext.current
    val phase = remember(visible) { timePhaseFor() }
    val reduced = remember(context) { reducedMotionEnabled(context) }
    val progress = remember { Animatable(0f) }

    LaunchedEffect(visible) {
        if (!visible) return@LaunchedEffect
        if (reduced) {
            progress.snapTo(1f)
            onFinished()
            return@LaunchedEffect
        }
        progress.snapTo(0f)
        progress.animateTo(1f, tween(1350, easing = CubicBezierEasing(0.22f, 1f, 0.36f, 1f)))
        onFinished()
    }

    AnimatedVisibility(
        visible = visible,
        enter = fadeIn(tween(180)),
        exit = fadeOut(tween(260)),
    ) {
        val t = progress.value
        val logoScale = .88f + .12f * t.coerceIn(0f, 1f)
        val textAlpha = ((t - .18f) / .45f).coerceIn(0f, 1f)
        val letterTrack = (.14f - .16f * textAlpha).toDouble()
        val shader = remember {
            if (Build.VERSION.SDK_INT >= 33) runCatching { RuntimeShader(LIQUID_GLASS_AGSL) }.getOrNull() else null
        }

        Box(
            Modifier
                .fillMaxSize()
                .clickable(remember { MutableInteractionSource() }, null, role = Role.Button) { onFinished() }
                .semantics { contentDescription = "Memuat Smart Agro. Ketuk untuk lewati." },
            contentAlignment = Alignment.Center,
        ) {
            BotanicalSkyBackdrop(phase, Modifier.fillMaxSize())
            Box(Modifier.fillMaxSize().background(Color(0x3D0B1D16)))
            Column(
                Modifier.fillMaxWidth().padding(horizontal = 32.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Box(
                    Modifier
                        .size(116.dp)
                        .graphicsLayer { scaleX = logoScale; scaleY = logoScale },
                    contentAlignment = Alignment.Center,
                ) {
                    Canvas(Modifier.fillMaxSize()) {
                        val ripple = (1f - t).coerceIn(0f, 1f)
                        // Subtle concentric water-lens halo settling inward (no blink).
                        if (ripple > .02f) {
                            val r = size.minDimension * (.48f + .26f * ripple)
                            drawCircle(Color(0xFFCDE9C2).copy(alpha = .24f * ripple), r, center, style = Stroke(1.5.dp.toPx()))
                        }
                        if (Build.VERSION.SDK_INT >= 33 && shader != null) {
                            runCatching {
                                shader.setFloatUniform("uSize", size.width, size.height)
                                shader.setFloatUniform("uProgress", t.coerceIn(.05f, 1f))
                                drawRoundRect(ShaderBrush(shader), cornerRadius = CornerRadius(28.dp.toPx()))
                            }.onFailure {
                                drawFallbackGlassTile(t)
                            }
                        } else {
                            drawFallbackGlassTile(t)
                        }
                    }
                    SmartAgroMark(
                        Modifier
                            .size(86.dp)
                            .graphicsLayer { alpha = (t * 1.45f).coerceIn(0f, 1f) },
                        showTile = false,
                    )
                }
                Spacer(Modifier.height(24.dp))
                Text(
                    "Smart Agro",
                    style = T.largeTitle.copy(letterSpacing = letterTrack.em),
                    color = Color(0xFFF6FAF4),
                    textAlign = TextAlign.Center,
                    modifier = Modifier.graphicsLayer {
                        alpha = textAlpha
                        translationY = (1f - textAlpha) * 14f
                    },
                )
                Spacer(Modifier.height(8.dp))
                Text(
                    subtitle,
                    style = T.subhead,
                    color = Color(0xFFD9E8DC),
                    textAlign = TextAlign.Center,
                    modifier = Modifier.graphicsLayer { alpha = textAlpha },
                )
                Spacer(Modifier.height(28.dp))
                Box(
                    Modifier
                        .width(156.dp)
                        .height(3.dp)
                        .clip(CircleShape)
                        .background(Color.White.copy(alpha = .22f)),
                ) {
                    Box(
                        Modifier
                            .fillMaxHeight()
                            .fillMaxWidth(t.coerceIn(.04f, 1f))
                            .clip(CircleShape)
                            .background(Color(0xFFCDE9C2)),
                    )
                }
            }
        }
    }
}

private fun DrawScope.drawFallbackGlassTile(progress: Float) {
    val cr = CornerRadius(28.dp.toPx())
    val inset = 4.dp.toPx()
    val tileSize = Size(size.width - inset * 2, size.height - inset * 2)
    drawRoundRect(
        Brush.linearGradient(
            listOf(Color(0xFF2D7257), Color(0xFF0B3D32)),
            Offset(inset, inset),
            Offset(size.width - inset, size.height - inset),
        ),
        Offset(inset, inset),
        tileSize,
        cr,
        alpha = (progress * 1.4f).coerceIn(0f, 1f),
    )
    drawRoundRect(
        Brush.linearGradient(
            listOf(Color.White.copy(alpha = .42f), Color.Transparent, Color(0xFFA0D099).copy(alpha = .22f)),
            Offset(inset, inset),
            Offset(size.width, size.height),
        ),
        Offset(inset, inset),
        tileSize,
        cr,
    )
    drawRoundRect(
        Color.White.copy(alpha = .46f),
        Offset(inset, inset),
        tileSize,
        cr,
        style = Stroke(1.2.dp.toPx()),
    )
}
