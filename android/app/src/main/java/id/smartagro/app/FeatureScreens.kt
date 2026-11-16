package id.smartagro.app

import androidx.compose.animation.animateContentSize
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.spring
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.Instant

@Composable internal fun WeatherSection(productId: String, onWeather: (Weather?)->Unit) {
    val context=LocalContext.current
    val preferences=remember { context.getSharedPreferences("weather-cities",0) }
    var place by remember(productId) { mutableStateOf(runCatching { preferences.getString(productId,null)?.let { parsePlace(JSONObject(it)) } }.getOrNull()) }
    var weather by remember(productId) { mutableStateOf<Weather?>(null) }
    var editing by rememberSaveable(productId) { mutableStateOf(false) }
    var query by rememberSaveable(productId) { mutableStateOf("") }
    var results by remember(productId) { mutableStateOf<List<WeatherPlace>?>(null) }
    var busy by remember(productId) { mutableStateOf(false) }
    var message by remember(productId) { mutableStateOf<String?>(null) }
    var reload by remember(productId) { mutableIntStateOf(0) }
    val scope=rememberCoroutineScope()
    val currentCallback by rememberUpdatedState(onWeather)
    LaunchedEffect(productId,place,reload) {
        currentCallback(null)
        val selected=place ?: return@LaunchedEffect
        busy=true; message=null
        try { weather=fetchWeather(selected); currentCallback(weather?.takeUnless { it.stale(Instant.now()) }) }
        catch (error: CancellationException) { throw error }
        catch (_: Exception) { message="Cuaca belum dapat dimuat. Periksa koneksi lalu muat ulang." }
        finally { busy=false }
    }
    Surface(shape=RoundedCornerShape(24.dp),color=MaterialTheme.colorScheme.primaryContainer) {
        Column(Modifier.fillMaxWidth().animateContentSize(spring(dampingRatio=1f,stiffness=400f)).padding(20.dp),verticalArrangement=Arrangement.spacedBy(10.dp)) {
            Text("Cuaca sekitar tanaman",style=MaterialTheme.typography.titleLarge)
            Text(place?.label ?: "Pilih kota tempat produk ini berada.",style=MaterialTheme.typography.bodyMedium)
            weather?.let { WeatherValues(it) }
            if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            message?.let { Text(it,color=MaterialTheme.colorScheme.error) }
            Row(horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                TextButton(onClick={editing=!editing},enabled=!busy) { Text(if(editing) "Tutup pilihan kota" else if(place==null) "Pilih kota cuaca" else "Ubah kota cuaca") }
                if (place!=null) TextButton(onClick={reload++},enabled=!busy) { Text("Muat ulang cuaca") }
            }
            if (editing) {
                OutlinedTextField(query,{query=it.take(80);results=null},label={Text("Nama kota")},singleLine=true,enabled=!busy,modifier=Modifier.fillMaxWidth())
                Button(onClick={
                    busy=true;message=null
                    scope.launch {
                        try { results=searchWeatherPlaces(query) }
                        catch (error: CancellationException) { throw error }
                        catch (_: Exception) { message="Pencarian kota gagal. Periksa koneksi lalu coba lagi." }
                        finally { busy=false }
                    }
                },enabled=!busy && query.trim().length>=2) { Text("Cari kota") }
                if (results?.isEmpty()==true) Text("Kota tidak ditemukan. Coba nama kota terdekat.")
                results?.forEach { result ->
                    OutlinedButton(onClick={
                        place=result;weather=null;editing=false;results=null
                        preferences.edit().putString(productId,result.json().toString()).apply()
                    },enabled=!busy,modifier=Modifier.fillMaxWidth()) { Text(result.label) }
                }
            }
            Text("Prakiraan Open-Meteo untuk kota pilihan. Pilihan kota disimpan di HP ini; tidak memakai GPS.",style=MaterialTheme.typography.bodySmall)
            val uri=rememberSafeUriHandler()
            TextButton(onClick={uri.openUri("https://open-meteo.com/")}) { Text("Sumber cuaca: Open-Meteo · CC BY 4.0") }
        }
    }
}
@Composable internal fun WeatherValues(weather: Weather) {
    Text("${weather.label} · ${if(weather.daylight) "Siang" else "Malam"}",style=MaterialTheme.typography.titleMedium)
    Text("${number(weather.temperature)} °C",style=MaterialTheme.typography.headlineLarge)
    Text("Kelembapan udara ${number(weather.humidity)}% · Angin ${number(weather.wind)} km/jam",style=MaterialTheme.typography.bodySmall)
    Text("Cahaya sekitar (prakiraan)",style=MaterialTheme.typography.titleMedium)
    Text("Radiasi matahari ${number(weather.radiation)} W/m²",style=MaterialTheme.typography.bodyMedium)
    Text("Bukan lux di daun atau bacaan sensor pot. Sensor cahaya belum tersedia pada layanan perangkat.",style=MaterialTheme.typography.bodySmall)
    Text("Prakiraan ${time(weather.at)}${if(weather.stale(Instant.now())) " · Data cuaca usang" else ""}",style=MaterialTheme.typography.bodySmall)
}

