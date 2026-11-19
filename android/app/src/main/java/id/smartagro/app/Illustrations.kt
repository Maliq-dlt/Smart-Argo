package id.smartagro.app

import android.util.LruCache
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.lerp as lerpColor
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin

internal const val SMART_AGRO_LEAF_PATH =
    "M24 67C15 36 39 24 77 23c1 14-1 24-5 32-9-8-19-14-31-18 10 6 20 14 28 23-3 5-6 9-11 12-7-11-16-20-26-27 8 9 15 20 20 30-8 3-16 3-23 1 0-7-1-13-4-20 1 5 1 8-1 11Z"

/** Brand mark matching ikon.svg: emerald squircle with single terraced leaf. */
@Composable
fun SmartAgroMark(modifier: Modifier = Modifier, showTile: Boolean = true) {
    Canvas(modifier.semantics { contentDescription = "Ikon Smart Agro" }) {
        val side = min(size.width, size.height)
        val s = side / 100f
        withTransform({
            translate((size.width - side) / 2f, (size.height - side) / 2f)
            scale(s, s, Offset.Zero)
        }) {
            if (showTile) {
                drawRoundRect(
                    brush = Brush.linearGradient(
                        colors = listOf(Color(0xFF2D7257), Color(0xFF0B3D32)),
                        start = Offset.Zero,
                        end = Offset(90f, 100f),
                    ),
                    size = Size(100f, 100f),
                    cornerRadius = CornerRadius(23f, 23f),
                )
            }
            drawPath(
                path = illustrationPaths.get(SMART_AGRO_LEAF_PATH),
                brush = Brush.linearGradient(
                    colors = listOf(Color(0xFFA0D099), Color(0xFFF2F8CF)),
                    start = Offset(20f, 78f),
                    end = Offset(78f, 22f),
                ),
            )
        }
    }
}

/** 6 expressive states ported from konsep-kebun / ai-agent-mascot adaptation (zero blink, zero bounce). */
enum class MascotMood(val label: String, val caption: String) {
    Smile("Tenang", "Siap menemani kebun Anda"),
    Reading("Mengamati", "Memeriksa bacaan sensor terbaru"),
    Working("Merawat", "Menyiapkan panduan perawatan"),
    Happy("Optimal", "Tanaman berada di rentang segar"),
    Care("Perlu air", "Media mulai mengering, perlu dicek"),
    Shy("Menjaga sandi", "Menutup mata saat kata sandi diisi"),
}

private val illustrationPaths = object : LruCache<String, Path>(192) {
    override fun create(key: String): Path = PathParser().parsePathString(key).toPath()
}

private fun DrawScope.svg(d: String, color: Color, stroke: Float = 0f) {
    drawPath(
        illustrationPaths.get(d),
        color,
        style = if (stroke > 0f) Stroke(stroke, cap = StrokeCap.Round, join = StrokeJoin.Round) else Fill,
    )
}

/**
 * Interactive Smart Agro terracotta seedling mascot with 6 expressive states (Smile, Reading, Working, Happy, Care, Shy).
 * Password focus raises leaf hands to cover eyes; email input & pointer touch guide gaze smoothly; tap triggers a calm leaf nod.
 */
