package id.smartagro.app

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight

val General = FontFamily(Font(R.font.general_regular), Font(R.font.general_medium, FontWeight.Medium), Font(R.font.general_semibold, FontWeight.SemiBold))
val Fraunces = FontFamily(Font(R.font.fraunces_soft))
val Moss = androidx.compose.ui.graphics.Color(0xFF2F5A3C)
val Sage = androidx.compose.ui.graphics.Color(0xFFC3DF95)
val Soil = androidx.compose.ui.graphics.Color(0xFFB99B87)
val Water = androidx.compose.ui.graphics.Color(0xFF4A7888)
private val light = lightColorScheme(
    secondary = androidx.compose.ui.graphics.Color(0xFF4D5E53), onSecondary = androidx.compose.ui.graphics.Color(0xFFF1F5EE),
    secondaryContainer = androidx.compose.ui.graphics.Color(0xFFE4EFCF), onSecondaryContainer = androidx.compose.ui.graphics.Color(0xFF1C2F12),
    tertiary = Water, onTertiary = androidx.compose.ui.graphics.Color.White,
    tertiaryContainer = androidx.compose.ui.graphics.Color(0xFFE1EDF0), onTertiaryContainer = androidx.compose.ui.graphics.Color(0xFF243F49),
    outlineVariant = androidx.compose.ui.graphics.Color(0xFFD1D8CA), surfaceTint = Moss,
    surfaceDim = androidx.compose.ui.graphics.Color(0xFFD9DED2), surfaceBright = androidx.compose.ui.graphics.Color(0xFFFBFCF9),
    surfaceContainerLowest = androidx.compose.ui.graphics.Color(0xFFFBFCF9), surfaceContainerLow = androidx.compose.ui.graphics.Color(0xFFF6F7F2),
    surfaceContainer = androidx.compose.ui.graphics.Color(0xFFECEFE7), surfaceContainerHigh = androidx.compose.ui.graphics.Color(0xFFE9EDE2),
    surfaceContainerHighest = androidx.compose.ui.graphics.Color(0xFFE2E7DA),
    primary = Moss, onPrimary = androidx.compose.ui.graphics.Color(0xFFF6F7F2),
    primaryContainer = Sage, onPrimaryContainer = androidx.compose.ui.graphics.Color(0xFF1C2F12),
    background = androidx.compose.ui.graphics.Color(0xFFECEFE7), onBackground = androidx.compose.ui.graphics.Color(0xFF18211B),
    surface = androidx.compose.ui.graphics.Color(0xFFF6F7F2), onSurface = androidx.compose.ui.graphics.Color(0xFF18211B),
    surfaceVariant = androidx.compose.ui.graphics.Color(0xFFE2E7DA), onSurfaceVariant = androidx.compose.ui.graphics.Color(0xFF55615A),
    error = androidx.compose.ui.graphics.Color(0xFFB84A33), errorContainer = androidx.compose.ui.graphics.Color(0xFFF6E2DB),
    onErrorContainer = androidx.compose.ui.graphics.Color(0xFF682818), outline = androidx.compose.ui.graphics.Color(0xFF78847C),
)
private val dark = darkColorScheme(
    secondary = androidx.compose.ui.graphics.Color(0xFFA8B4AB), onSecondary = androidx.compose.ui.graphics.Color(0xFF161D19),
    secondaryContainer = androidx.compose.ui.graphics.Color(0xFF2E3A33), onSecondaryContainer = androidx.compose.ui.graphics.Color(0xFFE8EDE6),
    tertiary = androidx.compose.ui.graphics.Color(0xFF9EBFCE), onTertiary = androidx.compose.ui.graphics.Color(0xFF142D37),
    tertiaryContainer = androidx.compose.ui.graphics.Color(0xFF233640), onTertiaryContainer = androidx.compose.ui.graphics.Color(0xFFE1EDF0),
    outline = androidx.compose.ui.graphics.Color(0xFF85928A), outlineVariant = androidx.compose.ui.graphics.Color(0xFF3C4840),
    surfaceTint = androidx.compose.ui.graphics.Color(0xFFA6CF8F),
    surfaceDim = androidx.compose.ui.graphics.Color(0xFF131A16), surfaceBright = androidx.compose.ui.graphics.Color(0xFF2E3A33),
    surfaceContainerLowest = androidx.compose.ui.graphics.Color(0xFF0F1411), surfaceContainerLow = androidx.compose.ui.graphics.Color(0xFF1B231E),
    surfaceContainer = androidx.compose.ui.graphics.Color(0xFF1F2823), surfaceContainerHigh = androidx.compose.ui.graphics.Color(0xFF25302A),
    surfaceContainerHighest = androidx.compose.ui.graphics.Color(0xFF2E3A33),
    primary = androidx.compose.ui.graphics.Color(0xFFA6CF8F), onPrimary = androidx.compose.ui.graphics.Color(0xFF132016),
    primaryContainer = androidx.compose.ui.graphics.Color(0xFF2B3823), onPrimaryContainer = androidx.compose.ui.graphics.Color(0xFFE4EFCF),
    background = androidx.compose.ui.graphics.Color(0xFF161D19), onBackground = androidx.compose.ui.graphics.Color(0xFFE8EDE6),
    surface = androidx.compose.ui.graphics.Color(0xFF1F2823), onSurface = androidx.compose.ui.graphics.Color(0xFFE8EDE6),
    surfaceVariant = androidx.compose.ui.graphics.Color(0xFF25302A), onSurfaceVariant = androidx.compose.ui.graphics.Color(0xFFA8B4AB),
    error = androidx.compose.ui.graphics.Color(0xFFEC9079), errorContainer = androidx.compose.ui.graphics.Color(0xFF3D2A25),
)
@Composable fun AgroTheme(darkTheme: Boolean, content: @Composable () -> Unit) {
    val base = Typography()
    MaterialTheme(colorScheme = if (darkTheme) dark else light,
        typography = Typography(
            displaySmall = base.displaySmall.copy(fontFamily = Fraunces),
            headlineLarge = base.headlineLarge.copy(fontFamily = Fraunces),
            headlineMedium = base.headlineMedium.copy(fontFamily = Fraunces),
            headlineSmall = base.headlineSmall.copy(fontFamily = Fraunces),
            titleLarge = base.titleLarge.copy(fontFamily = General, fontWeight = FontWeight.Medium),
            titleSmall = base.titleSmall.copy(fontFamily = General, fontWeight = FontWeight.Medium),
            titleMedium = base.titleMedium.copy(fontFamily = General, fontWeight = FontWeight.Medium),
            bodyLarge = base.bodyLarge.copy(fontFamily = General), bodyMedium = base.bodyMedium.copy(fontFamily = General),
            bodySmall = base.bodySmall.copy(fontFamily = General), labelLarge = base.labelLarge.copy(fontFamily = General),
            labelMedium = base.labelMedium.copy(fontFamily = General), labelSmall = base.labelSmall.copy(fontFamily = General),
        ), content = content)
}
