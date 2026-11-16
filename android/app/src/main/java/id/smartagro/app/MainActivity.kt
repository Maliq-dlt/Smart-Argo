package id.smartagro.app

import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.viewModels
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
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

private const val WEB = "https://smart-agro-demo.pages.dev/"
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
@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun SmartAgroApp(model: AgroViewModel) {
    val state = model.state
    val systemDark = isSystemInDarkTheme()
    val context = androidx.compose.ui.platform.LocalContext.current
    val preferences = remember { context.getSharedPreferences("appearance",0) }
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
    var dark by rememberSaveable { mutableStateOf(preferences.getString("theme",null)?.let { it=="dark" } ?: systemDark) }
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
      CompositionLocalProvider(LocalRippleConfiguration provides null) {
        BackHandler(state.screen in listOf(Screen.Dashboard, Screen.Mfa, Screen.History, Screen.Account, Screen.Rewards, Screen.Proofs, Screen.Garden)) { model.back() }
        Scaffold(containerColor = MaterialTheme.colorScheme.background, bottomBar = {
            if (state.screen !in listOf(Screen.Login,Screen.Mfa)) NavigationBar(containerColor=MaterialTheme.colorScheme.surface) {
                listOf(Screen.Products to "Tanaman",Screen.History to "Aktivitas",Screen.Account to "Akun").forEachIndexed { index,(target,label) ->
                    NavigationBarItem(selected=state.screen==target || target==Screen.Products && state.screen in listOf(Screen.Dashboard,Screen.Garden) || target==Screen.Account && state.screen in listOf(Screen.Rewards,Screen.Proofs),
                        onClick={ model.navigate(target) },label={Text(label)},icon={NavIcon(index,Modifier.size(24.dp))})
                }
            }
        }) { padding ->
            Column(Modifier.fillMaxSize().padding(padding).imePadding(), horizontalAlignment = Alignment.CenterHorizontally) {
                // iOS order: a row of actions (back on the left, the rest on the right), then the title on a line of its own, so the
                // title always has the full width and can wrap at large text sizes instead of being squeezed between buttons.
                Column(Modifier.widthIn(max = 640.dp).fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                    FlowRow(Modifier.fillMaxWidth(), itemVerticalAlignment = Alignment.CenterVertically) {
                        if (state.screen in listOf(Screen.Dashboard,Screen.Mfa,Screen.Rewards,Screen.Proofs,Screen.Garden)) TextButton(onClick = model::back, enabled = state.screen!=Screen.Mfa || !state.busy,
                            modifier = Modifier.semantics { contentDescription = when(state.screen) { Screen.Mfa->"Kembali ke login"; Screen.Rewards,Screen.Proofs->"Kembali ke akun"; else->"Kembali ke produk saya" } }) { Text("\u2039") }
                        Spacer(Modifier.weight(1f))
                        if(state.screen !in listOf(Screen.Login,Screen.Mfa) && !state.demo) TextButton(onClick=model::refreshCurrent,enabled=!state.busy) { Text("Segarkan") }
                        TextButton(onClick = { dark = !dark; preferences.edit().putString("theme",if(dark) "dark" else "light").apply() }) { Text(if (dark) "Mode terang" else "Mode gelap") }
                    }
                    Text("Smart Agro", style = MaterialTheme.typography.titleLarge, modifier = Modifier.semantics { heading() })
                }
                Box(Modifier.fillMaxWidth().height(3.dp)) { if (state.busy) LinearProgressIndicator(Modifier.fillMaxWidth().semantics { contentDescription = "Memuat Smart Agro" }) }
                if (state.demo) Surface(color = MaterialTheme.colorScheme.primaryContainer, modifier = Modifier.fillMaxWidth()) {
                    Text("Mode latihan \u00b7 data sintetis dari skenario web", Modifier.padding(horizontal = 24.dp, vertical = 10.dp), style = MaterialTheme.typography.bodySmall)
                }
                state.message?.let { Notice(it, Modifier.widthIn(max = 600.dp).padding(horizontal = 20.dp, vertical = 6.dp), state.messageIsError) }
                PullToRefreshBox(isRefreshing=state.busy && state.catalogLoaded && !state.demo,
                    onRefresh={ if(!state.busy && !state.demo && state.screen !in listOf(Screen.Login,Screen.Mfa)) model.refreshCurrent() },
                    modifier=Modifier.weight(1f).widthIn(max=640.dp).fillMaxWidth()) {
                  AnimatedContent(targetState=state.screen,transitionSpec={ fadeIn(tween(180)) togetherWith fadeOut(tween(120)) },label="Layar Smart Agro") { screen ->
                    when (screen) {
                        Screen.Login, Screen.Mfa -> LoginScreen(screen==Screen.Mfa,state.busy,state.message!=null,
                            model.config.valid,model::login,model::verify,model::demo, { model.googleLogin(context) })
                        Screen.Products -> ProductsScreen(state,model::openUnit,model::select,model::openGarden)
                        Screen.Dashboard -> DashboardScreen(state,model::refresh,model::renameUnit,model::openUnit)
                        Screen.History -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
                            if (state.selectedUnit==null) { Text("Pilih tanaman terlebih dahulu",style=MaterialTheme.typography.headlineSmall); Text("Aktivitas mengikuti persona tanaman yang dipilih.") }
                            else { Text(state.selectedUnit.name,style=MaterialTheme.typography.headlineMedium); History(state,model::loadHistory,model::loadOlderHistory) }
                        }
                        Screen.Account -> AccountScreen(state,model::loadRewards,model::logout,model::updateName,model::navigate)
                        Screen.Rewards -> RewardsScreen(state,model::loadRewards,model::reserveReward,model::cancelReward,model::restartRewardRequest)
                        Screen.Proofs -> ProofsScreen(state,model::loadProofs)
                        Screen.Garden -> GardenPlantScreen(state,model::openUnit)
                    }
                  }
                }
                LaunchedEffect(state.selectedUnit?.id,state.screen,state.historyLoaded) {
                    if (state.screen in listOf(Screen.Dashboard,Screen.History) && state.selectedUnit!=null && !state.historyLoaded) model.loadHistory()
                    if (state.screen in listOf(Screen.Account,Screen.Rewards) && !state.demo && !state.rewardLoaded) model.loadRewards()
                    if (state.screen==Screen.Proofs && !state.demo && !state.proofsLoaded) model.loadProofs()
                }
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
@Composable private fun ProductsScreen(state: AppState, open: (PlantUnit)->Unit, select: (Product)->Unit, openGarden: (GardenPlant)->Unit) {
    var query by rememberSaveable { mutableStateOf("") }
    var productId by rememberSaveable { mutableStateOf<String?>(null) }
    val uri=rememberSafeUriHandler()
    val visible=state.units.filter { unit ->
        (productId==null || unit.productId==productId) && listOf(unit.name,unit.crop,unitCode(unit,state.units),state.products.find { it.id==unit.productId }?.serial.orEmpty()).any { it.contains(query.trim(),ignoreCase=true) }
    }
    LazyColumn(Modifier.fillMaxSize(),contentPadding=PaddingValues(24.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
        item {
            Text("Tanaman saya",style=MaterialTheme.typography.headlineLarge)
            Text("${state.garden?.plants?.count { it.endedOn == null } ?: 0} tanaman · ${state.products.size} produk",style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
        state.garden?.let { garden ->
            item { Text("Pot & kebun akun",style=MaterialTheme.typography.titleLarge) }
            garden.sites.forEach { site ->
                item(key="site-${site.id}") { Text("${site.name} \u00b7 ${if(site.kind=="garden") "Kebun" else "Pot pribadi"}",style=MaterialTheme.typography.titleMedium) }
                items(garden.plants.filter { it.siteId==site.id && it.endedOn==null },key={"plant-${it.id}"}) { plant ->
                    Card(onClick={openGarden(plant)},modifier=Modifier.pressFeedback(),colors=CardDefaults.cardColors(containerColor=MaterialTheme.colorScheme.surface)) {
                        Column(Modifier.fillMaxWidth().padding(18.dp),verticalArrangement=Arrangement.spacedBy(4.dp)) {
                            Text(plant.name,style=MaterialTheme.typography.titleMedium)
                            Text("${plant.tag} \u00b7 ${plant.crop} \u00b7 ${plant.zone}",style=MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
            if(garden.emptySlots>0) item { Text("${garden.emptySlots} zona belum ditanami.",style=MaterialTheme.typography.bodySmall) }
            if(garden.sites.isEmpty()) item { Text("Belum ada pot atau kebun pada akun. Siapkan melalui website.") }
            item { Text("Unit perangkat terhubung",style=MaterialTheme.typography.titleLarge) }
        }
        item { OutlinedTextField(query,{query=it.take(120)},label={Text("Cari nama, kode, atau produk")},singleLine=true,modifier=Modifier.fillMaxWidth(),shape=RoundedCornerShape(16.dp)) }
        item { Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
            FilterChip(selected=productId==null,onClick={productId=null},label={Text("Semua produk")})
            state.products.forEach { product -> FilterChip(selected=productId==product.id,onClick={productId=product.id},label={Text("${product.label} · ${product.serial}")}) }
        } }
        items(visible,key={it.id}) { unit ->
            Card(onClick={open(unit)},modifier=Modifier.pressFeedback(),shape=RoundedCornerShape(20.dp),colors=CardDefaults.cardColors(containerColor=MaterialTheme.colorScheme.surface)) {
                Row(Modifier.fillMaxWidth().padding(16.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
                    Mascot(Modifier.size(42.dp,54.dp))
                    Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)) {
                        Text(unit.name,style=MaterialTheme.typography.titleMedium)
                        Text("${unit.crop} · ${unitCode(unit,state.units)}",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    Text("›",style=MaterialTheme.typography.titleLarge)
                }
            }
        }
        if (visible.isEmpty() && state.units.isNotEmpty()) item { Text("Tidak ada tanaman yang cocok. Coba nama atau kode lain.") }
        state.products.filter { product -> state.units.none { it.productId==product.id } }.forEach { product -> item(key=product.id) {
            OutlinedButton(onClick={select(product)},enabled=!state.busy) { Text("${product.label} · ${product.serial} · Belum ada tanaman") }
        } }
        if (state.products.isEmpty() && state.garden?.sites.isNullOrEmpty() && state.catalogLoaded && !state.busy) item {
            Text("Belum ada produk terhubung",style=MaterialTheme.typography.headlineSmall)
            TextButton(onClick={uri.openUri(WEB+"#profil")}) { Text("Aktifkan produk di website") }
        }

    }
}
@Composable private fun DashboardScreen(state: AppState, refresh: ()->Unit, rename: (String)->Unit, open: (PlantUnit)->Unit) {
    var editing by rememberSaveable(state.selectedUnit?.id) { mutableStateOf(false) }
    var name by rememberSaveable(state.selectedUnit?.id) { mutableStateOf(state.selectedUnit?.name.orEmpty()) }
    val uri=rememberSafeUriHandler()
    val keyboard=LocalSoftwareKeyboardController.current
    LaunchedEffect(state.selectedUnit?.name) {
        name=state.selectedUnit?.name.orEmpty()
        if(editing) { editing=false;keyboard?.hide() }
    }
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
        if (state.selectedUnit==null) {
            Text("Belum ada unit tanaman",style=MaterialTheme.typography.headlineSmall)
            Text("Atur unit dan penempatan perangkat melalui website, lalu muat ulang.")
            OutlinedButton(onClick=refresh,enabled=!state.busy) { Text("Muat ulang") }
            TextButton(onClick={uri.openUri(WEB+"#profil")}) { Text("Atur unit di website") }
        } else {
            Text(state.selectedUnit.name,style=MaterialTheme.typography.headlineLarge)
            Text("${state.selectedUnit.crop} · ${unitCode(state.selectedUnit,state.units)}",style=MaterialTheme.typography.bodySmall)
            Text(state.selectedProduct?.serial.orEmpty(),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            Column(Modifier.animateContentSize(spring(dampingRatio=1f,stiffness=400f)),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                TextButton(onClick={editing=!editing}) { Text(if(editing) "Batal ubah nama" else "Ubah nama tanaman") }
                if (editing) {
                    OutlinedTextField(name,{name=it.take(120)},label={Text("Nama tanaman")},modifier=Modifier.fillMaxWidth(),singleLine=true)
                    Button(onClick={rename(name)},enabled=!state.busy && name.isNotBlank() && name.trim()!=state.selectedUnit.name) { Text("Simpan nama tanaman") }
                }
            }
            if (state.units.size > 1) LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(state.units,key={it.id}) { unit ->
                    FilterChip(selected=unit.id==state.selectedUnit.id,onClick={open(unit)},
                        modifier=Modifier.semantics { contentDescription="Pilih tanaman ${unitCode(unit,state.units)}" },
                        label={Text("${unitCode(unit,state.units)} · ${unit.name}")})
                }
            }
            Summary(state,refresh)
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
@Composable private fun NavIcon(index: Int, modifier: Modifier) {
    val color = MaterialTheme.colorScheme.onSurface
    Canvas(modifier) {
        val w=size.width; val h=size.height
        when(index) {
            0 -> { drawOval(color, Offset(w*.2f,h*.1f), androidx.compose.ui.geometry.Size(w*.6f,h*.65f), style=Stroke(2.dp.toPx())); drawLine(color,Offset(w*.5f,h*.3f),Offset(w*.5f,h*.9f),2.dp.toPx()) }
            1 -> { val path=Path().apply { moveTo(w*.12f,h*.8f); lineTo(w*.4f,h*.45f); lineTo(w*.65f,h*.6f); lineTo(w*.9f,h*.15f) }; drawPath(path,color,style=Stroke(2.dp.toPx(),cap=StrokeCap.Round)) }
            else -> { drawCircle(color,w*.16f,Offset(w*.5f,h*.25f),style=Stroke(2.dp.toPx())); drawArc(color,180f,180f,false,Offset(w*.16f,h*.5f),androidx.compose.ui.geometry.Size(w*.68f,h*.7f),style=Stroke(2.dp.toPx())) }
        }
    }
}
@Composable private fun Summary(state: AppState, refresh: () -> Unit) {
    var weather by remember(state.selectedProduct?.id) { mutableStateOf<Weather?>(null) }
    val unit = state.selectedUnit ?: return
    val overview = state.overviews.find { it.id == unit.id }
    var now by remember { mutableStateOf(Instant.now()) }
    LaunchedEffect(Unit) { while (true) { delay(30000); now = Instant.now() } }
    val stale = !state.demo && overview?.stale(now) != false
    val revoked = "device_revoked" in overview?.alerts.orEmpty()
    val status = if (state.demo) "Skenario latihan" else if (revoked) "Perangkat dicabut" else if (stale) "Menunggu data terbaru" else stateLabels[overview?.state] ?: "Data perangkat tersimpan"
    val moisture=overview?.readings?.find { it.sensor==Sensor.Moisture && it.quality=="ok" && it.synced }?.takeIf { state.demo || !stale && !revoked && fresh(it.at, now) }?.value
    var cutaway by rememberSaveable { mutableStateOf(true) }
    Card(shape = RoundedCornerShape(28.dp), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
        Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(unit.crop, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            SuggestionChip(onClick = refresh, enabled = !state.busy, label = { Text(status) })
            PlantScene(Modifier.fillMaxWidth().height(210.dp).semantics { contentDescription = "Ilustrasi pot dan akar tanaman; bukan prediksi pertumbuhan" },
                interactive = true, onion = unit.crop.contains("bawang", ignoreCase = true), moisture = moisture, cutaway = cutaway, daylight=weather?.takeUnless { it.stale(now) }?.daylight, cloudy=weather?.takeUnless { it.stale(now) }?.let { it.code!=0 })
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Lihat zona akar", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                Switch(checked = cutaway, onCheckedChange = { cutaway = it }, modifier = Modifier.semantics { contentDescription = "Tampilkan bagian dalam pot" })
            }
            Text("Fase tumbuh ilustratif; sensor tidak mengukur bentuk tanaman.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
    state.demoAdvice[unit.id]?.let { (action, reason) ->
        Surface(shape = RoundedCornerShape(22.dp), color = MaterialTheme.colorScheme.primaryContainer) {
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(action, style = MaterialTheme.typography.titleMedium)
                Text(reason, style = MaterialTheme.typography.bodyMedium)
                Text("Hasil aturan dari skenario web; bukan diagnosis tanaman Anda.", style = MaterialTheme.typography.bodySmall)
            }
        }
    }
    Text("Kondisi zona akar", style = MaterialTheme.typography.headlineSmall)
    var expanded by rememberSaveable(unit.id) { mutableStateOf<Sensor?>(null) }
    Sensor.entries.forEach { sensor ->
        val reading = overview?.readings?.find { it.sensor == sensor }
        val readingStale = !state.demo && (stale || reading == null || !fresh(reading.at, now))
        val label = when { reading == null -> "Belum diukur"; reading.quality == "error" -> "Sensor galat"; reading.quality != "ok" -> "Belum diukur"; revoked -> "Perangkat dicabut"; readingStale -> "Bacaan terakhir \u00b7 data usang"; else -> if (state.demo) "Data sintetis skenario" else "Bacaan tersimpan" }
        val container = when (sensor) { Sensor.Moisture -> MaterialTheme.colorScheme.surfaceVariant; Sensor.Temperature -> MaterialTheme.colorScheme.primaryContainer; Sensor.Ph -> MaterialTheme.colorScheme.surface }
        Surface(onClick={expanded=if(expanded==sensor) null else sensor},shape=RoundedCornerShape(22.dp), color = container) {
            Column(Modifier.fillMaxWidth().animateContentSize(spring(dampingRatio=1f,stiffness=400f)).padding(20.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(sensor.label, style = MaterialTheme.typography.titleMedium)
                Text("${number(reading?.value)} ${sensor.unit}", style = MaterialTheme.typography.headlineMedium)
                Text(label, style = MaterialTheme.typography.bodySmall)
                Text(time(reading?.at), style = MaterialTheme.typography.bodySmall)
                Text(if(expanded==sensor) "Tutup detail" else "Lihat detail",style=MaterialTheme.typography.labelMedium)
                if(expanded==sensor) {
                    if(state.historyLoaded) ReadingChart(state.history,sensor)
                    else Text("Riwayat belum tersedia.",style=MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
    overview?.alerts?.forEach { alert -> Text(alertLabels[alert] ?: "Peringatan baru dari layanan; periksa detail di website.", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }

    WeatherSection("${BuildConfig.SUPABASE_URL}:${state.email}:${state.selectedProduct?.id}") { weather=it }
    Surface(shape=RoundedCornerShape(20.dp),color=MaterialTheme.colorScheme.surface) {
        Row(Modifier.fillMaxWidth().padding(14.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
            Mascot(Modifier.size(56.dp,66.dp).semantics { contentDescription="Maskot kelembapan" },interactive=true,sad=moisture!=null&&moisture<60,happy=moisture!=null&&moisture in 60.0..80.0)
            Column { Text(when { moisture==null->"Menunggu kelembapan terbaru";moisture<60->"Media mulai kering";moisture>80->"Media lebih basah";else->"Media cukup lembap" },style=MaterialTheme.typography.titleSmall)
                Text("Ekspresi kelembapan, bukan diagnosis tanaman.",style=MaterialTheme.typography.bodySmall) }
        }
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