@Composable
fun Mascot(
    modifier: Modifier = Modifier,
    hidden: Boolean = false,
    gaze: Float = 0f,
    sad: Boolean = false,
    happy: Boolean = false,
    interactive: Boolean = false,
    mood: MascotMood? = null,
) {
    val haptics = rememberHaptics()
    val resolved = mood ?: when {
        hidden -> MascotMood.Shy
        sad -> MascotMood.Care
        happy -> MascotMood.Happy
        else -> MascotMood.Smile
    }
    val coverEyes = hidden || resolved == MascotMood.Shy
    val isCare = resolved == MascotMood.Care
    val isHappy = resolved == MascotMood.Happy
    val isReading = resolved == MascotMood.Reading
    val isWorking = resolved == MascotMood.Working

    val hands by animateFloatAsState(if (coverEyes) 1f else if (isWorking) .36f else 0f, tween(320, easing = FastOutSlowInEasing), label = "Leaf hands")
    var touchLook by remember { mutableStateOf<Float?>(null) }
    var greeting by remember { mutableIntStateOf(0) }
    val response = remember { Animatable(0f) }
    LaunchedEffect(greeting) {
        if (greeting > 0) {
            response.animateTo(1f, tween(220, easing = FastOutSlowInEasing))
            response.animateTo(0f, tween(540, easing = FastOutSlowInEasing))
        }
    }
    val baseGaze = when {
        touchLook != null -> touchLook!!
        isReading -> ((gaze.coerceIn(0f, 1f) - .5f) * 7f).coerceIn(-3.5f, 3.5f)
        else -> (gaze.coerceIn(0f, 1f) * 4f)
    }
    val look by animateFloatAsState(baseGaze, tween(200, easing = FastOutSlowInEasing), label = "Eye gaze")
    val lookY by animateFloatAsState(if (isReading) 1.8f else if (isWorking) 1f else 0f, tween(220, easing = FastOutSlowInEasing), label = "Eye gaze Y")
    val expression by animateFloatAsState(
        when {
            isCare -> -1f
            isHappy -> 1f
            isWorking -> .35f
            isReading -> -.15f
            else -> .25f
        },
        tween(380, easing = FastOutSlowInEasing),
        label = "Mood expression",
    )
    val flower by animateFloatAsState(if (isHappy) 1f else 0f, tween(420, easing = FastOutSlowInEasing), label = "Companion flower")
    val careDrop by animateFloatAsState(if (isCare) 1f else 0f, tween(360, easing = FastOutSlowInEasing), label = "Care water drop")
    val workHalo by animateFloatAsState(if (isWorking || isHappy) 1f else 0f, tween(380, easing = FastOutSlowInEasing), label = "Mood aura")
    val tilt by animateFloatAsState(
        when {
            isCare -> -13f
            isReading -> 4f
            isWorking -> 6f
            else -> 0f
        },
        tween(340, easing = FastOutSlowInEasing),
        label = "Sprout mood",
    )
    val interaction = if (!interactive) Modifier else Modifier
        .clickable(
            interactionSource = remember { MutableInteractionSource() },
            indication = null,
            role = Role.Button,
            onClickLabel = "Sapa maskot ${resolved.label}",
            onClick = { haptics.tick(); greeting++ },
        )
        .pointerInput(Unit) {
            awaitPointerEventScope {
                while (true) {
                    val point = awaitPointerEvent().changes.firstOrNull { it.pressed }
                    touchLook = point?.let { ((it.position.x / size.width.coerceAtLeast(1)) * 2f - 1f).coerceIn(-1f, 1f) * 4f }
                }
            }
        }
    Canvas(modifier.then(interaction)) {
        val s = min(size.width / 124f, size.height / 140f)
        withTransform({ translate((size.width - 124 * s) / 2 - 18 * s, (size.height - 140 * s) / 2 - 16 * s); scale(s, s, Offset.Zero) }) {
            if (workHalo > .01f) {
                val auraColor = if (isHappy) Color(0xFF93C47D) else Color(0xFF4D8A70)
                drawCircle(
                    Brush.radialGradient(listOf(auraColor.copy(alpha = .24f * workHalo), Color.Transparent), Offset(80f, 82f), 64f),
                    64f,
                    Offset(80f, 82f),
                )
            }
            drawOval(Color(0x2218211B), Offset(42f, 145.5f), Size(76f, 9f))
            rotate(tilt + response.value * 5f, Offset(80f, 72f)) {
                svg("M80 72C80 60 79 52 80 43", Color(0xFF5B7A52), 4f)
                svg("M79.5 56C66 58 56 50 57 37C70 35 79.5 43 79.5 56Z", Color(0xFF93B575))
                svg("M80.5 48C81.5 34 92 26 106 28C106 42 96 50 80.5 48Z", Color(0xFF52714B))
                svg("M78 54L63 41M82 46L99 33", Color(0xFFA3B383), 1.5f)
                if (flower > .001f) {
                    listOf(0f, 72f, 144f, 216f, 288f).forEach { angle ->
                        rotate(angle, Offset(80f, 41f)) {
                            drawOval(Color(0xFFF9F7DE).copy(alpha = flower), Offset(76.8f, 31f), Size(6.4f, 10f))
                        }
                    }
                    drawCircle(Color(0xFFD5B463).copy(alpha = flower), 3f, Offset(80f, 41f))
                }
            }
            // Terracotta pot body + rim
            svg("M41 80H119L112.5 133Q110.5 146 97 146H63Q49.5 146 47.5 133Z", Color(0xFFC49778))
            svg("M51 89L54.5 128", Color(0xFFE4BFA2), 3f)
            drawRoundRect(Color(0xFFD4AB8C), Offset(34f, 70f), Size(92f, 18f), CornerRadius(9f))
            drawOval(Color(0xBFCB7766), Offset(49.5f, 112f), Size(13f, 8f))
            drawOval(Color(0xBFCB7766), Offset(97.5f, 112f), Size(13f, 8f))

            // Care water droplet beside terracotta cheek (steady, non-blinking)
            if (careDrop > .01f) {
                withTransform({ translate(114f, 92f); scale(careDrop, careDrop, Offset(6f, 8f)) }) {
                    svg("M6 0C10 6 12 10 12 13A6 6 0 1 1 0 13C0 10 2 6 6 0Z", Color(0xFF4A8FA8).copy(alpha = careDrop))
                    drawCircle(Color.White.copy(alpha = .75f * careDrop), 1.5f, Offset(4f, 11.5f))
                }
            }

            // Eyes & brows
            for ((idx, x) in listOf(66f, 94f).withIndex()) {
                val leftEye = idx == 0
                if (coverEyes && hands > .65f) {
                    svg("M${x - 6.5} 103.5Q$x 109.5 ${x + 6.5} 103.5", Color(0xFF30271F), 2.6f)
                } else if (isHappy && !coverEyes) {
                    svg("M${x - 6.5} 106Q$x 97.5 ${x + 6.5} 106", Color(0xFF30271F), 2.8f)
                } else {
                    val eyeH = if (isReading) 12.2f else 14.8f - expression.coerceAtLeast(0f) * 1.4f
                    val topY = 96.6f + (14.8f - eyeH) * .5f + lookY
                    drawOval(Color(0xFF30271F), Offset(x - 6.4f + look, topY), Size(12.8f, eyeH))
                    drawCircle(Color(0xFFFFFBF4), 2.3f, Offset(x - 2.1f + look, topY + 4.4f))
                    drawCircle(Color(0xFFFFFBF4), 1.1f, Offset(x + 2.2f + look, topY + eyeH - 4.4f))
                    if (isCare) {
                        val bStart = if (leftEye) Offset(x - 7f, 93f) else Offset(x - 6f, 89.5f)
                        val bEnd = if (leftEye) Offset(x + 6f, 89.5f) else Offset(x + 7f, 93f)
                        drawLine(Color(0xFF30271F), bStart, bEnd, 2.2f, cap = StrokeCap.Round)
                    } else if (isWorking) {
                        val bStart = if (leftEye) Offset(x - 6f, 90f) else Offset(x - 6f, 92.5f)
                        val bEnd = if (leftEye) Offset(x + 6f, 92.5f) else Offset(x + 6f, 90f)
                        drawLine(Color(0xFF30271F), bStart, bEnd, 2.2f, cap = StrokeCap.Round)
                    }
                }
            }
            // Mouth
            if (isReading) {
                drawLine(Color(0xFF30271F), Offset(76.5f, 119.5f), Offset(83.5f, 119.5f), 2.4f, cap = StrokeCap.Round)
            } else {
                svg("M74 119Q80 ${121.5f + expression * 5.2f} 86 119", Color(0xFF30271F), 2.6f)
            }

            // Leaf hands
            for (right in listOf(false, true)) withTransform({
                translate(if (right) 118f else 42f, 111f)
                if (right) scale(-1f, 1f, Offset.Zero)
                val baseAngle = if (coverEyes) 118f - 134f * hands else 118f - 84f * hands
                rotate(baseAngle - response.value * 16f, Offset.Zero)
            }) {
                svg("M0 0C6 -9 19 -10 27 -2C19 6 6 7 0 0Z", Color(0xFF52714B))
                svg("M3 -.5H21", Color(0xFFA3B383), 1.2f)
            }
        }
    }
}

