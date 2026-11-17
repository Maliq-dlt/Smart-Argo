package id.smartagro.app

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
internal fun ProductsManageScreen(state: AppState, model: AgroViewModel) {
    val p = palette
    val context = LocalContext.current
    var tab by rememberSaveable { mutableIntStateOf(0) }
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
    var pendingCameraUri by remember { mutableStateOf<Uri?>(null) }

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
        item(key = "product-tabs") {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) {
                Segmented(listOf("Unit", "QR", "Transfer"), tab, { tab = it })
            }
        }
        when (tab) {
            0 -> {
                item(key = "active-units-title") { SectionTitle("Unit aktif (${state.units.size})") }
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
                                        ToggleCell(
                                            "Perangkat ${d.id.take(8)}",
                                            placedHere,
                                            { put -> model.placeDevice(d.id, if (put) u.id else null) },
                                            subtitle = if (placedHere) "Terpasang pada unit ini" else if (d.unitId == null) "Dipasangkan fleksibel" else "Terpasang di unit lain",
                                            glyph = PhosphorPaths.Package,
                                            glyphColor = p.secondary,
                                            enabled = !state.busy && d.status == "active",
                                        )
                                    }
                                    Cell("Riwayat aktivitas unit", glyph = PhosphorPaths.ClockCounterClockwise, glyphColor = p.secondary, enabled = !state.busy, onClick = { model.loadUnitLifecycleEvents(u.id) })
                                    Cell("Arsipkan unit", glyph = PhosphorPaths.Archive, glyphColor = p.warn, destructive = true, enabled = !state.busy, onClick = { archivingUnit = u })
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
                    scanWarning?.let { Banner(it, Modifier.padding(horizontal = 16.dp, vertical = 4.dp), error = true) }
                    Group {
                        FieldRow("Nomor seri", serialInput, { serialInput = it.take(120) }, "SA-...", keyboard = KeyboardType.Ascii, capitalize = true, ime = ImeAction.Search, onIme = { model.checkPublicProduct(serialInput) })
                    }
                    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TintedButton(
                            "Kamera QR",
                            {
                                val target = tempCameraQrUri(context)
                                pendingCameraUri = target
                                cameraLauncher.launch(target)
                            },
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
                                    model.claimScannedProduct(ch.nonceId, c, s)
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

    archivingUnit?.let { target ->
        AgroSheet("Arsipkan ${target.name}?", { archivingUnit = null }) {
            Footnote("Data historis tetap tersimpan, namun paket data baru untuk unit ini akan ditolak sampai dipulihkan.")
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
