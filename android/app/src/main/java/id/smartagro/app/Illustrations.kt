package id.smartagro.app

import android.util.LruCache
import androidx.compose.ui.graphics.Path
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.clipRect
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.graphics.vector.PathParser
import kotlin.math.min

private val illustrationPaths = object : LruCache<String, Path>(128) {
    override fun create(key: String): Path = PathParser().parsePathString(key).toPath()
}
private fun DrawScope.svg(d: String, color: Color, stroke: Float = 0f) {
    drawPath(illustrationPaths.get(d), color,
        style = if (stroke > 0) Stroke(stroke, cap = StrokeCap.Round) else androidx.compose.ui.graphics.drawscope.Fill)
}
/** Native Canvas port of Mascot.tsx. Password focus covers the eyes; email length moves the gaze. */
@Composable fun Mascot(modifier: Modifier = Modifier, hidden: Boolean = false, gaze: Float = 0f, sad: Boolean = false, happy: Boolean = false, interactive: Boolean = false) {
    val hands by animateFloatAsState(if (hidden) 1f else 0f, tween(320), label = "Leaf hands")
    var touchLook by remember { mutableStateOf<Float?>(null) }
    var greeting by remember { mutableIntStateOf(0) }
    val response = remember { Animatable(0f) }
    LaunchedEffect(greeting) {
        if (greeting > 0) {
            response.animateTo(1f, tween(220, easing = FastOutSlowInEasing))
            response.animateTo(0f, tween(620, easing = FastOutSlowInEasing))
        }
    }
    val look by animateFloatAsState(touchLook ?: (gaze.coerceIn(0f, 1f) * 4f), tween(180), label = "Eye gaze")
    val expression by animateFloatAsState(if (sad) -1f else if (happy) 1f else 0f, tween(420), label = "Moisture expression")
    val flower by animateFloatAsState(if (happy) 1f else 0f, tween(420), label = "Companion flower")
    val interaction = if (!interactive) Modifier else Modifier
        .clickable(interactionSource = remember { MutableInteractionSource() }, indication = null,
            role = Role.Button, onClickLabel = "Sapa maskot", onClick = { greeting++ })
        .pointerInput(Unit) {
            awaitPointerEventScope {
                while (true) {
                    val point = awaitPointerEvent().changes.firstOrNull { it.pressed }
                    touchLook = point?.let { ((it.position.x / size.width.coerceAtLeast(1)) * 2f - 1f).coerceIn(-1f, 1f) * 4f }
                }
            }
        }
    val tilt by animateFloatAsState(if (sad) -14f else 0f, tween(320), label = "Sprout mood")
    Canvas(modifier.then(interaction)) {
        val s = min(size.width / 124f, size.height / 140f)
        withTransform({ translate((size.width - 124*s)/2 - 18*s, (size.height - 140*s)/2 - 16*s); scale(s, s, Offset.Zero) }) {
            drawOval(Color(0x2218211B), Offset(42f, 145.5f), Size(76f, 9f))
            rotate(tilt + response.value * 3f, Offset(80f, 72f)) {
                svg("M80 72C80 60 79 52 80 43", Color(0xFF5B7A52), 4f)
                svg("M79.5 56C66 58 56 50 57 37C70 35 79.5 43 79.5 56Z", Color(0xFF93B575))
                svg("M80.5 48C81.5 34 92 26 106 28C106 42 96 50 80.5 48Z", Color(0xFF52714B))
                svg("M78 54L63 41M82 46L99 33", Color(0xFFA3B383), 1.5f)
                if (flower > .001f) {
                    listOf(0f, 72f, 144f, 216f, 288f).forEach { angle -> rotate(angle, Offset(80f,41f)) {
                        drawOval(Color(0xFFF9F7DE).copy(alpha = flower), Offset(76.8f,31f), Size(6.4f,10f))
                    } }
                    drawCircle(Color(0xFFD5B463).copy(alpha = flower), 3f, Offset(80f,41f))
                }
            }
            svg("M41 80H119L112.5 133Q110.5 146 97 146H63Q49.5 146 47.5 133Z", Color(0xFFC49778))
            svg("M51 89L54.5 128", Color(0xFFE4BFA2), 3f)
            drawRoundRect(Color(0xFFD4AB8C), Offset(34f,70f), Size(92f,18f), CornerRadius(9f))
            drawOval(Color(0xBFCB7766), Offset(49.5f,112f), Size(13f,8f))
            drawOval(Color(0xBFCB7766), Offset(97.5f,112f), Size(13f,8f))
            for (x in listOf(66f,94f)) {
                if (hands > .7f) svg(if (happy) "M${x-6.5} 106Q$x 98.5 ${x+6.5} 106" else "M${x-6.5} 103.5Q$x 109.5 ${x+6.5} 103.5", Color(0xFF30271F), 2.6f)
                else {
                    drawOval(Color(0xFF30271F), Offset(x-6.4f+look,96.6f), Size(12.8f,14.8f - expression.coerceAtLeast(0f) * 2f))
                    drawCircle(Color(0xFFFFFBF4), 2.3f, Offset(x-2.1f+look,101.3f))
                    drawCircle(Color(0xFFFFFBF4), 1.1f, Offset(x+2.2f+look,106.6f))
                }
            }
            svg("M74 119Q80 ${122f + expression * 5f} 86 119", Color(0xFF30271F), 2.6f)
            for (right in listOf(false,true)) withTransform({
                translate(if (right) 118f else 42f,111f)
                if (right) scale(-1f,1f,Offset.Zero)
                rotate(118f - 134f*hands - response.value * 12f, Offset.Zero)
            }) {
                svg("M0 0C6 -9 19 -10 27 -2C19 6 6 7 0 0Z", Color(0xFF52714B))
                svg("M3 -.5H21", Color(0xFFA3B383), 1.2f)
            }
        }
    }
}
/** Same 460 x 485 drawing coordinates and leaf/root curves as the web illustration. */
@Composable fun PlantScene(modifier: Modifier = Modifier, onion: Boolean = false, moisture: Double? = null, cutaway: Boolean = true, day: Int = 35, interactive: Boolean = false, daylight: Boolean? = null, cloudy: Boolean? = null, speciesId: Int = if(onion) 2 else 1) {
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
    val dry by animateFloatAsState(((60f - (moisture?.toFloat() ?: 60f)) / 30f).coerceIn(0f,1f), tween(600), label = "Moisture leaf pose")
    val shell by animateFloatAsState(if (cutaway) 0f else 1f, tween(560), label = "Pot cutaway")
    val growth by animateFloatAsState(min(1f,.12f + day / if (onion) 48f else 62f), tween(320), label = "Illustrative growth")
    val wet by animateFloatAsState((moisture?.div(100)?.toFloat() ?: 0f).coerceIn(0f,1f), tween(320), label = "Soil moisture")
    val sky by animateFloatAsState(if(daylight==null) 0f else 1f,tween(600),label="Weather scene visibility")
    val night by animateFloatAsState(if(daylight==false) 1f else 0f,tween(600),label="Weather scene daylight")
    val cloud by animateFloatAsState(if(cloudy==true) 1f else 0f,tween(600),label="Weather scene clouds")
    val interaction = if (!interactive) Modifier else Modifier.clickable(
        interactionSource = remember { MutableInteractionSource() }, indication = null,
        role = Role.Button, onClickLabel = "Gerakkan daun", onClick = { touch++ })
    Canvas(modifier.then(interaction)) {
        val s = min(size.width / 460f, size.height / 485f)
        withTransform({ translate((size.width - 460*s)/2,(size.height - 485*s)/2); scale(s,s,Offset.Zero) }) {
            if(sky>.001f) {
                drawCircle(Color(0xFFD5B463).copy(alpha=sky*(1f-night)),23f,Offset(345f,72f))
                drawCircle(Color(0xFFB0BCB6).copy(alpha=sky*night),20f,Offset(345f,72f))
                drawOval(Color(0xFFA6B5AC).copy(alpha=sky*cloud*.7f),Offset(299f,77f),Size(96f,25f))
            }
            drawOval(Color(0x1818211B), Offset(83f,439f), Size(290f,24f))
            svg("M104 313H350L321 444Q226 459 133 444Z", Color(0xFFB99B87))
            svg("M114 316H340L314 435H140Z", Color(0xFF998169))
            svg("M114 316H340L314 435H140Z", Color(0xFF4A3B32).copy(alpha = wet))
            svg("M119 339Q181 334 231 341T335 337M127 380Q175 386 228 379T326 384", Color(0xFF8E745E), 1f)
            clipRect(110f, 316f, 342f, 316f + 124f * (1f - shell)) {
                withTransform({ scale(1f,.28f+growth*.72f,Offset(225f,315f)) }) {
                    svg("M226 307Q228 338 215 357T222 415M227 327Q248 344 253 374L270 398M221 335Q189 351 184 379L174 402M222 355Q207 382 204 424", Color(0xFFDBC49D),2.2f)
                    svg("m217 350-21 10-16-2m33 17 15 11 5 20m-31-53-18 6-15 15m76-22 21 8 11 24m-20-13-9 20 4 15m-47-1-19 10-9 14m26-1 9 9m-44-23-16 3m57 10 8 9m-23-2-10 8m65-28 12 5",Color(0xFFDBC49D),1f)
                }
            }
            svg("M102 306Q225 295 352 306L350 318Q225 307 104 318Z",Color(0xFFCEB29C))
            // ponytail: two native crowns cover current crops; add a rig only when new silhouettes need one.
            for (isOnion in if(speciesId in 1..2) listOf(false,true) else emptyList()) {
                val opacity = if (isOnion) species else 1f - species
                if (opacity > .001f) withTransform({ rotate(response.value * 1.4f, Offset(225f,312f)) }) {
                    plantCrown(isOnion, growth, day, opacity, dry, response.value, trailing)
                }
            }
            if(speciesId !in 1..2) {
                // Learning species use their own silhouette; unknown plants stay generic instead of becoming chili.
                val green=Color(0xFF52714B)
                withTransform({ rotate(response.value*1.4f,Offset(225f,312f)) }) {
                    for(side in listOf(-1,1)) rotate(side*24f,Offset(225f,310f)) {
                        drawOval(green,Offset(if(side<0) 155f else 225f,267f),Size(70f,35f))
                    }
                    svg("M225 310Q244 225 228 164",green,3f)
                    if(speciesId in 3..4) {
                        val center=Offset(228f,164f)
                        repeat(if(speciesId==3) 5 else 8) { i -> rotate(i*(if(speciesId==3) 72f else 45f),center) {
                            drawOval(Color(if(speciesId==3) 0xFFF1DCE5 else 0xFFE6B8C8),Offset(212f,119f),Size(32f,48f))
                        } }
                        drawCircle(Color(0xFFD8B25B),9f,center)
                    } else drawOval(green,Offset(202f,153f),Size(30f,18f))
                }
            }
            if(shell>.001f) drawPath(illustrationPaths.get("M114 316H340L314 435Q226 450 140 435Z"),
                Brush.horizontalGradient(listOf(Color(0xFF9B7D6A).copy(alpha=shell),Soil.copy(alpha=shell),Color(0xFFCEB29C).copy(alpha=shell))))
            svg("M125 443Q226 454 328 442L335 449Q227 467 118 451Z",Color(0xFF9B7D6A))
        }
    }
}

