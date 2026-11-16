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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp

@Composable internal fun WeatherSection(site: GardenSite?, weather: WeatherSnapshot?, busy: Boolean, message: String?, reload: ()->Unit) {
    Surface(shape=RoundedCornerShape(24.dp),color=MaterialTheme.colorScheme.primaryContainer) {
        Column(Modifier.fillMaxWidth().animateContentSize(spring(dampingRatio=1f,stiffness=400f)).padding(20.dp),verticalArrangement=Arrangement.spacedBy(10.dp)) {
            Text("Cuaca sekitar tanaman",style=MaterialTheme.typography.titleLarge)
            Text(site?.name ?: "Pilih tanaman dengan lokasi kebun untuk melihat cuaca.",style=MaterialTheme.typography.bodyMedium)
            if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            message?.let { Text(it,color=MaterialTheme.colorScheme.error) }
            weather?.let {
                WeatherValues(it)
                weatherNote(it,site?.placement ?: "indoor")?.let { note -> Text(note,style=MaterialTheme.typography.bodyMedium) }
            }
            if(site!=null) TextButton(onClick=reload,enabled=!busy) { Text("Muat ulang cuaca") }
            Text("Prakiraan Open-Meteo melalui layanan akun, berdasarkan koordinat lokasi kebun yang dibulatkan. Bukan bacaan sensor pot.",style=MaterialTheme.typography.bodySmall)
            Text("Radiasi matahari dan lux tidak tersedia pada layanan cuaca ini.",style=MaterialTheme.typography.bodySmall)
            val uri=rememberSafeUriHandler()
            TextButton(onClick={uri.openUri("https://open-meteo.com/")}) { Text("Sumber cuaca: Open-Meteo · CC BY 4.0") }
        }
    }
}
@Composable internal fun WeatherValues(weather: WeatherSnapshot) {
    Text(weather.label,style=MaterialTheme.typography.titleMedium)
    Text("${number(weather.tempC)} °C",style=MaterialTheme.typography.headlineLarge)
    Text("Kelembapan udara ${number(weather.humidity)}% · Angin ${number(weather.windMs)} m/s",style=MaterialTheme.typography.bodySmall)
    Text("Awan ${number(weather.cloud)}% · Curah hujan ${number(weather.rainMm)} mm",style=MaterialTheme.typography.bodyMedium)
    Text("Prakiraan ${weather.at.replace('T',' ')} · waktu lokasi",style=MaterialTheme.typography.bodySmall)
    weather.forecast.forEach { hour ->
        Text("${hour.inHours} jam lagi · ${hour.condition} · ${number(hour.tempC)} °C · Hujan ${number(hour.rainMm)} mm",style=MaterialTheme.typography.bodySmall)
    }
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
