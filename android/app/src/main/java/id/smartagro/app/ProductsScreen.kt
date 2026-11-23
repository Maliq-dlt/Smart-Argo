package id.smartagro.app

import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp

@Composable
internal fun ProductsManageScreen(state: AppState, model: AgroViewModel, initialSerial: String? = null, onSerialUsed: () -> Unit = {}) {
    var deviceSetupOpen by remember { mutableStateOf(false) }
    if (deviceSetupOpen) DeviceSetupSheet { deviceSetupOpen = false }
    val p = palette
    val context = LocalContext.current
    val now = rememberNow()
    var tab by rememberSaveable { mutableIntStateOf(if (state.products.isEmpty()) 1 else 0) }
    var setupDeviceId by rememberSaveable { mutableStateOf<String?>(null) }
    var serialInput by rememberSaveable { mutableStateOf("") }
    var scanWarning by rememberSaveable { mutableStateOf<String?>(null) }
    var sealedCode by remember { mutableStateOf("") }
    var signature by remember { mutableStateOf("") }
    var transferInSerial by rememberSaveable { mutableStateOf("") }
    var transferInCode by remember { mutableStateOf("") }
    var recoverySerial by rememberSaveable { mutableStateOf("") }
    var recoveryStatement by rememberSaveable { mutableStateOf("") }
    var recoveryEvidenceRef by rememberSaveable { mutableStateOf("") }
    var renamingUnit by remember { mutableStateOf<PlantUnit?>(null) }
    var archivingUnit by remember { mutableStateOf<PlantUnit?>(null) }
    var placing by remember { mutableStateOf<Pair<OwnedDevice, PlantUnit>?>(null) }
    var pendingCameraUri by rememberSaveable { mutableStateOf<Uri?>(null) }

    fun handleQrString(raw: String) {
        val parsed = runCatching { parseProductScan(raw) }.getOrNull()
        if (parsed == null) {
            scanWarning = "QR tidak memuat nomor seri Smart Agro yang valid."
        } else {
            serialInput = parsed.serial
            scanWarning = if (parsed.hasExtraParameters) "Parameter tambahan pada tautan QR diabaikan demi keamanan; hanya nomor seri yang dipakai." else null
            model.checkPublicProduct(parsed.serial)
        }
    }

    val cameraLauncher = rememberLauncherForActivityResult(ActivityResultContracts.TakePicture()) { ok ->
        val uri = pendingCameraUri
        pendingCameraUri = null
        if (ok && uri != null) {
            val decoded = decodeQrFromUri(context, uri)
            if (decoded != null) handleQrString(decoded)
            else scanWarning = "QR tidak terbaca pada foto. Pastikan fokus dan cahaya cukup, atau ketik nomor seri."
        }
    }
    val photoLauncher = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) {
            val decoded = decodeQrFromUri(context, uri)
            if (decoded != null) handleQrString(decoded)
            else scanWarning = "QR tidak ditemukan pada gambar tersebut."
        }
    }
    fun photographQr() {
        try {
            val target = tempCameraQrUri(context)
            pendingCameraUri = target
            cameraLauncher.launch(target)
        } catch (_: android.content.ActivityNotFoundException) {
            pendingCameraUri = null
            scanWarning = "Aplikasi kamera tidak tersedia. Pilih foto QR atau isi nomor seri."
        } catch (_: SecurityException) {
            pendingCameraUri = null
            scanWarning = "Kamera tidak dapat dibuka. Pilih foto QR atau isi nomor seri."
        }
    }
    // Google's scanner reads the code live and needs no camera permission. Without Google Play services or its scanner
    // module (first use downloads it), the photo route below still works.
    fun scanQr() {
        val scanner = runCatching {
            GmsBarcodeScanning.getClient(context, GmsBarcodeScannerOptions.Builder()
                .setBarcodeFormats(Barcode.FORMAT_QR_CODE).enableAutoZoom().build())
        }.getOrNull() ?: return photographQr()
        scanner.startScan()
            .addOnSuccessListener { code -> code.rawValue?.let(::handleQrString) ?: run { scanWarning = "QR tidak memuat teks." } }
            .addOnFailureListener { photographQr() }
    }

    LaunchedEffect(initialSerial) {
        // A packaging link fills the form once; opening Produk later must not jump back to it.
        initialSerial?.let { serialInput = it; tab = 1; if (!state.demo) model.checkPublicProduct(it); onSerialUsed() }
    }

    LaunchedEffect(tab, state.demo, state.email, state.recoveriesLoaded, state.busy) {
        if (tab == 2 && !state.demo && state.email.isNotBlank() && !state.recoveriesLoaded && !state.busy) {
            model.loadRecoveries()
        }
    }

    TitledScreen(
        "Produk & kepemilikan",
        subtitle = "${state.products.size} produk · ${state.units.size} unit aktif",
        back = "Akun",
        onBack = model::back,
        actions = { RefreshAction(state, model) },
    ) {
        notices(state)
        if (!state.demo) item(key = "device-wifi-setup") {
            Group { Cell("Siapkan Wi-Fi & kalibrasi", subtitle = "Sambung ke jaringan alat pada label", onClick = { deviceSetupOpen = true }) }
        }
        item(key = "product-tabs") {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) {
                Segmented(listOf("Unit", "QR", "Transfer"), tab, { tab = it })
            }
        }
        when (tab) {
            0 -> {
                item(key = "active-units-title") {
                    SectionTitle("Unit aktif (${state.units.size})")
                    if (!state.demo && state.units.isNotEmpty()) {
                        Footnote("Pasang perangkat setelah bacaan pertamanya masuk. Untuk pindah pot, pasang di unit baru; perangkat tidak perlu di-flash ulang.")
                    }
                }
                if (state.units.isEmpty()) {
                    item { Footnote("Belum ada unit aktif. Klaim produk terlebih dahulu atau pulihkan arsip.") }
                } else {
                    state.units.forEach { u ->
                        val devs = state.devices.filter { it.productId == u.productId }
                        val evs = state.unitEvents[u.id]
                        item(key = "manage-${u.id}") {
                            Panel(Modifier.padding(bottom = 10.dp)) {
                                Text(u.name, style = T.title3, color = p.ink)
                                Text("${u.crop} · ${state.plantCode(u)}", style = T.subhead, color = p.secondary)
                                Spacer(Modifier.height(10.dp))
                                Group(Modifier.padding(horizontal = 0.dp)) {
                                    Cell("Ubah nama", glyph = PhosphorPaths.PencilSimple, glyphColor = p.tint, enabled = !state.busy, onClick = { renamingUnit = u })
                                    devs.forEach { d ->
                                        val placedHere = d.unitId == u.id
                                        Cell(
                                            "Perangkat ${d.id.take(8)}",
                                            subtitle = when {
                                                placedHere -> "Terpasang pada unit ini"
                                                d.unitId != null -> "Terpasang di unit lain"
                                                else -> "Belum terpasang"
                                            },
                                            glyph = PhosphorPaths.Package,
                                            glyphColor = p.secondary,
                                            chevron = false,
                                        )
                                        if (!placedHere && d.status == "active" && !state.demo) {
                                            Cell(
                                                if (d.unitId == null) "Verifikasi & pasang" else "Pindahkan ke sini",
                                                subtitle = "Bacaan berikutnya tercatat di ${u.name}",
                                                enabled = !state.busy,
                                                onClick = { placing = d to u },
                                            )
                                        }
                                        if (placedHere && d.status == "active" && !state.demo) {
                                            val expanded = setupDeviceId == d.id
                                            Cell(
                                                if (expanded) "Tutup pemeriksaan" else "Periksa pemasangan",
                                                subtitle = if (expanded) null else "Cek bacaan di ${u.name}",
                                                glyph = PhosphorPaths.DropFill,
                                                enabled = !state.busy,
                                                onClick = {
                                                    setupDeviceId = if (expanded) null else d.id
                                                    if (!expanded) model.checkDeviceSetup(d)
                                                },
                                            )
                                            if (expanded) {
                                                val setup = state.deviceSetupReadings?.takeIf { it.device == d }
                                                Sensor.entries.forEach { sensor ->
                                                    val sample = setup?.readings?.firstOrNull { it.sensor == sensor }
                                                    val status = sensorStatus(sample, now, stale = false, revoked = false)
                                                    Cell(
                                                        sensor.label,
                                                        value = sample?.value?.takeIf { status == SensorStatus.Ready }?.let { reading(sensor, it) },
                                                        subtitle = when {
                                                            sample != null -> "${status.label} · Diukur ${time(sample.at)}"
                                                            state.busy -> "Memeriksa…"
                                                            setup == null -> "Belum diperiksa"
                                                            else -> "Belum ada bacaan setelah penempatan dalam 24 jam terakhir"
                                                        },
                                                        chevron = false,
                                                    )
                                                }
                                                Cell("Segarkan bacaan probe", enabled = !state.busy, onClick = { model.checkDeviceSetup(d) })
                                            }
                                        }
                                    }
                                    Cell("Riwayat aktivitas unit", glyph = PhosphorPaths.ClockCounterClockwise, glyphColor = p.secondary, enabled = !state.busy, onClick = { model.loadUnitLifecycleEvents(u.id) })
                                    val hasPlacement = devs.any { it.unitId == u.id }
                                    Cell(
                                        "Arsipkan unit",
                                        subtitle = if (hasPlacement) "Perangkat di unit ini ikut dilepas." else null,
                                        glyph = PhosphorPaths.Archive, glyphColor = p.warn, destructive = true,
                                        enabled = !state.busy, onClick = { archivingUnit = u },
                                    )
                                }
                                evs?.let { events ->
                                    Spacer(Modifier.height(8.dp))
                                    events.take(8).forEach { ev ->
                                        Text("• ${ev.action.replace('_', ' ')} (${time(ev.createdAt)})", style = T.footnote, color = p.secondary)
                                    }
                                }
                            }
                        }
                    }
                }
                if (state.archivedUnits.isNotEmpty()) {
                    item(key = "archived-title") { SectionTitle("Unit diarsipkan (${state.archivedUnits.size})") }
                    item(key = "archived-list") {
                        Group {
                            state.archivedUnits.forEach { u ->
                                Cell(
                                    u.name,
                                    subtitle = "${u.crop} · diarsipkan",
                                    trailing = { PlainButton("Pulihkan", { model.restoreUnit(u.id) }, enabled = !state.busy) },
                                    chevron = false,
                                )
                            }
                        }
                    }
                }
            }
            1 -> {
                item(key = "qr-scan") {
                    SectionTitle("Pindai QR atau cek nomor seri")
                    Footnote("Gunakan QR kemasan untuk klaim produk. Setelah diklaim, tempatkan perangkat di tab Unit.")
                    scanWarning?.let { Banner(it, Modifier.padding(horizontal = 16.dp, vertical = 4.dp), error = true) }
                    Group {
                        FieldRow("Nomor seri", serialInput, { serialInput = it.take(120) }, "SA-...", keyboard = KeyboardType.Ascii, capitalize = true, ime = ImeAction.Search, onIme = { model.checkPublicProduct(serialInput) })
                    }
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TintedButton(
                            "Kamera QR",
                            { scanQr() },
                            Modifier.weight(1f),
                            enabled = !state.busy,
                            path = PhosphorPaths.Camera,
                        )
                        TintedButton("Foto QR", { photoLauncher.launch("image/*") }, Modifier.weight(1f), enabled = !state.busy, path = PhosphorPaths.Image)
                    }
                    PrimaryButton(
                        if (state.busy) "Memeriksa…" else "Periksa status registri",
                        { model.checkPublicProduct(serialInput) },
                        Modifier.padding(horizontal = 16.dp).fillMaxWidth(),
                        enabled = serialInput.trim().isNotEmpty() && !state.busy,
                        busy = state.busy,
                    )
                }
                state.publicStatus?.let { st ->
                    item(key = "public-status") {
                        Spacer(Modifier.height(10.dp))
                        Panel {
                            Text("${st.serial} · ${if (st.variant == "single_pot") "Satu pot" else "Kebun"}", style = T.title3, color = p.ink)
                            val desc = when {
                                st.registryStatus == "revoked" -> "Dicabut oleh penerbit. Jangan diaktifkan."
                                st.registryStatus == "pending" -> "Terdaftar namun belum aktif di registri."
                                st.claimed -> "Sudah dimiliki sebuah akun. Gunakan kode transfer untuk oper kepemilikan."
                                else -> "Terdaftar dan siap diklaim dengan kode kemasan & tanda tangan perangkat."
                            }
                            Text(desc, style = T.body, color = p.secondary, modifier = Modifier.padding(top = 4.dp))
                            Text(if (st.issuerVerified) "Manifest penerbit terverifikasi di server." else "Manifest penerbit belum terverifikasi.", style = T.footnote, color = p.secondary, modifier = Modifier.padding(top = 6.dp))
                            if (!st.claimed && st.registryStatus == "active") {
                                PrimaryButton("Minta challenge aktivasi", { model.requestProductChallenge(st.serial) }, Modifier.padding(top = 12.dp).fillMaxWidth(), enabled = !state.busy)
                            }
                        }
                    }
                }
                state.activationChallenge?.let { ch ->
                    item(key = "claim-challenge") {
                        Spacer(Modifier.height(10.dp))
                        Panel {
                            Text("Bukti perangkat (${state.publicStatusSerial})", style = T.title3, color = p.ink)
                            Text("Challenge berlaku s/d ${time(ch.expiresAt)}:", style = T.footnote, color = p.secondary, modifier = Modifier.padding(top = 4.dp))
                            Text(ch.challenge, style = T.footnote.copy(fontFamily = FontFamily.Monospace), color = p.ink, modifier = Modifier.padding(vertical = 8.dp))
                            PlainButton("Salin challenge", { copySensitiveText(context, "Challenge Smart Agro", ch.challenge) }, path = PhosphorPaths.Copy)
                            Group(Modifier.padding(horizontal = 0.dp, vertical = 6.dp)) {
                                FieldRow("Kode tersegel", sealedCode, { sealedCode = it.take(256) }, "Dari kemasan", secure = true)
                                FieldRow("Tanda tangan", signature, { signature = it.take(96) }, "Base64 Ed25519", ime = ImeAction.Done)
                            }
                            PrimaryButton(
                                "Verifikasi & klaim produk",
                                {
                                    val c = sealedCode; val s = signature
                                    sealedCode = ""; signature = ""
                                    model.claimScannedProduct(ch.nonceId, c, s) { tab = 0 }
                                },
                                Modifier.padding(top = 8.dp).fillMaxWidth(),
                                enabled = sealedCode.isNotBlank() && signature.isNotBlank() && !state.busy,
                                busy = state.busy,
                            )
                            PlainButton("Tutup challenge", model::clearActivationChallenge)
                        }
                    }
                }
            }
            else -> {
                item(key = "transfer-out") {
                    SectionTitle("Transfer produk keluar")
                    if (state.products.isEmpty()) Footnote("Belum ada produk yang bisa ditransfer.")
                    else Group {
                        state.products.forEach { prod ->
                            Cell(
                                "${prod.label} · ${prod.serial}",
                                trailing = { PlainButton("Buat kode", { model.createProductTransfer(prod.id) }, enabled = !state.busy) },
                                chevron = false,
                            )
                        }
                    }
                    state.activeTransfer?.let { offer ->
                        Spacer(Modifier.height(10.dp))
                        Panel {
                            Text("Kode transfer aktif (hanya untuk penerima):", style = T.headline, color = p.ink)
                            Text(offer.code, style = T.title3.copy(fontFamily = FontFamily.Monospace), color = p.tint, modifier = Modifier.padding(vertical = 8.dp))
                            Text("Berlaku hingga ${time(offer.expiresAt)}", style = T.footnote, color = p.secondary)
                            Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                TintedButton("Salin kode", { copySensitiveText(context, "Kode transfer Smart Agro", offer.code) }, Modifier.weight(1f), path = PhosphorPaths.Copy)
                                state.activeTransferProductId?.let { pid ->
                                    PlainButton("Batalkan", { model.cancelProductTransfer(pid) }, destructive = true)
                                }
                            }
                        }
                    }
                }
                item(key = "transfer-in") {
                    SectionTitle("Terima transfer produk")
                    Group {
                        FieldRow("Nomor seri", transferInSerial, { transferInSerial = it.take(120) }, "SA-...", keyboard = KeyboardType.Ascii, capitalize = true)
                        FieldRow("Kode 32 hex", transferInCode, { transferInCode = it.take(64) }, "Kode satu kali", secure = true, ime = ImeAction.Done)
                    }
                    PrimaryButton(
                        "Terima kepemilikan",
                        {
                            val s = transferInSerial; val c = transferInCode
                            transferInSerial = ""; transferInCode = ""
                            model.acceptProductTransfer(s, c)
                        },
                        Modifier.padding(16.dp).fillMaxWidth(),
                        enabled = transferInSerial.isNotBlank() && transferInCode.isNotBlank() && !state.busy,
                        busy = state.busy,
                    )
                }
                item(key = "recovery") {
                    SectionTitle("Pemulihan kepemilikan")
                    Group(footer = "Ajukan jika akses perangkat atau akun pemilik sebelumnya hilang dengan bukti pembelian.") {
                        FieldRow("Nomor seri", recoverySerial, { recoverySerial = it.take(120) }, "SA-...", keyboard = KeyboardType.Ascii, capitalize = true)
                        FieldRow("Bukti nota", recoveryEvidenceRef, { recoveryEvidenceRef = it.take(240) }, "Nomor nota / invoice", ime = ImeAction.Next)
                        FieldRow("Penjelasan", recoveryStatement, { recoveryStatement = it.take(1000) }, "Jelaskan kronologi", singleLine = false, ime = ImeAction.Done)
                    }
                    PrimaryButton(
                        "Kirim permohonan pemulihan",
                        {
                            val ev = listOf(RecoveryEvidence("receipt", recoveryEvidenceRef.trim()))
                            model.submitOwnershipRecovery(recoverySerial, recoveryStatement, ev) {
                                recoverySerial = ""; recoveryStatement = ""; recoveryEvidenceRef = ""
                            }
                        },
                        Modifier.padding(16.dp).fillMaxWidth(),
                        enabled = recoverySerial.isNotBlank() && recoveryEvidenceRef.isNotBlank() && recoveryStatement.trim().length >= 5 && !state.busy,
                        busy = state.busy,
                    )
                    if (state.ownershipRecoveries.isNotEmpty()) {
                        Group {
                            state.ownershipRecoveries.forEach { rc ->
                                Cell(
                                    rc.serial,
                                    subtitle = "${rc.status} · ${time(rc.createdAt)}" + (rc.decisionReason?.let { "\n$it" } ?: ""),
                                    trailing = if (rc.status in listOf("open", "in_review")) ({
                                        PlainButton("Tarik", { model.withdrawOwnershipRecovery(rc.id) }, destructive = true, enabled = !state.busy)
                                    }) else null,
                                    chevron = false,
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    renamingUnit?.let { target ->
        var nextLabel by rememberSaveable(target.id) { mutableStateOf(target.name) }
        AgroSheet("Ubah nama unit", { renamingUnit = null }) {
            Group {
                FieldRow("Nama unit", nextLabel, { nextLabel = it.take(120) }, target.name, ime = ImeAction.Done)
            }
            PrimaryButton(
                "Simpan nama",
                {
                    model.selectUnit(target)
                    model.renameUnit(nextLabel)
                    renamingUnit = null
                },
                Modifier.padding(16.dp).fillMaxWidth(),
                enabled = nextLabel.trim().isNotEmpty() && !state.busy,
            )
        }
    }

    // A confirmation that says where the next readings go, not a gate: the device may be off while it is moved.
    placing?.let { (device, target) ->
        val from = device.unitId?.let { id -> state.units.find { it.id == id }?.name ?: "unit lain" }
        AgroSheet(if (from == null) "Pasang di ${target.name}?" else "Pindahkan ke ${target.name}?", { placing = null }) {
            Footnote(if (from == null) "Bacaan berikutnya dari perangkat ${device.id.take(8)} tercatat di ${target.name}. Pastikan probe sudah ditanam di pot ini."
                else "Bacaan berikutnya tercatat di ${target.name}. Riwayat di $from tetap tersimpan. Pindahkan juga probe ke pot ini agar bacaannya sesuai.")
            PrimaryButton(
                if (from == null) "Pasang perangkat" else "Pindahkan perangkat",
                { model.placeDevice(device.id, target.id); placing = null },
                Modifier.padding(16.dp).fillMaxWidth(),
                enabled = !state.busy,
            )
        }
    }

    archivingUnit?.let { target ->
        AgroSheet("Arsipkan ${target.name}?", { archivingUnit = null }) {
            Footnote("Data historis tetap tersimpan. Perangkat di unit ini dilepas, dan paket baru untuk unit ini ditolak sampai dipulihkan.")
            PrimaryButton(
                "Ya, arsipkan unit",
                { model.archiveUnit(target.id); archivingUnit = null },
                Modifier.padding(16.dp).fillMaxWidth(),
                destructive = true,
                enabled = !state.busy,
            )
        }
    }
}
