package id.smartagro.app

import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionLayout
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LocalRippleConfiguration
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat
import dev.chrisbanes.haze.HazeState
import dev.chrisbanes.haze.hazeSource
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

internal const val WEB = "https://smart-agro-demo.pages.dev/"
private val timeFormat = DateTimeFormatter.ofPattern("dd MMM, HH:mm", Locale.forLanguageTag("id-ID")).withZone(ZoneId.systemDefault())
internal fun time(at: Instant?) = at?.let(timeFormat::format) ?: "Belum ada bacaan"
internal fun number(value: Double?) = value?.let { String.format(Locale.forLanguageTag("id-ID"), "%.1f", it) } ?: "\u2014"

class MainActivity : ComponentActivity() {
    private val model: AgroViewModel by viewModels()
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val legacyCodes = java.io.File(cacheDir, "shared/smart-agro-recovery-codes.txt")
        if (legacyCodes.exists()) {
            val uri = androidx.core.content.FileProvider.getUriForFile(this, "$packageName.fileprovider", legacyCodes)
            revokeUriPermission(uri, android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION)
            legacyCodes.delete()
        }
        enableEdgeToEdge()
        setContent { SmartAgroApp(model) }
    }
}

/** How deep a screen sits, so a push slides in from the trailing edge and a pop slides back (iOS navigation stack). */
private fun depth(screen: Screen) = when (screen) {
    Screen.Login -> 0
    Screen.Mfa, Screen.Products, Screen.History, Screen.Account -> 1
    else -> 2
}

private val tabs = listOf(
    TabItem("Tanaman", PhosphorPaths.Plant, PhosphorPaths.PlantFill),
    TabItem("Aktivitas", PhosphorPaths.Notebook, PhosphorPaths.NotebookFill),
    TabItem("Akun", PhosphorPaths.UserCircle, PhosphorPaths.UserCircleFill),
)
private val tabScreens = listOf(Screen.Products, Screen.History, Screen.Account)