/** Frosted status pill paired with the mascot; steady dot (never blinking). */
@Composable
fun MascotPill(mood: MascotMood, modifier: Modifier = Modifier, customLabel: String? = null) {
    val p = palette
    val dotColor by animateColorAsState(
        when (mood) {
            MascotMood.Care -> p.warn
            MascotMood.Reading -> p.water
            MascotMood.Working -> p.sun
            MascotMood.Happy -> p.tint
            MascotMood.Shy -> p.secondary
            MascotMood.Smile -> p.tint
        },
        Springs.smooth(),
        label = "Warna status maskot",
    )
    val bg = if (p.dark) p.raised.copy(alpha = .92f) else Color(0xEBFFFFFF)
    Row(
        modifier
            .clip(RoundedCornerShape(50))
            .background(bg)
            .border(.75.dp, p.separator, RoundedCornerShape(50))
            .padding(horizontal = 12.dp, vertical = 6.dp)
            .semantics(mergeDescendants = true) { },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(7.dp),
    ) {
        Box(Modifier.size(8.dp).clip(CircleShape).background(dotColor))
        Text(
            customLabel ?: mood.label,
            style = T.footnote.copy(fontWeight = FontWeight.Medium),
            color = p.ink,
            maxLines = 1,
        )
    }
}

