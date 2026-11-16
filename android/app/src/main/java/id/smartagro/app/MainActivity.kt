package id.smartagro.app

import androidx.compose.animation.core.VisibilityThreshold
import androidx.compose.ui.unit.IntOffset
import dev.chrisbanes.haze.hazeSource
import dev.chrisbanes.haze.HazeState
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.viewModels
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.ExperimentalSharedTransitionApi
import androidx.compose.animation.SharedTransitionLayout
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.animation.core.spring
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.tween
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.input.pointer.pointerInput
import androidx.core.view.WindowCompat
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
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
        enableEdgeToEdge()
        setContent { SmartAgroApp(model) }
    }
}
/** How deep a screen sits, so a push slides in from the trailing edge and a pop slides back (iOS navigation stack). */
private fun depth(screen: Screen) = when (screen) {
    Screen.Login, Screen.Mfa -> 0
    Screen.Products, Screen.History, Screen.Account -> 1
    else -> 2
}
private val tabs = listOf(TabItem("Tanaman", PhosphorPaths.Plant, PhosphorPaths.PlantFill),
    TabItem("Aktivitas", PhosphorPaths.Notebook, PhosphorPaths.NotebookFill),
    TabItem("Akun", PhosphorPaths.UserCircle, PhosphorPaths.UserCircleFill))
private val tabScreens = listOf(Screen.Products, Screen.History, Screen.Account)

@OptIn(ExperimentalMaterial3Api::class, ExperimentalSharedTransitionApi::class)
@Composable private fun SmartAgroApp(model: AgroViewModel) {
    val state = model.state
    val dark = isSystemInDarkTheme()
    val context = androidx.compose.ui.platform.LocalContext.current
    // Screenshots, screen recording and the Recents thumbnail are blocked only where a code is typed or shown (the
    // authenticator step and reward confirmation), so every other screen can be captured and shared.
    val codeOnScreen = state.screen == Screen.Mfa || state.screen == Screen.Rewards
    DisposableEffect(codeOnScreen) {
        (context as? ComponentActivity)?.run {
            if (codeOnScreen) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE) else window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
            if (Build.VERSION.SDK_INT >= 33) setRecentsScreenshotEnabled(!codeOnScreen)
        }
        onDispose { }
    }
    val view = LocalView.current
    SideEffect {
        (view.context as? android.app.Activity)?.window?.let { window ->
            WindowCompat.getInsetsController(window, view).apply {
                isAppearanceLightStatusBars = !dark
                isAppearanceLightNavigationBars = !dark
            }
        }
    }
    AgroTheme(dark) {
      val shellHaze = remember { HazeState() }
      val showTabs = state.screen !in listOf(Screen.Login, Screen.Mfa)
      val navInset = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()
      CompositionLocalProvider(LocalRippleConfiguration provides null, LocalShellHaze provides shellHaze,
          LocalBottomClearance provides if (showTabs) navInset + 84.dp else navInset) {
        BackHandler(state.screen in listOf(Screen.Dashboard, Screen.Mfa, Screen.History, Screen.Account, Screen.Rewards, Screen.Proofs, Screen.Garden, Screen.Gallery)) { model.back() }
        Surface(Modifier.fillMaxSize(), color = palette.canvas, contentColor = palette.ink) { Box(Modifier.fillMaxSize()) {
            Box(Modifier.fillMaxSize().hazeSource(shellHaze).imePadding()) {
              SharedTransitionLayout {
                AnimatedContent(targetState = state.screen, transitionSpec = {
                    val push = spring(dampingRatio = 1f, stiffness = 420f, visibilityThreshold = IntOffset.VisibilityThreshold)
                    val zooming = setOf(initialState, targetState) == setOf(Screen.Products, Screen.Dashboard)
                    when {
                        // The plant screen grows out of its tile and shrinks back into it; the list stays put underneath.
                        zooming -> (EnterTransition.None togetherWith ExitTransition.KeepUntilTransitionsFinished).apply { if (targetState == Screen.Products) targetContentZIndex = -1f }
                        depth(targetState) > depth(initialState) -> (slideInHorizontally(push) { it } togetherWith
                            slideOutHorizontally(push) { -it / 4 } + fadeOut(tween(260), .4f))
                        depth(targetState) < depth(initialState) -> (slideInHorizontally(push) { -it / 4 } + fadeIn(tween(220), .4f) togetherWith
                            slideOutHorizontally(push) { it }).apply { targetContentZIndex = -1f }
                        else -> fadeIn(tween(200)) togetherWith fadeOut(tween(1, delayMillis = 200))
                    }
                }, label = "Layar Smart Agro") { screen ->
                  CompositionLocalProvider(LocalSharedScope provides this@SharedTransitionLayout, LocalNavScope provides this@AnimatedContent) {
                    when (screen) {
                        Screen.Gallery -> ComponentGallery(model::back)
                        Screen.Products -> PlantsHome(state, model)
                        Screen.Dashboard -> PlantDetail(state, model)
                        else -> LegacyFrame(state, screen, model)
                    }
                  }
                }
              }
            }
            if (showTabs) GlassTabBar(tabs, when (state.screen) { Screen.History -> 1; Screen.Account, Screen.Rewards, Screen.Proofs, Screen.Gallery -> 2; else -> 0 },
                { model.navigate(tabScreens[it]) }, Modifier.align(Alignment.BottomCenter))
        } }
        LaunchedEffect(state.email,state.demo,state.weatherSite,state.screen) {
            if(state.screen in listOf(Screen.Dashboard,Screen.Garden)) model.loadWeather()
        }
        LaunchedEffect(state.selectedUnit?.id,state.screen) {
            if(state.screen==Screen.Dashboard && !state.demo) model.loadExplanation()
        }
        LaunchedEffect(state.selectedUnit?.id,state.screen,state.historyLoaded) {
            if (state.screen in listOf(Screen.Dashboard,Screen.History) && state.selectedUnit!=null && !state.historyLoaded) model.loadHistory()
            if (state.screen in listOf(Screen.Account,Screen.Rewards) && !state.demo && !state.rewardLoaded) model.loadRewards()
            if (state.screen==Screen.Proofs && !state.demo && !state.proofsLoaded) model.loadProofs()
        }
      }
    }
}

