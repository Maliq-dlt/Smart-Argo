package id.smartagro.app

import androidx.compose.animation.AnimatedContent
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
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import dev.chrisbanes.haze.hazeEffect
import dev.chrisbanes.haze.HazeStyle
import dev.chrisbanes.haze.HazeTint
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

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
            boundsTransform = { _, _ -> spring(dampingRatio = .88f, stiffness = 340f, visibilityThreshold = Rect.VisibilityThreshold) },
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