/** Interactive mascot stage with live status badge and optional state preview strip (advice sheet). */
@Composable
fun MascotStage(
    mood: MascotMood,
    modifier: Modifier = Modifier,
    caption: String = mood.caption,
    previewMoods: List<MascotMood> = emptyList(),
    onSelectMood: ((MascotMood) -> Unit)? = null,
) {
    val p = palette
    val stageBrush = Brush.verticalGradient(
        if (p.dark) listOf(Color(0xFF192720), p.cell) else listOf(Color(0xFFEAF3E2), p.cell),
    )
    Column(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp)
            .clip(RoundedCornerShape(24.dp))
            .background(stageBrush)
            .border(.75.dp, p.separator, RoundedCornerShape(24.dp))
            .padding(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        MascotPill(mood)
        Mascot(
            Modifier.padding(top = 8.dp).size(116.dp, 130.dp),
            mood = mood,
            interactive = true,
        )
        Text(caption, style = T.subhead, color = p.secondary, modifier = Modifier.padding(top = 4.dp))
        Text("Ketuk maskot untuk menyapa.", style = T.footnote, color = p.secondary, modifier = Modifier.padding(top = 2.dp))
        if (previewMoods.isNotEmpty() && onSelectMood != null) {
            Row(
                Modifier.padding(top = 12.dp).horizontalScroll(rememberScrollState()),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                previewMoods.forEach { option ->
                    Pill(option.label, option == mood) { onSelectMood(option) }
                }
            }
        }
    }
}

private fun smoothstep(t: Float): Float = t.coerceIn(0f, 1f).let { u -> u * u * (3f - 2f * u) }
private fun dirOf(side: Int, elev: Float): Float = if (side > 0) -elev else 180f + elev

private fun DrawScope.drawRibbon(
    x: Float,
    y: Float,
    angleDeg: Float,
    len: Float,
    curveDeg: Float,
    width: Float,
    shape: (Float) -> Float,
    fill: Color,
    edge: Color? = null,
    rib: Color? = null,
    steps: Int = 10,
) {
    if (len <= 1.5f) return
    val left = ArrayList<Offset>(steps + 1)
    val right = ArrayList<Offset>(steps + 1)
    val spine = ArrayList<Offset>(steps + 1)
    var px = x
    var py = y
    var th = (angleDeg * PI / 180.0).toFloat()
    val dth = (curveDeg * PI / 180.0).toFloat() / steps
    val step = len / steps
    for (i in 0..steps) {
        val t = i.toFloat() / steps
        val w = width * shape(t) * 0.5f
        val nx = -sin(th)
        val ny = cos(th)
        left.add(Offset(px + nx * w, py + ny * w))
        right.add(Offset(px - nx * w, py - ny * w))
        spine.add(Offset(px, py))
        th += dth
        px += cos(th) * step
        py += sin(th) * step
    }
    val body = Path().apply {
        moveTo(left[0].x, left[0].y)
        for (i in 1 until left.size - 1) {
            val a = left[i]
            val b = left[i + 1]
            quadraticTo(a.x, a.y, (a.x + b.x) * 0.5f, (a.y + b.y) * 0.5f)
        }
        lineTo(left.last().x, left.last().y)
        val rev = right.asReversed()
        lineTo(rev[0].x, rev[0].y)
        for (i in 1 until rev.size - 1) {
            val a = rev[i]
            val b = rev[i + 1]
            quadraticTo(a.x, a.y, (a.x + b.x) * 0.5f, (a.y + b.y) * 0.5f)
        }
        lineTo(rev.last().x, rev.last().y)
        close()
    }
    drawPath(body, fill)
    if (edge != null) drawPath(body, edge, style = Stroke(1f, cap = StrokeCap.Round, join = StrokeJoin.Round))
    if (rib != null) {
        val mid = Path().apply {
            moveTo(spine[0].x, spine[0].y)
            for (i in 1 until spine.size - 1) {
                val a = spine[i]
                val b = spine[i + 1]
                quadraticTo(a.x, a.y, (a.x + b.x) * 0.5f, (a.y + b.y) * 0.5f)
            }
            lineTo(spine.last().x, spine.last().y)
        }
        drawPath(mid, rib, style = Stroke(1.1f, cap = StrokeCap.Round))
    }
}

