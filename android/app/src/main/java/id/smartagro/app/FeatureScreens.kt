package id.smartagro.app

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp

/** The forecast over a plant's site, from the account's weather service; never a substitute for the pot's own sensors. */
@Composable
internal fun WeatherSection(site: GardenSite?, weather: WeatherSnapshot?, busy: Boolean, message: String?, reload: () -> Unit) {
    val p = palette
    val uri = rememberSafeUriHandler()
    Panel {
        when {
            site == null -> Text("Pilih tanaman dengan lokasi kebun untuk melihat cuaca.", style = T.body, color = p.secondary)
            weather != null -> {
                WeatherValues(weather)
                weatherNote(weather, site.placement)?.let { Banner(it, Modifier.padding(top = 14.dp)) }
            }
            busy -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                ActivityIndicator(); Text("Memuat prakiraan\u2026", style = T.body, color = p.secondary)
            }
        }
        message?.let { Text(it, style = T.subhead, color = p.warn, modifier = Modifier.padding(top = 8.dp)) }
        Row(Modifier.padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(
                "Sumber cuaca: Open-Meteo \u00b7 CC BY 4.0",
                Modifier.weight(1f).clickable(role = Role.Button) { uri.openUri("https://open-meteo.com/") }.padding(vertical = 12.dp),
                style = T.footnote,
                color = p.tint,
            )
            if (site != null) PlainButton("Muat ulang", reload, enabled = !busy)
        }
    }
}

internal fun conditionIcon(condition: String) = when (condition) {
    "cerah" -> PhosphorPaths.Sun
    "berawan" -> PhosphorPaths.CloudSun
    "mendung" -> PhosphorPaths.Cloud
    "hujan" -> PhosphorPaths.CloudRain
    else -> PhosphorPaths.CloudLightning
}

@Composable
internal fun WeatherValues(weather: WeatherSnapshot) {
    val p = palette
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Icon(icon(conditionIcon(weather.condition)), null, Modifier.size(44.dp), tint = if (weather.condition == "cerah") p.sun else p.water)
        Column {
            Text("${number(weather.tempC)} \u00b0C", style = T.title1, color = p.ink)
            Text(weather.label, style = T.subhead, color = p.secondary)
        }
    }
    Text("Kelembapan udara ${number(weather.humidity)}% \u00b7 Angin ${number(weather.windMs)} m/s", style = T.footnote, color = p.secondary, modifier = Modifier.padding(top = 10.dp))
    if (weather.forecast.isNotEmpty()) Row(Modifier.fillMaxWidth().padding(top = 14.dp)) {
        weather.forecast.forEach { hour ->
            Column(Modifier.weight(1f).semantics(mergeDescendants = true) { }, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("${hour.inHours} j", style = T.footnote, color = p.secondary)
                Icon(icon(conditionIcon(hour.condition)), hour.condition, Modifier.size(22.dp), tint = if (hour.rainMm >= 1.0) p.water else p.secondary)
                Text("${number(hour.tempC)}\u00b0", style = T.subhead, color = p.ink)
            }
        }
    }
    Text("Prakiraan ${weather.at.replace('T', ' ')} \u00b7 waktu lokasi", style = T.footnote, color = p.secondary, modifier = Modifier.padding(top = 12.dp))
}

