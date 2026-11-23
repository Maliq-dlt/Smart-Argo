package id.smartagro.app

import android.os.Build
import android.view.HapticFeedbackConstants
import android.view.View
import androidx.compose.animation.core.SpringSpec
import androidx.compose.animation.core.spring
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

val General = FontFamily(Font(R.font.general_regular), Font(R.font.general_medium, FontWeight.Medium), Font(R.font.general_semibold, FontWeight.SemiBold))
val Fraunces = FontFamily(Font(R.font.fraunces_soft))
// Still read by the old illustrations; they leave with A4b.
val Moss = Color(0xFF2F5A3C)
val Sage = Color(0xFFC3DF95)
val Soil = Color(0xFFB99B87)
val Water = Color(0xFF4A7888)

/**
 * Semantic colors in the iOS sense: a grouped canvas, cells on it, and text in three emphasis levels.
 * Values are the Smart Agro "Sage and moss" palette, so the app reads as the same brand as the website
 * while the structure is Apple's. WCAG contrast on cell, light/dark: secondary 6.3/6.7, tint 7.7/8.6, warn 5.0/5.7,
 * water 5.5/7.9; secondary on canvas 5.6/8.0. Tertiary is 3.1/3.4, so it is for glyphs (chevrons) and disabled
 * states only, never for text people must read.
 */
@Immutable data class Palette(
    val dark: Boolean,
    val canvas: Color, val cell: Color, val raised: Color,
    val ink: Color, val secondary: Color, val tertiary: Color,
    val separator: Color, val fill: Color, val pressed: Color,
    val tint: Color, val onTint: Color, val soft: Color, val onSoft: Color,
    val warn: Color, val water: Color, val sun: Color,
    val bar: Color, val barEdge: Color, val shadow: Color,
    /* Measuring language ("garis ukur"): one color per meaning. Ochre = dry or hot, earth = within range, blue = wet or cold;
     * green stays for actions and selection. Status inks are >= 4.5:1 on cell in both appearances. */
    val dryInk: Color, val okInk: Color, val wetInk: Color, val band: Color, val onTint2: Color,
    val pot: Color, val potRim: Color, val soilDry: Color, val soilWet: Color, val leaf: Color, val leaf2: Color, val fruit: Color,
)
private val LightPalette = Palette(false,
    canvas = Color(0xFFECEFE7), cell = Color(0xFFFBFCF9), raised = Color(0xFFFFFFFF),
    ink = Color(0xFF18211B), secondary = Color(0xFF55615A), tertiary = Color(0xFF8A948C),
    separator = Color(0x2418211B), fill = Color(0x1418211B), pressed = Color(0x0F18211B),
    tint = Color(0xFF2F5A3C), onTint = Color(0xFFF6F7F2), soft = Color(0xFFDDEBC6), onSoft = Color(0xFF1C2F12),
    warn = Color(0xFFB84A33), water = Color(0xFF2E6E84), sun = Color(0xFFB8860B),
    bar = Color(0xB8FBFCF9), barEdge = Color(0x66FFFFFF), shadow = Color(0x2E18211B),
    dryInk = Color(0xFF8A5A12), okInk = Color(0xFF5E4631), wetInk = Color(0xFF2E6E84), band = Color(0x212F5A3C), onTint2 = Color(0xD6F6F7F2),
    pot = Color(0xFFC4866A), potRim = Color(0xFFA86C52), soilDry = Color(0xFFDBC69E), soilWet = Color(0xFF4E3B2C),
    leaf = Color(0xFF4D7A3E), leaf2 = Color(0xFF6E9A52), fruit = Color(0xFFC2412F))
private val DarkPalette = Palette(true,
    canvas = Color(0xFF111713), cell = Color(0xFF1F2823), raised = Color(0xFF25302A),
    ink = Color(0xFFE8EDE6), secondary = Color(0xFFA5AFA7), tertiary = Color(0xFF6F7A72),
    separator = Color(0x29E8EDE6), fill = Color(0x1FE8EDE6), pressed = Color(0x14E8EDE6),
    tint = Color(0xFFA6CF8F), onTint = Color(0xFF132016), soft = Color(0xFF2B3823), onSoft = Color(0xFFE4EFCF),
    warn = Color(0xFFE3876C), water = Color(0xFF8CC3D6), sun = Color(0xFFE9C46A),
    bar = Color(0xB31F2823), barEdge = Color(0x1FFFFFFF), shadow = Color(0x66000000),
    dryInk = Color(0xFFE2B467), okInk = Color(0xFFCDB49A), wetInk = Color(0xFF8CC3D6), band = Color(0x26A6CF8F), onTint2 = Color(0xD1132016),
    pot = Color(0xFF9C6A54), potRim = Color(0xFF7E5442), soilDry = Color(0xFFA9946F), soilWet = Color(0xFF3A2C21),
    leaf = Color(0xFF7FAE63), leaf2 = Color(0xFF98C57C), fruit = Color(0xFFE0634E))

