package id.smartagro.app

import android.content.ClipData
import android.content.ClipboardManager
import android.net.Uri
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import android.content.Context
import android.os.Build
import android.os.PersistableBundle
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import java.time.Instant
import java.util.Locale

internal fun copySensitiveText(context: Context, label: String, text: String) {
    val cm = context.getSystemService(ClipboardManager::class.java) ?: return
    val clip = ClipData.newPlainText(label, text)
    if (Build.VERSION.SDK_INT >= 33) {
        clip.description.extras = PersistableBundle().apply { putBoolean("android.content.extra.IS_SENSITIVE", true) }
    }
    cm.setPrimaryClip(clip)
    if (Build.VERSION.SDK_INT < 33) {
        Toast.makeText(context, "Gunakan clipboard di aplikasi tepercaya, lalu kosongkan.", Toast.LENGTH_SHORT).show()
    }
}

@Composable
internal fun AccountScreen(state: AppState, model: AgroViewModel) {
    val p = palette
    val uri = rememberSafeUriHandler()
    var editingName by rememberSaveable { mutableStateOf(false) }
    var confirmingLogout by rememberSaveable { mutableStateOf(false) }

    TitledScreen("Akun", actions = { RefreshAction(state, model) }) {
        notices(state)
        if (state.demo) {
            item(key = "demo-card") {
                Panel {
                    Text("Mode latihan tanpa akun", style = T.title3, color = p.ink)
                    Text(
                        "Anda sedang mencoba data sintetis. Keluar dari mode latihan untuk masuk dengan akun Google atau email Anda.",
                        style = T.subhead,
                        color = p.secondary,
                        modifier = Modifier.padding(top = 4.dp),
                    )
                    PrimaryButton("Akhiri latihan", model::logout, Modifier.padding(top = 14.dp).fillMaxWidth(), destructive = true, path = PhosphorPaths.SignOut)
                }
            }
            item(key = "demo-intro") {
                SectionTitle("Tampilan")
                Group(inset = 60.dp) {
                    Cell(
                        "Putar animasi masuk",
                        subtitle = "Pratinjau layar kaca cair Smart Agro",
                        glyph = PhosphorPaths.Sparkle,
                        glyphColor = p.tint,
                        onClick = model::replayIntro,
                    )
                }
            }
        } else {
            item(key = "profile") {
                val shownName = state.displayName.ifBlank { state.email.substringBefore('@') }.ifBlank { "Pemilik Smart Agro" }
                val initials = shownName.trim().split(Regex("\\s+")).take(2).mapNotNull { it.firstOrNull()?.uppercaseChar() }.joinToString("").ifEmpty { "SA" }
                Group {
                    Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                        Box(Modifier.size(56.dp).clip(CircleShape).background(p.soft), contentAlignment = Alignment.Center) {
                            Text(initials, style = T.title2, color = p.onSoft)
                        }
                        Column(Modifier.weight(1f)) {
                            Text(shownName, style = T.title3, color = p.ink)
                            Text(state.email, style = T.subhead, color = p.secondary)
                        }
                        PlainButton("Ubah", { editingName = true }, enabled = !state.busy)
                    }
                }
            }
            item(key = "workspace-group") {
                SectionTitle("Produk & hadiah")
                val pts = state.rewardBalance?.available?.let { "$it poin" } ?: if (state.rewardLoaded) "0 poin" else "Memuat…"
                Group(inset = 60.dp) {
                    Cell(
                        "Produk, QR & transfer",
                        subtitle = "${state.products.size} produk · ${state.units.size} unit aktif",
                        glyph = PhosphorPaths.Package,
                        glyphColor = p.tint,
                        onClick = { model.navigate(Screen.ManageProducts) },
                    )
                    Cell(
                        "Hadiah & energi",
                        value = pts,
                        glyph = PhosphorPaths.Medal,
                        glyphColor = p.sun,
                        onClick = { model.navigate(Screen.Rewards) },
                    )
                    Cell(
                        "Bukti kepemilikan",
                        subtitle = "Riwayat pencatatan kepemilikan on-chain",
                        glyph = PhosphorPaths.LinkSimple,
                        glyphColor = p.water,
                        onClick = { model.navigate(Screen.Proofs) },
                    )
                }
            }
            item(key = "security-group") {
                SectionTitle("Keamanan & pengaturan")
                val mfaLabel = state.security?.let { if (it.mfaEnabled) "2FA aktif" else "2FA nonaktif" }
                Group(inset = 60.dp, footer = "Tampilan mengikuti pengaturan gelap/terang dan ukuran teks sistem Android.") {
                    Cell(
                        "Keamanan akun",
                        value = mfaLabel,
                        glyph = PhosphorPaths.ShieldCheck,
                        glyphColor = p.tint,
                        onClick = { model.navigate(Screen.Security) },
                    )
                    Cell(
                        "Putar animasi masuk",
                        subtitle = "Pratinjau layar kaca cair Smart Agro",
                        glyph = PhosphorPaths.Sparkle,
                        glyphColor = p.tint,
                        onClick = model::replayIntro,
                    )
                    Cell(
                        "Buka profil di website",
                        glyph = PhosphorPaths.ArrowUpRight,
                        glyphColor = p.secondary,
                        onClick = { uri.openUri(WEB + "#profil") },
                    )
                    if (BuildConfig.DEBUG) {
                        Cell("Galeri komponen (Debug)", glyph = PhosphorPaths.Swatches, glyphColor = p.secondary, onClick = { model.navigate(Screen.Gallery) })
                    }
                }
            }
            item(key = "signout") {
                Spacer(Modifier.height(16.dp))
                Group {
                    Cell("Keluar dari akun", glyph = PhosphorPaths.SignOut, glyphColor = p.warn, destructive = true, onClick = { confirmingLogout = true })
                }
            }
        }
    }

    if (editingName) {
        var name by rememberSaveable(state.displayName) { mutableStateOf(state.displayName) }
        AgroSheet("Nama profil", { editingName = false }) {
            Group {
                FieldRow("Nama", name, { name = it.take(40) }, "Nama panggilan Anda", ime = ImeAction.Done, enabled = !state.busy)
            }
            PrimaryButton(
                if (state.busy) "Menyimpan…" else "Simpan nama",
                { model.updateName(name); editingName = false },
                Modifier.padding(16.dp).fillMaxWidth(),
                enabled = !state.busy && name.trim().isNotEmpty(),
                busy = state.busy,
            )
        }
    }

    if (confirmingLogout) {
        AgroSheet("Keluar dari akun", { confirmingLogout = false }) {
            Footnote("Sesi lokal di ponsel ini akan dihapus. Anda selalu dapat masuk kembali kapan saja.")
            PrimaryButton(
                "Ya, keluar",
                { confirmingLogout = false; model.logout() },
                Modifier.padding(16.dp).fillMaxWidth(),
                destructive = true,
                enabled = !state.busy,
            )
        }
    }
}