@Composable
internal fun RewardsScreen(
    state: AppState,
    reload: () -> Unit,
    reserve: (RewardItem, String) -> Unit,
    cancel: (String) -> Unit,
    recover: (String) -> Unit = {},
    onBack: (() -> Unit)? = null,
    onAppeal: ((String, String?, String?, () -> Unit) -> Unit)? = null,
) {
    val p = palette
    var section by rememberSaveable { mutableIntStateOf(0) }
    var selected by rememberSaveable { mutableStateOf<String?>(null) }
    var cancellation by rememberSaveable { mutableStateOf<String?>(null) }
    // Never save authenticator code in savedInstanceState.
    var otp by remember { mutableStateOf("") }
    var ledger by rememberSaveable { mutableStateOf(false) }
    var appealStatement by rememberSaveable { mutableStateOf("") }
    var appealWindowId by rememberSaveable { mutableStateOf<String?>(null) }
    var appealRedemptionId by rememberSaveable { mutableStateOf<String?>(null) }

    LaunchedEffect(state.rewards) { selected = null; cancellation = null; otp = "" }
    val data = state.rewards

    TitledScreen(
        "Poin & penukaran",
        subtitle = "Poin berasal dari bukti energi; bukan token kripto.",
        back = if (onBack != null) "Akun" else null,
        onBack = onBack,
        actions = {
            if (!state.demo) {
                if (state.busy) Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) { ActivityIndicator() }
                else BarButton(PhosphorPaths.ArrowsClockwise, "Segarkan", reload)
            }
        },
    ) {
        notices(state)
        if (state.demo) {
            item(key = "demo-rewards") {
                Panel {
                    Text("Masuk ke akun untuk melihat katalog, energi, dan penukaran. Latihan tidak menghasilkan poin.", style = T.body, color = p.secondary)
                }
            }
        } else {
            item(key = "reward-tabs") {
                Column(Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) {
                    Segmented(listOf("Hadiah", "Energi", "Banding"), section, { section = it })
                }
            }
            when (section) {
                0 -> {
                    if (data == null) {
                        item(key = "rewards-loading") {
                            Panel {
                                Text(if (state.busy) "Memuat katalog…" else "Katalog belum tersedia. Coba muat ulang.", style = T.body, color = p.secondary)
                                if (state.messageIsError) TintedButton("Coba muat reward lagi", reload, Modifier.padding(top = 12.dp).fillMaxWidth(), enabled = !state.busy)
                            }
                        }
                    } else {
                        item(key = "balance") {
                            Panel {
                                Text("${data.balance.available} poin tersedia", style = T.title1, color = p.ink)
                                Text("Terkonfirmasi ${data.balance.confirmed} · Direservasi ${data.balance.reserved}", style = T.subhead, color = p.secondary, modifier = Modifier.padding(top = 4.dp))
                                Text(data.policy?.let { "Kebijakan aktif: $it" } ?: "Program reward belum aktif.", style = T.footnote, color = p.secondary, modifier = Modifier.padding(top = 6.dp))
                            }
                        }
                        item(key = "catalog-title") {
                            SectionTitle("Katalog program")
                            if (data.catalog.isEmpty()) Footnote("Belum ada item yang disediakan operator.")
                        }
                        items(data.catalog, key = { "item-${it.id}" }) { item ->
                            Panel(Modifier.padding(bottom = 10.dp).animateContentSize(Springs.smooth())) {
                                Text(item.title, style = T.headline, color = p.ink)
                                val freeStock = item.stock - item.reserved
                                val units = minOf(freeStock, data.balance.available / item.cost)
                                Text("${item.cost} token = 1 ${item.title}", style = T.subhead, color = p.ink)
                                Text("Stok tersedia $freeStock", style = T.subhead, color = p.secondary)
                                val quote = when {
                                    item.availability != "available" || freeStock == 0L -> "Belum dapat dipesan."
                                    units == 0L -> "Perlu ${item.cost-data.balance.available} token lagi untuk 1 unit."
                                    else -> "Saldo dan stok cukup untuk $units unit. Sisa setelah reservasi 1 unit: ${data.balance.available-item.cost} token."
                                }
                                Text(quote, style = T.subhead, color = p.secondary, modifier = Modifier.padding(top = 2.dp))
                                if (item.availability != "available") {
                                    Text(if (item.availability == "out_of_stock") "Stok habis" else "Belum tersedia", style = T.footnote, color = p.warn, modifier = Modifier.padding(top = 4.dp))
                                }
                                Spacer(Modifier.height(10.dp))
                                if (selected == item.id) {
                                    Text("Reservasi menahan ${item.cost} poin dan satu stok. Poin didebit setelah operator mencatat realisasi.", style = T.subhead, color = p.secondary)
                                    Spacer(Modifier.height(8.dp))
                                    Group(Modifier.padding(horizontal = 0.dp)) {
                                        FieldRow(
                                            "Kode OTP",
                                            otp,
                                            { otp = it.filter { c -> c in '0'..'9' }.take(6) },
                                            "Kode autentikator jika diminta",
                                            secure = true,
                                            keyboard = KeyboardType.NumberPassword,
                                            ime = ImeAction.Done,
                                            enabled = !state.busy,
                                        )
                                    }
                                    PrimaryButton(
                                        "Konfirmasi reservasi",
                                        { val code = otp; otp = ""; reserve(item, code) },
                                        Modifier.padding(top = 10.dp).fillMaxWidth(),
                                        enabled = !state.busy && state.rewardLoaded && item.canReserve(data.balance),
                                        busy = state.busy,
                                    )
                                    if (state.messageIsError && state.message?.contains("Identitas reservasi") == true) {
                                        Text("Periksa penukaran di website. Jika sudah diproses, jangan kirim ulang.", style = T.footnote, color = p.warn, modifier = Modifier.padding(top = 6.dp))
                                        PlainButton("Saya sudah memeriksa; sisihkan identitas lokal yang rusak", { recover(item.id) }, enabled = !state.busy)
                                    }
                                    PlainButton("Batal pilih reward", { selected = null; otp = "" }, enabled = !state.busy)
                                } else {
                                    TintedButton(
                                        "Tukar ${item.title}",
                                        { selected = item.id; otp = "" },
                                        Modifier.fillMaxWidth(),
                                        enabled = !state.busy && state.rewardLoaded && item.canReserve(data.balance),
                                    )
                                }
                            }
                        }
                        item(key = "redemptions-title") {
                            SectionTitle("Penukaran saya")
                            if (data.redemptions.isEmpty()) Footnote("Belum ada penukaran pada akun ini.")
                        }
                        items(data.redemptions, key = { "redemption-${it.id}" }) { redemption ->
                            Panel(Modifier.padding(bottom = 10.dp).animateContentSize(Springs.smooth())) {
                                Text(redemption.title, style = T.headline, color = p.ink)
                                Text(redemptionLabels[redemption.status] ?: "Status baru; periksa penukaran di website.", style = T.subhead, color = p.tint)
                                Text("${redemption.points} poin · ${time(redemption.at)}", style = T.footnote, color = p.secondary, modifier = Modifier.padding(top = 2.dp))
                                redemption.reference?.let { Text("Referensi realisasi: $it", style = T.footnote, color = p.secondary) }
                                redemption.reason?.let { Text("Alasan kompensasi: $it", style = T.footnote, color = p.secondary) }
                                if (redemption.status == "reserved") {
                                    if (cancellation == redemption.id) {
                                        Text("Batalkan reservasi ini? Poin yang ditahan dan stok akan dilepas.", style = T.subhead, color = p.warn, modifier = Modifier.padding(top = 8.dp))
                                        Column(Modifier.padding(top = 8.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                            PrimaryButton("Ya, batalkan reservasi", { cancel(redemption.id) }, Modifier.fillMaxWidth(), destructive = true, enabled = !state.busy && state.rewardLoaded)
                                            PlainButton("Pertahankan reservasi", { cancellation = null }, enabled = !state.busy)
                                        }
                                    } else {
                                        PlainButton("Batalkan reservasi", { cancellation = redemption.id }, enabled = !state.busy && state.rewardLoaded, destructive = true)
                                    }
                                } else if (onAppeal != null) {
                                    PlainButton("Ajukan peninjauan", { appealRedemptionId = redemption.id; appealWindowId = null; section = 2 })
                                }
                            }
                        }
                        item(key = "ledger-toggle") {
                            Box(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp)) {
                                PlainButton(if (ledger) "Tutup riwayat poin" else "Lihat riwayat poin (${data.ledger.size})", { ledger = !ledger })
                            }
                        }
                        if (ledger) {
                            items(data.ledger, key = { "ledger-${it.id}" }) { entry ->
                                Panel(Modifier.padding(bottom = 8.dp)) {
                                    Text("${if (entry.points > 0) "+" else ""}${entry.points} poin", style = T.headline, color = p.ink)
                                    Text(entry.note, style = T.body, color = p.secondary, modifier = Modifier.padding(top = 2.dp))
                                    Text(time(entry.at), style = T.footnote, color = p.secondary, modifier = Modifier.padding(top = 2.dp))
                                }
                            }
                        }
                    }
                }
                1 -> {
                    val ev = state.energyEvidence
                    if (ev == null) {
                        item(key = "energy-loading") { Footnote("Memuat bukti energi dan meter perangkat…") }
                    } else {
                        item(key = "meters-title") { SectionTitle("Meter terkalibrasi (${ev.meters.size})") }
                        if (ev.meters.isEmpty()) item(key = "meters-empty") { Footnote("Belum ada meter energi yang terdaftar pada akun.") }
                        else item(key = "meters") {
                            Group {
                                ev.meters.forEach { m ->
                                    Cell(
                                        "Perangkat ${m.deviceId.take(8)}",
                                        subtitle = "Kalibrasi: ${m.calibrationReference} · Maks ${number(m.maxPowerW)} W",
                                        value = m.status,
                                        chevron = false,
                                    )
                                }
                            }
                        }
                        item(key = "windows-title") { SectionTitle("Jendela energi 15 menit (${ev.windows.size})") }
                        if (ev.windows.isEmpty()) item(key = "windows-empty") { Footnote("Belum ada jendela energi terverifikasi.") }
                        else items(ev.windows, key = { it.id }) { w ->
                            Panel(Modifier.padding(bottom = 8.dp)) {
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                    Text("${number(w.solarHarvestWh)} Wh panen · ${number(w.loadWh)} Wh beban", style = T.headline, color = p.ink)
                                    Text("+${w.creditedPoints} poin", style = T.headline, color = p.tint)
                                }
                                Text("${time(w.startAt)} · ${w.rewardReason ?: "terverifikasi"}", style = T.footnote, color = p.secondary, modifier = Modifier.padding(top = 2.dp))
                                if (onAppeal != null) {
                                    PlainButton("Ajukan banding jendela ini", { appealWindowId = w.id; appealRedemptionId = null; section = 2 })
                                }
                            }
                        }
                    }
                }
                else -> {
                    if (onAppeal != null) {
                        item(key = "appeal-form") {
                            val fallbackWindow = state.energyEvidence?.windows?.firstOrNull()?.id
                            val fallbackRedemption = data?.redemptions?.firstOrNull()?.id
                            val targetWin = appealWindowId ?: if (appealRedemptionId == null) fallbackWindow else null
                            val targetRed = appealRedemptionId ?: if (targetWin == null) fallbackRedemption else null
                            SectionTitle("Ajukan peninjauan")
                            Group(footer = "Pilih satu bukti energi atau penukaran lalu tulis penjelasan.") {
                                Cell(
                                    "Subjek banding",
                                    value = when {
                                        targetWin != null -> "Energi ${targetWin.take(8)}"
                                        targetRed != null -> "Penukaran ${targetRed.take(8)}"
                                        else -> "Belum ada bukti"
                                    },
                                    chevron = false,
                                )
                                FieldRow("Alasan", appealStatement, { appealStatement = it.take(1000) }, "Jelaskan selisih atau kendala", singleLine = false, ime = ImeAction.Done)
                            }
                            PrimaryButton(
                                "Kirim permohonan banding",
                                {
                                    onAppeal(appealStatement, targetWin, targetRed) {
                                        appealStatement = ""
                                        appealWindowId = null
                                        appealRedemptionId = null
                                    }
                                },
                                Modifier.padding(16.dp).fillMaxWidth(),
                                enabled = !state.busy && appealStatement.trim().length >= 5 && ((targetWin != null) xor (targetRed != null)),
                                busy = state.busy,
                            )
                        }
                    }
                    item(key = "cases-title") { SectionTitle("Kasus & anomali (${state.rewardCases.size})") }
                    if (state.rewardCases.isEmpty()) item(key = "appeals-empty") { Footnote("Belum ada kasus peninjauan reward.") }
                    else items(state.rewardCases, key = { it.id }) { c ->
                        Panel(Modifier.padding(bottom = 8.dp)) {
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                Text(if (c.kind == "appeal") "Banding" else "Anomali", style = T.headline, color = p.ink)
                                Text(c.status, style = T.subhead, color = p.tint)
                            }
                            c.statement?.let { Text(it, style = T.body, color = p.secondary, modifier = Modifier.padding(top = 4.dp)) }
                            c.decisionReason?.let { Text("Keputusan: $it", style = T.footnote, color = p.ink, modifier = Modifier.padding(top = 4.dp)) }
                            Text(time(c.createdAt), style = T.footnote, color = p.secondary, modifier = Modifier.padding(top = 4.dp))
                        }
                    }
                }
            }
        }
    }
}