/** The HIG text styles (iOS default sizes), in General Sans; Fraunces only for the large and screen titles. */
object T {
    private val trim = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None)
    private fun g(size: Int, line: Int, weight: FontWeight = FontWeight.Normal, track: Double = 0.0) =
        TextStyle(fontFamily = General, fontSize = size.sp, lineHeight = line.sp, fontWeight = weight, letterSpacing = track.em, lineHeightStyle = trim)
    private fun f(size: Int, line: Int, track: Double) =
        TextStyle(fontFamily = Fraunces, fontSize = size.sp, lineHeight = line.sp, letterSpacing = track.em, lineHeightStyle = trim)
    val largeTitle = f(34, 41, -0.02)
    val title1 = f(28, 34, -0.015)
    val title2 = g(22, 28, FontWeight.SemiBold, -0.01)
    val title3 = g(20, 25, FontWeight.SemiBold, -0.005)
    val headline = g(17, 22, FontWeight.SemiBold)
    val body = g(17, 22)
    val callout = g(16, 21)
    val subhead = g(15, 20)
    val footnote = g(13, 18)
    val caption = g(12, 16, FontWeight.Medium)
    /** Big readings (moisture, temperature): numerals people glance at. */
    val figure = g(44, 48, FontWeight.Medium, -0.03)
}

/** Shared critically-damped springs (zero bounce/overshoot for motion comfort). Interruptible by construction. */
object Springs {
    fun <V> snappy(): SpringSpec<V> = spring(dampingRatio = 1f, stiffness = 540f)
    fun <V> smooth(): SpringSpec<V> = spring(dampingRatio = 1f, stiffness = 300f)
    fun <V> bouncy(): SpringSpec<V> = spring(dampingRatio = 1f, stiffness = 420f)
}

/** Haptics that mirror iOS feedback: a tick for selection, confirm/reject for outcomes. Silent when the system turns them off. */
class Haptics(private val view: View) {
    fun tick() { view.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK) }
    fun press() { view.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY) }
    fun success() { view.performHapticFeedback(if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.CONFIRM else HapticFeedbackConstants.VIRTUAL_KEY) }
    fun reject() { view.performHapticFeedback(if (Build.VERSION.SDK_INT >= 30) HapticFeedbackConstants.REJECT else HapticFeedbackConstants.LONG_PRESS) }
}
@Composable fun rememberHaptics(): Haptics { val view = LocalView.current; return remember(view) { Haptics(view) } }

private val LocalPalette = staticCompositionLocalOf { LightPalette }
val palette: Palette @Composable @ReadOnlyComposable get() = LocalPalette.current

/** Phosphor path data as a vector; the tint comes from [androidx.compose.material3.Icon]. */
private val iconCache = HashMap<String, ImageVector>()
fun icon(path: String): ImageVector = iconCache.getOrPut(path) {
    ImageVector.Builder(defaultWidth = 24.dp, defaultHeight = 24.dp, viewportWidth = 256f, viewportHeight = 256f)
        .addPath(PathParser().parsePathString(path).toNodes(), fill = SolidColor(Color.Black)).build()
}

/** Appearance follows the system, as HIG asks; there is no app-level light/dark switch. */
@Composable fun AgroTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val p = if (darkTheme) DarkPalette else LightPalette
    val scheme = if (darkTheme) darkColorScheme(
        primary = p.tint, onPrimary = p.onTint, primaryContainer = p.soft, onPrimaryContainer = p.onSoft,
        secondary = p.secondary, secondaryContainer = p.raised, onSecondaryContainer = p.ink,
        background = p.canvas, onBackground = p.ink, surface = p.cell, onSurface = p.ink,
        surfaceVariant = p.raised, onSurfaceVariant = p.secondary, surfaceContainer = p.cell, surfaceContainerLow = p.cell,
        surfaceContainerHigh = p.raised, surfaceContainerHighest = p.raised, outline = p.tertiary, outlineVariant = p.separator,
        error = p.warn, tertiary = p.water)
    else lightColorScheme(
        primary = p.tint, onPrimary = p.onTint, primaryContainer = p.soft, onPrimaryContainer = p.onSoft,
        secondary = p.secondary, secondaryContainer = p.canvas, onSecondaryContainer = p.ink,
        background = p.canvas, onBackground = p.ink, surface = p.cell, onSurface = p.ink,
        surfaceVariant = p.canvas, onSurfaceVariant = p.secondary, surfaceContainer = p.cell, surfaceContainerLow = p.cell,
        surfaceContainerHigh = p.raised, surfaceContainerHighest = p.raised, outline = p.tertiary, outlineVariant = p.separator,
        error = p.warn, tertiary = p.water)
    CompositionLocalProvider(LocalPalette provides p) {
        MaterialTheme(colorScheme = scheme, typography = Typography(
            displaySmall = T.largeTitle, headlineLarge = T.largeTitle, headlineMedium = T.title1, headlineSmall = T.title2,
            titleLarge = T.title3, titleMedium = T.headline, titleSmall = T.subhead.copy(fontWeight = FontWeight.SemiBold),
            bodyLarge = T.body, bodyMedium = T.subhead, bodySmall = T.footnote,
            labelLarge = T.headline, labelMedium = T.footnote.copy(fontWeight = FontWeight.Medium), labelSmall = T.caption,
        ), content = content)
    }
}