/**
 * Interactive 460 x 485 plant stage ported from Fase 2 plantScene/plants.ts + parts.ts:
 * organic ribbon leaves, blossoms/fruit, shallot bulbs, orchid spikes, cutaway soil + drainage gravel,
 * and the Smart Agro solar sensor seated on the right rim. Motion settles cleanly to equilibrium on touch (no loop).
 */
@Composable
fun PlantScene(
    modifier: Modifier = Modifier,
    onion: Boolean = false,
    moisture: Double? = null,
    cutaway: Boolean = true,
    day: Int = 35,
    interactive: Boolean = false,
    daylight: Boolean? = null,
    cloudy: Boolean? = null,
    speciesId: Int = if (onion) 2 else 1,
) {
    val haptics = rememberHaptics()
    var touch by remember { mutableIntStateOf(0) }
    val response = remember { Animatable(0f) }
    LaunchedEffect(touch) {
        if (touch > 0) {
            response.animateTo(1f, tween(240, easing = FastOutSlowInEasing))
            response.animateTo(0f, tween(720, easing = FastOutSlowInEasing))
        }
    }
    val trailing by animateFloatAsState(response.value, tween(160), label = "Leaf follow through")
    val species by animateFloatAsState(if (onion) 1f else 0f, tween(560), label = "Plant species")
    val dry by animateFloatAsState(((60f - (moisture?.toFloat() ?: 60f)) / 30f).coerceIn(0f, 1f), tween(600), label = "Moisture leaf pose")
    val shell by animateFloatAsState(if (cutaway) 0f else 1f, tween(560), label = "Pot cutaway")
    val growth by animateFloatAsState(min(1f, .12f + day / if (onion) 48f else 62f), tween(320), label = "Illustrative growth")
    val wet by animateFloatAsState((moisture?.div(100)?.toFloat() ?: 0f).coerceIn(0f, 1f), tween(320), label = "Soil moisture")
    val sky by animateFloatAsState(if (daylight == null) 0f else 1f, tween(600), label = "Weather scene visibility")
    val night by animateFloatAsState(if (daylight == false) 1f else 0f, tween(600), label = "Weather scene daylight")
    val cloud by animateFloatAsState(if (cloudy == true) 1f else 0f, tween(600), label = "Weather scene clouds")
    val interaction = if (!interactive) Modifier else Modifier.clickable(
        interactionSource = remember { MutableInteractionSource() },
        indication = null,
        role = Role.Button,
        onClickLabel = "Gerakkan daun",
        onClick = { haptics.tick(); touch++ },
    )
    Canvas(modifier.then(interaction)) {
        val s = min(size.width / 460f, size.height / 485f)
        withTransform({ translate((size.width - 460 * s) / 2, (size.height - 485 * s) / 2); scale(s, s, Offset.Zero) }) {
            if (sky > .001f) {
                drawCircle(Color(0xFFD5B463).copy(alpha = sky * (1f - night)), 23f, Offset(345f, 72f))
                drawCircle(Color(0xFFB0BCB6).copy(alpha = sky * night), 20f, Offset(345f, 72f))
                drawOval(Color(0xFFA6B5AC).copy(alpha = sky * cloud * .7f), Offset(299f, 77f), Size(96f, 25f))
            }
            // Anchored pot foundation across Cabai & Bawang so in-place species crossfades keep pot grounded.
            val orchid = speciesId == 3
            drawOval(Color(0x1818211B), Offset(83f, 439f), Size(290f, 24f))
            if (orchid) {
                val barkPath = "M118 316H336L314 435Q226 446 140 435Z"
                svg(barkPath, Color(0xFF3B2F26))
                svg(barkPath, Color(0xFF13202A).copy(alpha = wet * .5f))
                clipPath(illustrationPaths.get(barkPath)) {
                    repeat(28) { i ->
                        val cx = 132f + ((i * 53) % 192)
                        val cy = 326f + ((i * 31) % 102)
                        drawOval(Color(if (i % 2 == 0) 0xFF7A5A3D else 0xFF5D432E).copy(alpha = 1f - shell * .5f), Offset(cx, cy), Size(20f, 13f))
                    }
                    withTransform({ scale(1f, .28f + growth * .72f, Offset(225f, 315f)) }) {
                        svg("M192 318Q184 352 204 388T188 424M224 316Q238 348 214 384T236 422M262 318Q278 352 252 390T270 424", Color(0xFFB8C9A8), 4.2f)
                    }
                }
                svg("M104 313H350L321 444Q226 459 133 444Z", Color(0x42FFFFFF))
                svg("M104 313H350L321 444Q226 459 133 444Z", Color(0xD8FFFFFF), stroke = 1.6f)
                svg("M102 306Q225 295 352 306L350 318Q225 307 104 318Z", Color(0x88FFFFFF))
            } else {
                svg("M104 313H350L321 444Q226 459 133 444Z", Color(0xFFB99B87))
                val mediaPath = "M114 316H340L314 435H140Z"
                svg(mediaPath, Color(0xFF998169))
                svg(mediaPath, Color(0xFF4A3B32).copy(alpha = wet))
                // Soil & drainage gravel band when pot wall is cut open.
                clipPath(illustrationPaths.get(mediaPath)) {
                    svg("M119 339Q181 334 231 341T335 337M127 372Q175 378 228 371T326 376", Color(0xFF8E745E), 1f)
                    drawRect(Color(0xFF8A8579), Offset(114f, 412f), Size(226f, 26f))
                    repeat(10) { i ->
                        drawOval(Color(if (i % 2 == 0) 0xFFA8A396 else 0xFF7C776B), Offset(138f + i * 19f, 416f + (i % 3) * 5f), Size(16f, 10f))
                    }
                }
                clipRect(110f, 316f, 342f, 316f + 124f * (1f - shell)) {
                    withTransform({ scale(1f, .28f + growth * .72f, Offset(225f, 315f)) }) {
                        svg("M226 307Q228 338 215 357T222 415M227 327Q248 344 253 374L270 398M221 335Q189 351 184 379L174 402M222 355Q207 382 204 424", Color(0xFFDBC49D), 2.2f)
                        svg("m217 350-21 10-16-2m33 17 15 11 5 20m-31-53-18 6-15 15m76-22 21 8 11 24m-20-13-9 20 4 15m-47-1-19 10-9 14m26-1 9 9m-44-23-16 3m57 10 8 9m-23-2-10 8m65-28 12 5", Color(0xFFDBC49D), 1f)
                    }
                    // Steel probe tips peeking into cut-open soil below rim-mounted Smart Agro sensor.
                    for (px in listOf(291f, 307f)) {
                        drawRoundRect(Color(0xFFCDD6CD), Offset(px, 316f), Size(4.4f, 30f), CornerRadius(2f))
                        drawLine(Color(0xFF6A7A70), Offset(px, 326f), Offset(px + 4.4f, 326f), 1.4f)
                        drawLine(Color(0xFF6A7A70), Offset(px, 336f), Offset(px + 4.4f, 336f), 1.4f)
                    }
                }
                svg("M102 306Q225 295 352 306L350 318Q225 307 104 318Z", Color(0xFFCEB29C))
            }

            // Smart Agro cartoon device sitting cleanly on the right pot rim (y=252..310).
            drawPotDevice(x = 278f, y = 258f, online = moisture != null)

            // Crown
            for (isOnion in if (speciesId in 1..2) listOf(false, true) else emptyList()) {
                val opacity = if (isOnion) species else 1f - species
                if (opacity > .001f) withTransform({ rotate(response.value * 1.4f, Offset(225f, 312f)) }) {
                    plantCrown(isOnion, growth, day, opacity, dry, response.value, trailing)
                }
            }
            if (speciesId !in 1..2) {
                orchidOrGenericCrown(speciesId, growth, day, dry, response.value, trailing)
            }
            if (!orchid && shell > .001f) {
                drawPath(
                    illustrationPaths.get("M114 316H340L314 435Q226 450 140 435Z"),
                    Brush.horizontalGradient(listOf(Color(0xFF9B7D6A).copy(alpha = shell), Soil.copy(alpha = shell), Color(0xFFCEB29C).copy(alpha = shell))),
                )
            }
            if (!orchid) {
                svg("M125 443Q226 454 328 442L335 449Q227 467 118 451Z", Color(0xFF9B7D6A))
            }
        }
    }
}