@OptIn(ExperimentalMaterial3Api::class, ExperimentalSharedTransitionApi::class)
@Composable
private fun SmartAgroApp(model: AgroViewModel) {
    val state = model.state
    val dark = isSystemInDarkTheme()
    val context = LocalContext.current
    // Screenshots, screen recording and Recents thumbnail are blocked whenever a one-time code,
    // TOTP secret, recovery codes, or sealed claim inputs are on screen.
    val codeOnScreen = state.screen == Screen.Mfa ||
        state.screen == Screen.Rewards ||
        (state.screen == Screen.Login && state.auth in listOf(AuthStep.SignupCode, AuthStep.ResetCode)) ||
        (state.screen == Screen.Security && (state.totpEnrollment != null || !state.generatedRecoveryCodes.isNullOrEmpty())) ||
        (state.screen == Screen.ManageProducts && (state.activeTransfer != null || state.activationChallenge != null))
    DisposableEffect(codeOnScreen) {
        (context as? ComponentActivity)?.run {
            if (codeOnScreen) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE) else window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
            if (Build.VERSION.SDK_INT >= 33) setRecentsScreenshotEnabled(!codeOnScreen)
        }
        onDispose { }
    }
    val view = LocalView.current
    val overMedia = remember { androidx.compose.runtime.mutableStateOf(false) }
    val darkHeroTop = state.introPlaying || (state.screen == Screen.Login && state.auth == AuthStep.Welcome) ||
        (state.screen == Screen.Dashboard && overMedia.value)
    SideEffect {
        (view.context as? android.app.Activity)?.window?.let { window ->
            WindowCompat.getInsetsController(window, view).apply {
                isAppearanceLightStatusBars = !dark && !darkHeroTop
                isAppearanceLightNavigationBars = !dark
            }
        }
    }
    // Google appears only when this build carries a client ID; otherwise the button could only fail.
    val google = if (BuildConfig.GOOGLE_WEB_CLIENT_ID.isBlank()) null else ({ model.googleLogin(context) })
    AgroTheme(dark) {
        val shellHaze = remember { HazeState() }
        val screenState = key(state.email, state.demo) { rememberSaveableStateHolder() }
        val showTabs = state.screen !in listOf(Screen.Login, Screen.Mfa) && !state.introPlaying
        val navInset = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
        CompositionLocalProvider(
            LocalRippleConfiguration provides null,
            LocalShellHaze provides shellHaze,
            LocalStatusOverMedia provides overMedia,
            LocalBottomClearance provides if (showTabs) navInset + 84.dp else navInset,
        ) {
            BackHandler(
                state.screen in listOf(
                    Screen.Dashboard, Screen.Mfa, Screen.History, Screen.Account, Screen.Rewards,
                    Screen.Proofs, Screen.Garden, Screen.Security, Screen.ManageProducts, Screen.Gallery,
                ) || state.screen == Screen.Login && state.auth != AuthStep.Welcome,
            ) { model.back() }
            Surface(Modifier.fillMaxSize(), color = palette.canvas, contentColor = palette.ink) {
                Box(Modifier.fillMaxSize()) {
                    Box(Modifier.fillMaxSize().hazeSource(shellHaze).imePadding()) {
                        SharedTransitionLayout {
                            AnimatedContent(targetState = state.screen, transitionSpec = {
                                val zooming = setOf(initialState, targetState) == setOf(Screen.Products, Screen.Dashboard)
                                val signedOut = setOf(Screen.Login, Screen.Mfa)
                                when {
                                    zooming -> (EnterTransition.None togetherWith ExitTransition.KeepUntilTransitionsFinished).apply {
                                        if (targetState == Screen.Products) targetContentZIndex = -1f
                                    }
                                    (initialState in signedOut) != (targetState in signedOut) -> fadeIn(tween(240)) togetherWith fadeOut(tween(1, delayMillis = 240))
                                    depth(targetState) != depth(initialState) -> stack(depth(targetState) > depth(initialState))
                                    else -> fadeIn(tween(200)) togetherWith fadeOut(tween(1, delayMillis = 200))
                                }
                            }, label = "Layar Smart Agro") { screen ->
                                screenState.SaveableStateProvider(screen.name) {
                                    CompositionLocalProvider(LocalSharedScope provides this@SharedTransitionLayout, LocalNavScope provides this@AnimatedContent) {
                                        when (screen) {
                                            Screen.Login -> AuthFlow(state, model, google)
                                            Screen.Mfa -> MfaPage(state, model)
                                            Screen.Gallery -> ComponentGallery(model::back)
                                            Screen.Products -> PlantsHome(state, model)
                                            Screen.Dashboard -> PlantDetail(state, model)
                                            Screen.Garden -> GardenPlantScreen(state, model)
                                            Screen.History -> ActivityScreen(state, model)
                                            Screen.Account -> AccountScreen(state, model)
                                            Screen.Security -> SecurityScreen(state, model)
                                            Screen.ManageProducts -> ProductsManageScreen(state, model)
                                            Screen.Rewards -> RewardsScreen(
                                                state,
                                                model::loadRewards,
                                                model::reserveReward,
                                                model::cancelReward,
                                                model::restartRewardRequest,
                                                onBack = model::back,
                                                onAppeal = { stmt, winId, redId, done -> model.submitRewardAppeal(stmt, winId, redId, done) },
                                            )
                                            Screen.Proofs -> ProofsScreen(state, model::loadProofs, onBack = model::back)
                                        }
                                    }
                                }
                            }
                        }
                    }
                    if (state.welcome && state.screen == Screen.Products && !state.demo && !state.introPlaying) WelcomeSheet(model::dismissWelcome)
                    // Scroll edge effect (HIG Liquid Glass): content fades under the floating tab bar instead of running into it.
                    if (showTabs) Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(navInset + 96.dp).background(
                        androidx.compose.ui.graphics.Brush.verticalGradient(listOf(androidx.compose.ui.graphics.Color.Transparent, palette.canvas.copy(alpha = .94f)))))
                    if (showTabs) GlassTabBar(
                        tabs,
                        when (state.screen) {
                            Screen.History -> 1
                            Screen.Account, Screen.Rewards, Screen.Proofs, Screen.Security, Screen.ManageProducts, Screen.Gallery -> 2
                            Screen.Products, Screen.Dashboard, Screen.Garden, Screen.Login, Screen.Mfa -> 0
                        },
                        { model.navigate(tabScreens[it]) },
                        Modifier.align(Alignment.BottomCenter),
                    )
                    LiquidGlassRevealOverlay(
                        visible = state.introPlaying,
                        subtitle = if (state.demo) "Menyiapkan mode latihan dan pot contoh…" else "Menyiapkan kebun dan bacaan sensor Anda…",
                        onFinished = model::finishIntro,
                    )
                }
            }
            LaunchedEffect(state.email, state.demo, state.weatherSite, state.screen) {
                if (state.screen in listOf(Screen.Dashboard, Screen.Garden) && (state.demo || state.email.isNotBlank())) model.loadWeather()
            }
            LaunchedEffect(state.selectedUnit?.id, state.screen) {
                if (state.screen == Screen.Dashboard && !state.demo && state.email.isNotBlank() &&
                    (state.explanation == null || state.explanationUnitId != state.selectedUnit?.id)) model.loadExplanation()
            }
            LaunchedEffect(state.selectedUnit?.id, state.screen, state.historyRange, state.historyLoaded) {
                if (state.screen in listOf(Screen.Dashboard, Screen.History) && state.selectedUnit != null && !state.historyLoaded && !state.demo && state.email.isNotBlank()) model.loadHistory()
                if (state.screen in listOf(Screen.Account, Screen.Rewards) && !state.demo && state.email.isNotBlank() && !state.rewardLoaded) model.loadRewards()
                if (state.screen == Screen.Proofs && !state.demo && state.email.isNotBlank() && !state.proofsLoaded) model.loadProofs()
            }
        }
    }
}