@Composable internal fun RewardsScreen(state: AppState, reload: ()->Unit, reserve: (RewardItem,String)->Unit, cancel: (String)->Unit, recover: (String)->Unit = {}) {
    var selected by rememberSaveable { mutableStateOf<String?>(null) }
    var cancellation by rememberSaveable { mutableStateOf<String?>(null) }
    // Never save the authenticator code in savedInstanceState.
    var otp by remember { mutableStateOf("") }
    var ledger by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(state.rewards) { selected=null;cancellation=null;otp="" }
    val data=state.rewards
    LazyColumn(Modifier.fillMaxSize(),contentPadding=PaddingValues(24.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
        item {
            Text("Poin & penukaran",style=MaterialTheme.typography.headlineLarge)
            Text("Poin program berasal dari bukti energi dan kebijakan operator. Poin tidak sama dengan token kripto.")
            if (state.demo) Text("Masuk ke akun untuk melihat katalog dan penukaran. Latihan tidak menghasilkan poin.")
            else if(state.messageIsError) OutlinedButton(onClick=reload,enabled=!state.busy) { Text("Coba muat reward lagi") }
        }
        if (!state.demo && data==null) item { Text(if(state.busy) "Memuat katalog..." else "Katalog belum tersedia. Coba muat ulang.") }
        if (!state.demo && data!=null) {
            item {
                Text("${data.balance.available} poin tersedia",style=MaterialTheme.typography.headlineMedium)
                Text("Terkonfirmasi ${data.balance.confirmed} · Direservasi ${data.balance.reserved}")
                Text(data.policy?.let { "Kebijakan aktif: $it" } ?: "Program reward belum aktif.",style=MaterialTheme.typography.bodySmall)
                Text("Katalog program",style=MaterialTheme.typography.titleLarge)
                if(data.catalog.isEmpty()) Text("Belum ada item yang disediakan operator.")
            }
            items(data.catalog,key={"item-${it.id}"}) { item ->
                Surface(shape=RoundedCornerShape(22.dp),color=MaterialTheme.colorScheme.surface) {
                    Column(Modifier.fillMaxWidth().animateContentSize(spring(dampingRatio=1f,stiffness=400f)).padding(20.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                        Text(item.title,style=MaterialTheme.typography.titleMedium)
                        Text("${item.cost} poin · Stok tersedia ${item.stock-item.reserved}")
                        if(item.availability!="available") Text(if(item.availability=="out_of_stock") "Stok habis" else "Belum tersedia")
                        if(selected==item.id) {
                            Text("Reservasi menahan ${item.cost} poin dan satu stok. Poin didebit setelah operator mencatat realisasi.")
                            OutlinedTextField(otp,{otp=it.filter { c->c in '0'..'9' }.take(6)},label={Text("Kode autentikator jika diminta")},singleLine=true,
                                visualTransformation=PasswordVisualTransformation(),keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.NumberPassword),enabled=!state.busy,modifier=Modifier.fillMaxWidth())
                            Button(onClick={val code=otp;otp="";reserve(item,code)},enabled=!state.busy && state.rewardLoaded && item.canReserve(data.balance)) { Text("Konfirmasi reservasi") }
                            if(state.messageIsError && state.message?.contains("Identitas reservasi")==true) {
                                Text("Periksa penukaran di website. Jika sudah diproses, jangan kirim ulang. Pemulihan membuat permintaan berikutnya menjadi reservasi BARU.")
                                TextButton(onClick={recover(item.id)},enabled=!state.busy) { Text("Saya sudah memeriksa; sisihkan identitas lokal yang rusak") }
                            }
                            TextButton(onClick={selected=null;otp=""},enabled=!state.busy) { Text("Batal pilih reward") }
                        } else OutlinedButton(onClick={selected=item.id;otp=""},enabled=!state.busy && state.rewardLoaded && item.canReserve(data.balance)) { Text("Tukar ${item.title}") }
                    }
                }
            }
            item { Text("Penukaran saya",style=MaterialTheme.typography.titleLarge); if(data.redemptions.isEmpty()) Text("Belum ada penukaran pada akun ini.") }
            items(data.redemptions,key={"redemption-${it.id}"}) { redemption ->
                Surface(shape=RoundedCornerShape(22.dp),color=MaterialTheme.colorScheme.surface) {
                    Column(Modifier.fillMaxWidth().animateContentSize(spring(dampingRatio=1f,stiffness=400f)).padding(20.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                        Text(redemption.title,style=MaterialTheme.typography.titleMedium)
                        Text(redemptionLabels[redemption.status] ?: "Status baru; periksa penukaran di website.")
                        Text("${redemption.points} poin · ${time(redemption.at)}",style=MaterialTheme.typography.bodySmall)
                        redemption.reference?.let { Text("Referensi realisasi: $it") };redemption.reason?.let { Text("Alasan kompensasi: $it") }
                        if(redemption.status=="reserved") {
                            if(cancellation==redemption.id) {
                                Text("Batalkan reservasi ini? Poin yang ditahan dan stok akan dilepas.")
                                Button(onClick={cancel(redemption.id)},enabled=!state.busy && state.rewardLoaded) { Text("Ya, batalkan reservasi") }
                                TextButton(onClick={cancellation=null},enabled=!state.busy) { Text("Pertahankan reservasi") }
                            } else TextButton(onClick={cancellation=redemption.id},enabled=!state.busy && state.rewardLoaded) { Text("Batalkan reservasi") }
                        }
                    }
                }
            }
            item { TextButton(onClick={ledger=!ledger}) { Text(if(ledger) "Tutup riwayat poin" else "Lihat riwayat poin (${data.ledger.size})") } }
            if(ledger) items(data.ledger,key={"ledger-${it.id}"}) { entry ->
                Column(verticalArrangement=Arrangement.spacedBy(4.dp)) {
                    Text("${if(entry.points>0) "+" else ""}${entry.points} poin",style=MaterialTheme.typography.titleMedium)
                    Text(entry.note);Text(time(entry.at),style=MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}
@Composable internal fun ProofsScreen(state: AppState, reload: ()->Unit) {
    val uri=rememberSafeUriHandler()
    LazyColumn(Modifier.fillMaxSize(),contentPadding=PaddingValues(24.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
        item {
            Text("Bukti kepemilikan",style=MaterialTheme.typography.headlineLarge)
            Text("Status aktivasi, transfer, dan pemulihan dari layanan blockchain. Aplikasi menampilkan hasil layanan; bukti ini tidak menjamin kebenaran sensor.")
            if(state.demo) Text("Bukti milik akun tersedia setelah masuk.")
            else if(state.messageIsError) OutlinedButton(onClick=reload,enabled=!state.busy) { Text("Coba muat bukti lagi") }
        }
        if(!state.demo && state.proofs.isEmpty()) item { Text(if(state.proofsLoaded) "Belum ada bukti kepemilikan." else if(state.busy) "Memuat bukti..." else "Bukti belum dimuat. Coba muat ulang.") }
        if(!state.demo) items(state.proofs,key={it.event}) { proof ->
            Surface(shape=RoundedCornerShape(22.dp),color=MaterialTheme.colorScheme.surface) {
                Column(Modifier.fillMaxWidth().padding(20.dp),verticalArrangement=Arrangement.spacedBy(8.dp)) {
                    Text(proof.serial,style=MaterialTheme.typography.titleMedium)
                    Text(if(proof.kind=="ownership_claim") "Aktivasi produk" else "Transfer atau pemulihan")
                    Text(proofLabels[proof.status] ?: "Status baru; bukti belum dapat dipastikan.")
                    Text("SHA-256: ${proof.hash}",style=MaterialTheme.typography.bodySmall)
                    proof.transaction?.let { Text("Transaksi: $it",style=MaterialTheme.typography.bodySmall) }
                    proof.chain?.let { Text("Chain $it${proof.block?.let { block->" · Blok $block" }.orEmpty()}",style=MaterialTheme.typography.bodySmall) }
                    Text(time(proof.confirmedAt ?: proof.at),style=MaterialTheme.typography.bodySmall)
                    proof.explorer?.let { url->TextButton(onClick={uri.openUri(url)}) { Text("Lihat transaksi di explorer") } }
                }
            }
        }
    }
}