private fun DrawScope.drawPotDevice(x: Float, y: Float, online: Boolean) {
    // Solar panel roof + off-white squircle body + sage base skirt + steady LED.
    drawRoundRect(Color(0xFF35525E), Offset(x + 6f, y - 5f), Size(34f, 9f), CornerRadius(3f))
    drawRoundRect(Color(0xFF4F7384), Offset(x + 9f, y - 3f), Size(28f, 5f), CornerRadius(1.5f))
    drawRoundRect(Color(0xFFECE6CF), Offset(x, y + 2f), Size(46f, 48f), CornerRadius(14f))
    drawRoundRect(Color(0xFF857F5C), Offset(x, y + 2f), Size(46f, 48f), CornerRadius(14f), style = Stroke(1.6f))
    drawRoundRect(Color(0xFF4D6556), Offset(x + 2f, y + 36f), Size(42f, 14f), CornerRadius(8f))
    drawCircle(if (online) Color(0xFF52C88F) else Color(0xFFE0A23A), 3.4f, Offset(x + 14f, y + 17f))
    drawCircle(Color(0xFF2F5A3C), 2.5f, Offset(x + 28f, y + 18f), style = Stroke(1.4f))
}

private fun DrawScope.plantCrown(onion: Boolean, growth: Float, day: Int, opacity: Float, dry: Float, response: Float, trailing: Float) {
    val h = 214f * growth
    if (onion) {
        val bulbScale = smoothstep(((day - 8f) / 40f).coerceIn(0f, 1f))
        val bw = 18f + 16f * bulbScale
        val bh = 18f + 12f * bulbScale
        // Cluster of purple-rose shallot bulbs at soil level.
        for ((bx, s) in listOf(-24f to .75f, 22f to .8f, -1f to 1f)) {
            drawOval(Color(0xFFB57681).copy(alpha = opacity), Offset(214f + bx - bw * s * .5f, 314f - bh * s), Size(bw * s, bh * s))
            drawOval(Color(0xFF8E5368).copy(alpha = opacity), Offset(214f + bx - bw * s * .5f, 314f - bh * s), Size(bw * s, bh * s), style = Stroke(1.2f))
        }
        val ripe = ((day - 48f) / 17f).coerceIn(0f, 1f)
        repeat(9) { i ->
            val c = (i - 4f) / 4f
            val side = if (c < 0f) -1f else 1f
            val leafLen = (68f + 150f * growth) * (.68f + .32f * (1f - abs(c)))
            val curve = side * (abs(c) * 18f + dry * 28f + ripe * 24f) + side * (response * (1f - i / 9f) + trailing * (i / 9f) * 2f) * 2.5f
            val fill = lerpColor(Color(if (i % 2 == 0) 0xFF4F8F46 else 0xFF6AA650), Color(0xFFC3BD6A), ripe * .75f).copy(alpha = opacity)
            drawRibbon(
                x = 198f + i * 4.5f,
                y = 304f,
                angleDeg = -90f + c * 22f,
                len = leafLen,
                curveDeg = curve,
                width = 8.4f,
                shape = { t -> if (t < .07f) .55f + t * 6f else 1f - t.pow(3.2f) * .92f },
                fill = fill,
                edge = Color(0xFF33642D).copy(alpha = opacity),
                rib = Color(0xFFB6E0A4).copy(alpha = opacity * .65f),
            )
        }
    } else {
        val green = Color(0xFF52714B).copy(alpha = opacity)
        svg("M227 311Q217 ${315 - h / 2} 226 ${310 - h}", green, 4.5f)
        val count = min(7, 2 + day.coerceAtLeast(0) / 8)
        repeat(count * 2) { i ->
            val tier = i / 2
            val side = if (i % 2 == 1) 1 else -1
            val y = 292f - (tier + 1) * h / (count + 1)
            val leafLen = (52f + (count - tier) * 5f) * min(1f, growth + .4f)
            val elev = (38f - tier * 3f) - dry * 16f
            val twist = side * (response * (1f - tier.toFloat() / count) * 2f + trailing * tier / count * 3f)
            rotate(twist, Offset(225f, y + 10f)) {
                drawLine(green, Offset(225f, y + 12f), Offset(225f + side * 14f, y + 4f), 2f, cap = StrokeCap.Round)
                drawRibbon(
                    x = 225f + side * 13f,
                    y = y + 4f,
                    angleDeg = dirOf(side, elev),
                    len = leafLen,
                    curveDeg = side * (14f + dry * 22f),
                    width = leafLen * .46f,
                    shape = { t -> sin(PI * t.pow(.72f)).toFloat() },
                    fill = Color(if (i % 3 == 0) 0xFF789367 else 0xFF52714B).copy(alpha = opacity),
                    edge = Color(0xFF37692F).copy(alpha = opacity),
                    rib = Color(0xFFA9D79A).copy(alpha = opacity * .7f),
                )
            }
        }
        // Flowers after day 31, chili pods after day 56.
        if (day >= 31 && day < 68) {
            val bloomAlpha = smoothstep((day - 31f) / 10f) * (1f - smoothstep((day - 56f) / 12f))
            listOf(Offset(195f, 208f), Offset(256f, 186f), Offset(208f, 152f)).forEach { fc ->
                repeat(5) { k ->
                    rotate(k * 72f, fc) {
                        drawOval(Color(0xFFFBFAF2).copy(alpha = opacity * bloomAlpha), Offset(fc.x - 3f, fc.y - 10f), Size(6f, 10f))
                    }
                }
                drawCircle(Color(0xFFE3D98A).copy(alpha = opacity * bloomAlpha), 2.5f, fc)
            }
        }
        if (day >= 56) {
            val podScale = smoothstep((day - 56f) / 12f)
            val podColor = lerpColor(Color(0xFF7FAE4E), Color(0xFFC4472F), ((day - 56f) / 30f).coerceIn(0f, 1f)).copy(alpha = opacity)
            listOf(Triple(196f, 198f, 16f), Triple(252f, 182f, -18f), Triple(216f, 148f, 10f)).forEach { (px, py, rot) ->
                withTransform({ translate(px, py); rotate(rot, Offset.Zero); scale(podScale, podScale, Offset.Zero) }) {
                    svg("M0 0C3 9 4 20 1.5 32C-1 22 -3 10 0 0Z", podColor)
                    drawCircle(Color(0xFF4F7F3A).copy(alpha = opacity), 2.6f, Offset.Zero)
                }
            }
        }
    }
}