@Composable
internal fun ProofsScreen(state: AppState, reload: () -> Unit, onBack: (() -> Unit)? = null) {
    val p = palette
    val uri = rememberSafeUriHandler()
    TitledScreen(
        "Bukti kepemilikan",
        subtitle = "Status aktivasi, transfer, dan pemulihan dari layanan chain.",
        back = if (onBack != null) "Akun" else null,
        onBack = onBack,
        actions = {
            if (!state.demo) {
                if (state.busy) Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) { ActivityIndicator() }
                else BarButton(PhosphorPaths.ArrowsClockwise, "Segarkan", reload)
            }
        },
    ) {
        notices(state)
        if (state.demo) {
            item(key = "demo-proofs") {
                Panel { Text("Bukti milik akun tersedia setelah masuk.", style = T.body, color = p.secondary) }
            }
        } else if (state.proofs.isEmpty()) {
            item(key = "empty-proofs") {
                Panel {
                    Text(
                        if (state.proofsLoaded) "Belum ada bukti kepemilikan."
                        else if (state.busy) "Memuat bukti…"
                        else "Bukti belum dimuat. Coba muat ulang.",
                        style = T.body,
                        color = p.secondary,
                    )
                    if (state.messageIsError) TintedButton("Coba muat bukti lagi", reload, Modifier.padding(top = 12.dp).fillMaxWidth(), enabled = !state.busy)
                }
            }
        } else {
            items(state.proofs, key = { it.event }) { proof ->
                Panel(Modifier.padding(bottom = 10.dp)) {
                    Text(proof.serial, style = T.headline, color = p.ink)
                    Text(if (proof.kind == "ownership_claim") "Aktivasi produk" else "Transfer atau pemulihan", style = T.subhead, color = p.secondary)
                    Text(proofLabels[proof.status] ?: "Status baru; bukti belum dapat dipastikan.", style = T.body, color = if (proof.status == "confirmed") p.tint else p.warn, modifier = Modifier.padding(top = 6.dp))
                    Text("SHA-256: ${proof.hash}", style = T.footnote, color = p.secondary, modifier = Modifier.padding(top = 4.dp))
                    proof.transaction?.let { Text("Transaksi: $it", style = T.footnote, color = p.secondary) }
                    proof.chain?.let { Text("Chain $it${proof.block?.let { block -> " · Blok $block" }.orEmpty()}", style = T.footnote, color = p.secondary) }
                    Text(time(proof.confirmedAt ?: proof.at), style = T.footnote, color = p.secondary, modifier = Modifier.padding(top = 2.dp))
                    proof.explorer?.let { url ->
                        PlainButton("Lihat transaksi di explorer", { uri.openUri(url) }, Modifier.padding(top = 4.dp), path = PhosphorPaths.ArrowUpRight)
                    }
                }
            }
        }
    }
}