private fun DrawScope.plantCrown(onion: Boolean, growth: Float, day: Int, opacity: Float, dry: Float, response: Float, trailing: Float) {
    val green = Color(0xFF52714B).copy(alpha = opacity)
    val h = 214 * growth
    if (onion) repeat(9) { i ->
        rotate((dry * 5f + response * (1f-i/9f) + trailing * i/9f * 2f) * if (i<4) -1f else 1f, Offset(225f,312f)) {
            svg("M${218+i%3*7} 312Q${190+i*7} ${265-h*.3} ${163+i*16} ${308-h+kotlin.math.abs(4-i)*16}",green,3f+i%3)
        }
    } else {
        svg("M227 311Q217 ${315-h/2} 226 ${310-h}",green,4f)
        val count = min(7,2+day.coerceAtLeast(0)/8)
        repeat(count*2) { i ->
            val tier=i/2; val side=if(i%2==1) 1 else -1
            val y=292-(tier+1)*h/(count+1); val width=(31+(count-tier)*4)*min(1f,growth+.4f)
            val tx=225+side*width; val ty=y-20-i%3*4
            rotate(side * (dry * 7f + response * (1f-tier.toFloat()/count) * 2f + trailing * tier/count * 3f), Offset(225f,y+13)) {
                svg("M225 ${y+13}Q${225+side*18} ${y+8} $tx $ty",green,1.8f)
                svg("M${225+side*12} ${y+5}Q${225+side*22} ${y-31} ${tx+side*20} ${ty-9}Q${tx+side*12} ${y+21} ${225+side*12} ${y+5}",
                    (if(i%3==0) Color(0xFF789367) else Color(0xFF52714B)).copy(alpha = opacity))
                svg("M${225+side*12} ${y+5}L${tx+side*17} ${ty-7}",Color(0xFFA3B383).copy(alpha = opacity),.8f)
            }
        }
        svg("M226 ${310-h}q-14-20-7-25q15 10 7 25",Color(0xFF789367).copy(alpha = opacity))
    }
}