private fun DrawScope.orchidOrGenericCrown(speciesId: Int, growth: Float, day: Int, dry: Float, response: Float, trailing: Float) {
    withTransform({ rotate(response * 1.4f + trailing * 1.2f, Offset(225f, 310f)) }) {
        if (speciesId == 3) {
            // Aerial orchid roots spilling gracefully outside rim.
            for ((rx, side) in listOf(180f to -1, 270f to 1, 196f to -1)) {
                drawRibbon(rx, 306f, if (side > 0) -14f else 194f, 66f, side * 78f, 6.2f, { 1f - it * .45f }, Color(0xFFB4C4A6), Color(0xFF8DA07F))
            }
            // Layered oval leaves
            listOf(Triple(-1, 14f, 108f), Triple(1, 14f, 108f), Triple(-1, 32f, 92f), Triple(1, 32f, 92f)).forEach { (side, elev, len) ->
                drawRibbon(
                    225f + side * 4f, 302f, dirOf(side, elev - dry * 12f), len * growth.coerceAtLeast(.4f), side * (36f + dry * 16f),
                    34f, { sin(PI * it.pow(.78f)).pow(.55).toFloat() }, Color(0xFF2F6B3D), Color(0xFF265A31), Color(0xFFBFE3A8),
                )
            }
            // Orchid spike & blooms
            val sp = smoothstep((day - 20f) / 40f).coerceAtLeast(.35f)
            val topY = 300f - 170f * sp
            svg("M225 300Q244 ${(300f + topY) / 2} 228 $topY", Color(0xFF7D9457), 3.6f)
            listOf(Offset(235f, topY + 46f), Offset(222f, topY + 22f), Offset(228f, topY)).forEachIndexed { idx, c ->
                val sc = 1f - idx * .12f
                withTransform({ translate(c.x, c.y); scale(sc, sc, Offset.Zero) }) {
                    repeat(5) { i ->
                        rotate(i * 72f, Offset.Zero) {
                            drawOval(Color(0xFFF6F1FA), Offset(-11f, -25f), Size(22f, 26f))
                            drawOval(Color(0xFFD6CFDC), Offset(-11f, -25f), Size(22f, 26f), style = Stroke(.7f))
                        }
                    }
                    drawOval(Color(0xFFB0467F), Offset(-6f, -3f), Size(12f, 14f))
                    drawCircle(Color(0xFFE8C34A), 3.4f, Offset(0f, 1f))
                }
            }
        } else {
            val green = Color(0xFF52714B)
            for (side in listOf(-1, 1)) rotate(side * 24f, Offset(225f, 310f)) {
                drawOval(green, Offset(if (side < 0) 155f else 225f, 267f), Size(70f, 35f))
            }
            svg("M225 310Q244 225 228 164", green, 3f)
            if (speciesId == 4) {
                val center = Offset(228f, 164f)
                repeat(8) { i ->
                    rotate(i * 45f, center) {
                        drawOval(Color(0xFFE6B8C8), Offset(212f, 119f), Size(32f, 48f))
                    }
                }
                drawCircle(Color(0xFFD8B25B), 9f, center)
            } else drawOval(green, Offset(202f, 153f), Size(30f, 18f))
        }
    }
}