/** Screens not yet rebuilt on the A3 kit (A4 replaces them one by one): an iOS bar with back and title above the old body. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun LegacyFrame(state: AppState, screen: Screen, model: AgroViewModel) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val title = when (screen) {
        Screen.Login, Screen.Mfa -> ""
        Screen.Products -> "Tanaman"; Screen.History -> "Aktivitas"; Screen.Account -> "Akun"
        Screen.Rewards -> "Reward"; Screen.Proofs -> "Bukti chain"; Screen.Gallery -> "Komponen"
        Screen.Dashboard -> state.selectedUnit?.name ?: "Tanaman"
        Screen.Garden -> state.gardenPlant?.name ?: "Tanaman"
    }
    val back = when (screen) {
        Screen.Mfa -> "Masuk"; Screen.Dashboard, Screen.Garden -> "Tanaman"; Screen.Rewards, Screen.Proofs -> "Akun"
        else -> null
    }
    Column(Modifier.fillMaxSize(), horizontalAlignment = Alignment.CenterHorizontally) {
        if (screen == Screen.Login) Spacer(Modifier.statusBarsPadding())
        else NavBar(title, 0f, titleAlpha = 1f, back = back, onBack = if (back != null && !(screen == Screen.Mfa && state.busy)) model::back else null) {
            if (screen != Screen.Mfa && !state.demo) {
                if (state.busy) Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) { ActivityIndicator() }
                else BarButton(PhosphorPaths.ArrowsClockwise, "Segarkan", model::refreshCurrent)
            }
        }
        if (state.demo) Banner("Mode latihan · data sintetis dari skenario web", Modifier.widthIn(max = 600.dp).padding(horizontal = 16.dp, vertical = 4.dp))
        state.message?.let { Banner(it, Modifier.widthIn(max = 600.dp).padding(horizontal = 16.dp, vertical = 6.dp), state.messageIsError) }
        PullToRefreshBox(isRefreshing=state.busy && state.catalogLoaded && !state.demo,
            onRefresh={ if(!state.busy && !state.demo && screen !in listOf(Screen.Login,Screen.Mfa)) model.refreshCurrent() },
            modifier=Modifier.weight(1f).widthIn(max=640.dp).fillMaxWidth()) {
            Box(Modifier.fillMaxSize().padding(bottom = LocalBottomClearance.current)) {
                when (screen) {
                    Screen.Login, Screen.Mfa -> LoginScreen(screen==Screen.Mfa,state.busy,state.message!=null,
                        model.config.valid,model::login,model::verify,model::demo, { model.googleLogin(context) })
                    Screen.History -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
                        if (state.selectedUnit==null) { Text("Pilih tanaman terlebih dahulu",style=MaterialTheme.typography.headlineSmall); Text("Aktivitas mengikuti persona tanaman yang dipilih.") }
                        else { Text(state.selectedUnit.name,style=MaterialTheme.typography.headlineMedium); History(state,model::loadHistory,model::loadOlderHistory) }
                    }
                    Screen.Account -> AccountScreen(state,model::loadRewards,model::logout,model::updateName,model::navigate)
                    Screen.Rewards -> RewardsScreen(state,model::loadRewards,model::reserveReward,model::cancelReward,model::restartRewardRequest)
                    Screen.Proofs -> ProofsScreen(state,model::loadProofs)
                    Screen.Garden -> GardenPlantScreen(state,model::openUnit,model::loadWeather)
                    Screen.Gallery, Screen.Products, Screen.Dashboard -> Unit
                }
            }
        }
    }
}
@Composable private fun Notice(text: String, modifier: Modifier = Modifier, error: Boolean = true) {
    Surface(modifier.fillMaxWidth().semantics { liveRegion = LiveRegionMode.Polite }, shape = RoundedCornerShape(16.dp), color = if(error) MaterialTheme.colorScheme.errorContainer else MaterialTheme.colorScheme.primaryContainer) {
        Text(text, Modifier.padding(16.dp), color = if(error) MaterialTheme.colorScheme.onErrorContainer else MaterialTheme.colorScheme.onPrimaryContainer, style = MaterialTheme.typography.bodyMedium)
    }
}
@Composable private fun LoginScreen(mfa: Boolean, busy: Boolean, error: Boolean, configured: Boolean,
    login: (String, String) -> Unit, verify: (String) -> Unit, demo: () -> Unit = {}, google: () -> Unit = {}) {
    var email by rememberSaveable { mutableStateOf("") }
    // Password and OTP never enter savedInstanceState, logs, preferences, or source code.
    var secret by remember(mfa) { mutableStateOf("") }
    var secretFocused by remember { mutableStateOf(false) }
    var emailFocused by remember { mutableStateOf(false) }
    val uri = rememberSafeUriHandler()
    val submit = {
        if (mfa) verify(secret) else login(email, secret)
        secret = ""
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 28.dp).padding(bottom = 28.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Spacer(Modifier.height(12.dp))
        Mascot(Modifier.size(142.dp,160.dp), hidden = secretFocused || mfa, gaze = if (emailFocused) email.length / 36f else .2f, sad = error)
        Text(if (secretFocused || mfa) "Rahasia Anda aman. Aku tutup mata." else "Pot kecil, kabar yang berarti.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        Text(if (mfa) "Satu langkah lagi" else "Selamat datang kembali", style = MaterialTheme.typography.headlineLarge, textAlign = TextAlign.Center)
        Text(if (mfa) "Masukkan kode 6 angka dari aplikasi autentikator Anda." else "Satu akun untuk pot, data sensor, dan kebun Anda.",
            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        if (!configured) Notice("Layanan akun belum tersedia pada versi aplikasi ini. Anda tetap bisa mencoba mode latihan.")
        if (!mfa) {
            OutlinedButton(onClick=google,enabled=configured && !busy,modifier=Modifier.fillMaxWidth().heightIn(min=54.dp)) { Text("Masuk dengan Google") }
            Text("atau gunakan email dan kata sandi",style=MaterialTheme.typography.bodySmall)
        }
        if (!mfa) OutlinedTextField(value = email, onValueChange = { if (it.length <= 320) email = it }, label = { Text("Email") },
            modifier = Modifier.fillMaxWidth().onFocusChanged { emailFocused = it.isFocused }, singleLine = true, enabled = !busy,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next), shape = RoundedCornerShape(16.dp))
        OutlinedTextField(value = secret, onValueChange = { next -> secret = if (mfa) next.filter(Char::isDigit).take(6) else next.take(256) },
            label = { Text(if (mfa) "Kode autentikator" else "Kata sandi") },
            visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth().onFocusChanged { secretFocused = it.isFocused },
            singleLine = true, enabled = !busy, shape = RoundedCornerShape(16.dp),
            keyboardOptions = KeyboardOptions(keyboardType = if (mfa) KeyboardType.NumberPassword else KeyboardType.Password, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { if (!busy && configured && secret.isNotEmpty()) submit() }))
        Button(onClick = { submit() }, enabled = configured && !busy && secret.isNotEmpty() && (if (mfa) secret.length == 6 else email.isNotBlank()),
            modifier = Modifier.fillMaxWidth().heightIn(min = 54.dp), shape = RoundedCornerShape(18.dp)) {
            Text(if (busy) "Memeriksa akun\u2026" else if (mfa) "Verifikasi" else "Masuk")
        }
        if (!mfa) {
            TextButton(onClick = { uri.openUri(WEB + "#masuk") }, enabled = !busy) { Text("Daftar atau pulihkan akun di website") }
            OutlinedButton(onClick = demo, enabled = !busy, modifier = Modifier.fillMaxWidth().heightIn(min = 50.dp)) { Text("Coba mode latihan") }
            Text("Gunakan akun yang sama dengan dashboard web.", style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        }
    }
}
@Composable private fun AccountScreen(state: AppState, loadRewards: ()->Unit, logout: ()->Unit, updateName: (String)->Unit, navigate: (Screen)->Unit) {
    val uri=rememberSafeUriHandler()
    var editing by rememberSaveable { mutableStateOf(false) }
    var name by rememberSaveable(state.displayName) { mutableStateOf(state.displayName) }
    LaunchedEffect(state.displayName) { editing=false }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
        Text("Akun",style=MaterialTheme.typography.headlineLarge)
        Text(state.displayName.ifBlank { if(state.demo) "Mode latihan tanpa akun" else state.email.substringBefore('@') },style=MaterialTheme.typography.headlineSmall)
        if (!state.demo) {
            Text(state.email,style=MaterialTheme.typography.bodyMedium)
            Column(Modifier.animateContentSize(spring(dampingRatio=1f,stiffness=400f)),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                TextButton(onClick={editing=!editing;name=state.displayName},enabled=!state.busy) { Text(if(editing) "Batal ubah profil" else "Ubah nama profil") }
                if(editing) {
                    OutlinedTextField(name,{name=it.take(320)},label={Text("Nama profil")},singleLine=true,modifier=Modifier.fillMaxWidth(),enabled=!state.busy)
                    Button(onClick={updateName(name)},enabled=!state.busy && name.isNotBlank() && name!=state.displayName) { Text("Simpan nama profil") }
                }
            }
        }
        Text("${state.products.size} produk · ${state.units.size} persona tanaman",style=MaterialTheme.typography.bodyMedium)
        Surface(shape=RoundedCornerShape(24.dp),color=MaterialTheme.colorScheme.primaryContainer) {
            Column(Modifier.fillMaxWidth().padding(20.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                Text("Poin & reward",style=MaterialTheme.typography.titleLarge)
                val balance=state.rewardBalance
                if (state.demo) Text("Saldo tersedia setelah masuk ke akun. Latihan tidak menghasilkan poin.")
                else if (balance==null) Text(if(state.busy) "Memuat saldo…" else "Saldo belum tersedia. Coba muat ulang.")
                else {
                    Text("${balance.available} poin",style=MaterialTheme.typography.headlineLarge)
                    Text("Terkonfirmasi ${balance.confirmed} · Direservasi ${balance.reserved}",style=MaterialTheme.typography.bodySmall)
                    if (!balance.active) Text("Program reward belum aktif.",style=MaterialTheme.typography.bodySmall)
                }

                TextButton(onClick={navigate(Screen.Rewards)}) { Text("Buka katalog & penukaran") }
                TextButton(onClick={navigate(Screen.Proofs)}) { Text("Bukti blockchain kepemilikan") }
                if (BuildConfig.DEBUG) TextButton(onClick={navigate(Screen.Gallery)}) { Text("Galeri komponen (debug)") }
            }
        }
        Text("Profil & keamanan",style=MaterialTheme.typography.titleLarge)
        listOf("Keamanan akun & autentikator","Produk, aktivasi & kepemilikan","Pemulihan & transfer produk").forEach { label ->
            OutlinedButton(onClick={uri.openUri(WEB+"#profil")},modifier=Modifier.fillMaxWidth()) { Text(label) }
        }
        Text("Pengaturan lengkap dibuka di website. Sesi browser dan aplikasi terpisah.",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        Button(onClick=logout,enabled=!state.busy,modifier=Modifier.fillMaxWidth()) { Text(if(state.demo) "Akhiri latihan" else "Keluar dari aplikasi") }
    }
}
@Composable private fun History(state: AppState, load: () -> Unit, older: () -> Unit) {
    var sensor by rememberSaveable { mutableStateOf(Sensor.Moisture) }
    var days by rememberSaveable { mutableIntStateOf(1) }
    Text("Riwayat sensor", style = MaterialTheme.typography.headlineSmall)
    Text(if (state.demo) "Sampel sintetis dari skenario web, tanpa koneksi perangkat." else "Bacaan perangkat tersimpan. Muat catatan sebelumnya untuk memperluas rentang. Waktu mengikuti zona HP.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
        listOf(1,7).forEach { count -> FilterChip(selected=days==count,onClick={days=count},label={Text(if(count==1) "24 jam" else "7 hari")}) }
    }
    if (!state.demo && !state.historyLoaded) OutlinedButton(onClick = load, enabled = !state.busy) { Text("Muat riwayat") }
    if (state.historyLoaded) {
        Text("Jejak kelembapan otomatis",style=MaterialTheme.typography.titleMedium)
        val events=moistureRises(state.history)
        if(events.isEmpty()) Text("Belum ada kenaikan berarti pada riwayat ini.",style=MaterialTheme.typography.bodySmall)
        events.asReversed().forEach { event -> Text("${time(event.to.at)} · Kelembapan meningkat ${number(event.from.value)} → ${number(event.to.value)} poin",style=MaterialTheme.typography.bodyMedium) }
        Text("Kenaikan dapat mengikuti penyiraman atau hujan. Ambang contoh 5 poin belum dikalibrasi untuk perangkat.",style=MaterialTheme.typography.bodySmall)
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Sensor.entries.forEach { item -> FilterChip(selected = sensor == item, onClick = { sensor = item }, label = { Text(item.label) }) }
        }
        val anchor=if(state.demo) state.history.maxOfOrNull { it.at } ?: Instant.now() else Instant.now()
        val readings = state.history.filter { it.sensor == sensor && !it.at.isBefore(anchor.minusSeconds(days*86400L)) }
        if(state.historyHasMore && !state.demo) OutlinedButton(onClick=older,enabled=!state.busy) { Text("Muat 120 catatan sebelumnya") }
        if(!state.demo) Text("${state.history.size} catatan dimuat; grafik menampilkan rentang pilihan dari data tersebut.",style=MaterialTheme.typography.bodySmall)
        if (readings.isEmpty()) Text("Belum ada bacaan untuk sensor ini.")
        else {
            ReadingChart(readings, sensor)
            readings.forEach { reading ->
                Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surface) {
                    Column(Modifier.fillMaxWidth().padding(16.dp)) {
                        Text("${number(reading.value)} ${sensor.unit}", style = MaterialTheme.typography.titleMedium)
                        Text(time(reading.at), style = MaterialTheme.typography.bodySmall)
                        if (reading.quality != "ok" || !reading.synced) Text(if (!reading.synced) "Jam perangkat belum sinkron" else if (reading.quality == "error") "Sensor galat" else "Belum diukur", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
}
@Composable private fun ReadingChart(readings: List<Reading>, sensor: Sensor) {
    val segments = remember(readings, sensor) { chartSegments(readings,sensor) }
    val points = segments.flatten()
    val range=remember(readings,sensor) { chartRange(readings,sensor) }
    var selected by remember(readings,sensor) { mutableStateOf<Reading?>(null) }
    if (points.isEmpty()) return
    val color = MaterialTheme.colorScheme.primary
    val grid = MaterialTheme.colorScheme.outline.copy(alpha = .3f)
    val first = points.minOf { it.at.epochSecond }; val last = points.maxOf { it.at.epochSecond }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("${number(range.start)}\u2013${number(range.endInclusive)} ${sensor.unit}", style = MaterialTheme.typography.bodySmall)
        selected?.let { Text("${time(it.at)} \u00b7 ${number(it.value)} ${sensor.unit}",style=MaterialTheme.typography.bodyMedium) }
        Canvas(Modifier.fillMaxWidth().height(150.dp).pointerInput(points) {
            awaitPointerEventScope {
                while(true) {
                    val point=awaitPointerEvent().changes.firstOrNull { it.pressed } ?: continue
                    val at=first+(last-first)*(point.position.x/size.width.coerceAtLeast(1)).coerceIn(0f,1f)
                    selected=points.minByOrNull { kotlin.math.abs(it.at.epochSecond-at) }
                }
            }
        }.semantics { contentDescription = "Grafik ${sensor.label}; garis terputus pada data kosong, galat, atau jeda lebih dari satu jam. Nilai lengkap tersedia di daftar berikut." }) {
            repeat(3) { i -> val y=size.height*i/2; drawLine(grid,Offset(0f,y),Offset(size.width,y),1f) }
            fun position(reading: Reading) = Offset(
                if (first == last) size.width/2 else ((reading.at.epochSecond-first).toDouble()/(last-first)*size.width).toFloat(),
                (size.height*(1-(reading.value!!-range.start)/(range.endInclusive-range.start))).toFloat())
            segments.forEach { segment ->
                val path=Path()
                segment.forEachIndexed { index, reading -> val point=position(reading); if(index==0) path.moveTo(point.x,point.y) else path.lineTo(point.x,point.y); drawCircle(color,3.dp.toPx(),point) }
                drawPath(path,color,style=Stroke(2.dp.toPx(),cap=StrokeCap.Round))
            }
        }
        Text("${time(Instant.ofEpochSecond(first))} \u2192 ${time(Instant.ofEpochSecond(last))}", style = MaterialTheme.typography.bodySmall)
    }
}
@Preview(showBackground = true, widthDp = 390, heightDp = 844)
@Composable private fun LoginPreview() { AgroTheme(false) { Surface { LoginScreen(false,false,false,true,{ _, _ -> },{}) } } }
@Preview(showBackground = true, widthDp = 390, heightDp = 844, fontScale = 1.5f)
@Composable private fun LoginLargeTextPreview() { AgroTheme(true) { Surface { LoginScreen(false,false,false,true,{ _, _ -> },{}) } } }