@Composable
internal fun SecurityScreen(state: AppState, model: AgroViewModel) {
    val p = palette
    val context = LocalContext.current
    val sec = state.security
    val rec = state.recoveryStatus
    var disablingMfa by rememberSaveable { mutableStateOf(false) }
    var generatingCodes by rememberSaveable { mutableStateOf(false) }
    var settingPassword by rememberSaveable { mutableStateOf(false) }
    val saveCodes = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/plain")) { uri: Uri? ->
        if (uri != null) {
            val codes = model.state.generatedRecoveryCodes
            if (codes == null) model.reportDocumentError("Buka kembali kode pemulihan sebelum menyimpan.")
            else model.writeDocument(uri, codes.joinToString("\n"))
        }
    }

    LaunchedEffect(state.demo, state.email, state.securityLoaded, state.busy) {
        if (!state.demo && state.email.isNotBlank() && !state.securityLoaded && !state.busy) {
            model.loadSecurity()
        }
    }

    TitledScreen("Keamanan", subtitle = state.email, back = "Akun", onBack = model::back, actions = { RefreshAction(state, model) }) {
        notices(state)
        sec?.holdUntil?.takeIf { it.isAfter(Instant.now()) }?.let { until ->
            item(key = "hold") {
                Banner("Penahanan keamanan aktif hingga ${time(until)}. Tindakan sensitif sementara dibatasi.", Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
            }
        }
        item(key = "mfa") {
            SectionTitle("Verifikasi dua langkah")
            Group(inset = 60.dp, footer = "Gunakan aplikasi autentikator (TOTP) untuk melindungi penukaran hadiah dan akses akun.") {
                if (sec?.mfaEnabled == true) {
                    Cell("Autentikator TOTP", value = "Aktif", glyph = PhosphorPaths.ShieldCheck, glyphColor = p.tint, chevron = false)
                    Cell("Nonaktifkan autentikator", glyph = PhosphorPaths.Key, glyphColor = p.warn, destructive = true, enabled = !state.busy, onClick = { disablingMfa = true })
                } else {
                    Cell("Aktifkan autentikator TOTP", subtitle = "Pindai QR atau salin kunci rahasia", glyph = PhosphorPaths.ShieldCheck, glyphColor = p.tint, enabled = !state.busy, onClick = { model.beginTotpSetup() })
                }
                Cell(
                    "Kode pemulihan",
                    subtitle = rec?.let { "${it.remaining} dari ${it.total} kode tersisa" } ?: "Kode cadangan satu kali pakai",
                    glyph = PhosphorPaths.Keyhole,
                    glyphColor = p.secondary,
                    enabled = !state.busy && (sec?.mfaEnabled == true),
                    onClick = { generatingCodes = true },
                )
            }
        }
        item(key = "pw") {
            SectionTitle("Kata sandi & perangkat")
            Group(inset = 60.dp, footer = "Akun Google juga dapat mengatur kata sandi di sini agar dapat masuk memakai email.") {
                Cell("Atur atau ganti kata sandi", glyph = PhosphorPaths.LockSimple, glyphColor = p.tint, enabled = !state.busy, onClick = { settingPassword = true })
                Cell("Keluar dari semua perangkat lain", glyph = PhosphorPaths.SignOut, glyphColor = p.warn, enabled = !state.busy, onClick = { model.signOutOtherSessions() })
            }
        }
        if (sec != null && sec.events.isNotEmpty()) {
            item(key = "events") {
                SectionTitle("Aktivitas keamanan terbaru")
                Group {
                    sec.events.take(20).forEach { ev ->
                        Cell(ev.kind.replace('_', ' ').replaceFirstChar { it.uppercase() }, subtitle = ev.detail, value = time(ev.createdAt), chevron = false)
                    }
                }
            }
        }
    }

    state.totpEnrollment?.let { enrollment ->
        var otpCode by remember(enrollment.id) { mutableStateOf("") }
        AgroSheet("Aktifkan autentikator", model::dismissTotpSetup) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text("Pindai QR ini di aplikasi autentikator (Google Authenticator / 1Password / Apple Passwords).", style = T.subhead, color = p.secondary, textAlign = TextAlign.Center)
                Spacer(Modifier.height(14.dp))
                QrMatrixBox(enrollment.uri, "Kode QR autentikator dua langkah", Modifier.size(196.dp))
                Spacer(Modifier.height(12.dp))
                Text(enrollment.secret, style = T.subhead.copy(fontFamily = FontFamily.Monospace), color = p.ink, textAlign = TextAlign.Center)
                PlainButton("Salin kunci rahasia", { copySensitiveText(context, "Kunci 2FA Smart Agro", enrollment.secret) }, path = PhosphorPaths.Copy)
                Spacer(Modifier.height(8.dp))
            }
            Group(footer = "Masukkan kode 6 angka yang tampil di aplikasi autentikator.") {
                FieldRow("Kode 6 angka", otpCode, { otpCode = it.filter(Char::isDigit).take(6) }, "123456", keyboard = KeyboardType.NumberPassword, ime = ImeAction.Done)
            }
            PrimaryButton(
                if (state.busy) "Mengonfirmasi…" else "Aktifkan verifikasi 2 langkah",
                {
                    val code = otpCode
                    otpCode = ""
                    model.confirmTotpSetup(enrollment.id, code)
                },
                Modifier.padding(16.dp).fillMaxWidth(),
                enabled = otpCode.length == 6 && !state.busy,
                busy = state.busy,
            )
        }
    }

    if (disablingMfa) {
        var code by remember { mutableStateOf("") }
        AgroSheet("Nonaktifkan 2FA", { disablingMfa = false }) {
            Group(footer = "Masukkan kode 6 angka dari autentikator Anda saat ini.") {
                FieldRow("Kode autentikator", code, { code = it.filter(Char::isDigit).take(6) }, "123456", keyboard = KeyboardType.NumberPassword, ime = ImeAction.Done)
            }
            PrimaryButton(
                "Nonaktifkan 2FA",
                { model.disableMfa(code) { disablingMfa = false } },
                Modifier.padding(16.dp).fillMaxWidth(),
                destructive = true,
                enabled = code.length == 6 && !state.busy,
                busy = state.busy,
            )
        }
    }

    if (generatingCodes) {
        var code by remember { mutableStateOf("") }
        AgroSheet("Buat kode pemulihan baru", { generatingCodes = false }) {
            Group(footer = "Kode pemulihan lama otomatis tidak berlaku.") {
                FieldRow("Kode autentikator", code, { code = it.filter(Char::isDigit).take(6) }, "123456", keyboard = KeyboardType.NumberPassword, ime = ImeAction.Done)
            }
            PrimaryButton(
                "Buat 10 kode pemulihan",
                { generatingCodes = false; model.generateRecoveryCodes(code) },
                Modifier.padding(16.dp).fillMaxWidth(),
                enabled = code.length == 6 && !state.busy,
                busy = state.busy,
            )
        }
    }

    state.generatedRecoveryCodes?.let { codes ->
        AgroSheet("Simpan kode pemulihan", model::clearGeneratedRecoveryCodes) {
            Banner("Setiap kode hanya berlaku satu kali. File .txt berisi kode tanpa enkripsi. Pilih lokasi pribadi dan jauhkan dari folder bersama.", Modifier.padding(horizontal = 16.dp))
            Spacer(Modifier.height(10.dp))
            Panel {
                codes.chunked(2).forEach { pair ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                        pair.forEach { c -> Text(c, style = T.headline.copy(fontFamily = FontFamily.Monospace), color = p.ink) }
                    }
                }
            }
            Row(Modifier.fillMaxWidth().padding(16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                TintedButton("Salin semua", { copySensitiveText(context, "Kode pemulihan Smart Agro", codes.joinToString("\n")) }, Modifier.weight(1f), path = PhosphorPaths.Copy)
                PrimaryButton(
                    "Simpan .txt",
                    { saveCodes.launch("smart-agro-recovery-codes.txt") },
                    Modifier.weight(1f),
                    path = PhosphorPaths.DownloadSimple,
                )
            }
        }
    }

    if (settingPassword) {
        var newPassword by remember { mutableStateOf("") }
        var confirmPassword by remember { mutableStateOf("") }
        val ok = newPassword.length >= 10 && newPassword == confirmPassword && !state.busy
        AgroSheet("Atur kata sandi", { settingPassword = false }) {
            Group(footer = "Minimal 10 karakter.") {
                FieldRow("Sandi baru", newPassword, { newPassword = it.take(256) }, "Minimal 10 karakter", secure = true)
                FieldRow("Konfirmasi", confirmPassword, { confirmPassword = it.take(256) }, "Ketik ulang", secure = true, ime = ImeAction.Done)
            }
            PrimaryButton(
                "Simpan kata sandi",
                {
                    val pw = newPassword
                    newPassword = ""; confirmPassword = ""
                    model.updateAccountPassword(pw) { settingPassword = false }
                },
                Modifier.padding(16.dp).fillMaxWidth(),
                enabled = ok,
                busy = state.busy,
            )
        }
    }
}
