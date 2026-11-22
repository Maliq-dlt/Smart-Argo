package id.smartagro.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Base64
import java.util.Locale

/** Deletion with a 14-day grace period (20261122000000_account_deletion_avatar): product serials, never names. */
data class AccountDeletion(val requestedAt: Instant, val purgeAfter: Instant, val released: List<String>, val restorable: List<String>)

private fun invalid(): Nothing = throw IllegalArgumentException("Data akun tidak valid.")
private val serial = Regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$")
private fun JSONObject.serials(key: String): List<String> {
    val a = optJSONArray(key) ?: invalid()
    require(a.length() <= 1000) { "Status penghapusan akun tidak valid." }
    return (0 until a.length()).map { i -> (a.opt(i) as? String)?.takeIf(serial::matches) ?: invalid() }
}
/** The `deletion` object of my_account_deletion, or the whole reply; null when nothing is pending. */
internal fun parseDeletion(json: JSONObject?): AccountDeletion? {
    val d = json?.optJSONObject("deletion") ?: json ?: return null
    if (d.opt("pending") != true) return null
    return AccountDeletion(d.instant("requested_at"), d.instant("purge_after"), d.serials("released"), d.serials("restorable"))
}
internal fun parseAvatar(json: JSONObject): ByteArray? {
    val a = json.optJSONObject("avatar") ?: return null
    require(a.text("mime", 20) in setOf("image/webp", "image/jpeg", "image/png")) { "Foto profil tidak valid." }
    val data = a.text("data", 350_000)
    return try { Base64.getDecoder().decode(data) } catch (_: IllegalArgumentException) { invalid() }
}

internal const val AVATAR_PX = 256
/** The centre square of any picture, as left, top and side. */
internal fun centerSquare(width: Int, height: Int): Triple<Int, Int, Int> = minOf(width, height).let { Triple((width - it) / 2, (height - it) / 2, it) }

/** Picked image → its centre square at 256 px, WebP. Decoded at a reduced size first, so a 50 MP photo costs no more memory
 *  than a small one. ponytail: always the centre; add a framing step if faces get cut off. */
internal fun avatarBytes(context: Context, uri: Uri): ByteArray {
    val source = if (Build.VERSION.SDK_INT >= 28) ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri)) { decoder, info, _ ->
        decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        val k = maxOf(1, minOf(info.size.width, info.size.height) / (AVATAR_PX * 2))
        decoder.setTargetSize(info.size.width / k, info.size.height / k)
    } else {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (minOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= AVATAR_PX * 2) sample *= 2
        context.contentResolver.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample }) }
            ?: throw IllegalArgumentException("Gambar ini tidak bisa dibaca. Coba foto lain.")
    }
    val (x, y, side) = centerSquare(source.width, source.height)
    val square = Bitmap.createScaledBitmap(Bitmap.createBitmap(source, x, y, side, side), AVATAR_PX, AVATAR_PX, true)
    @Suppress("DEPRECATION") val format = if (Build.VERSION.SDK_INT >= 30) Bitmap.CompressFormat.WEBP_LOSSY else Bitmap.CompressFormat.WEBP
    return ByteArrayOutputStream().also { check(square.compress(format, 86, it)) { "Foto tidak bisa disiapkan." } }.toByteArray()
}

internal fun initialsOf(name: String) = name.trim().split(Regex("[\\s._-]+")).filter { it.isNotEmpty() }.take(2)
    .mapNotNull { it.firstOrNull()?.uppercaseChar() }.joinToString("").ifEmpty { "SA" }
private val longDate = DateTimeFormatter.ofPattern("d MMMM yyyy", Locale.forLanguageTag("id-ID"))
internal fun dateOf(at: Instant): String = longDate.format(at.atZone(ZoneId.systemDefault()))

/** The photo, or initials on the soft tint when there is none (or it cannot be decoded). */
@Composable internal fun AvatarImage(bytes: ByteArray?, name: String, size: Dp, modifier: Modifier = Modifier) {
    val p = palette
    val bitmap = remember(bytes) { bytes?.let { runCatching { BitmapFactory.decodeByteArray(it, 0, it.size)?.asImageBitmap() }.getOrNull() } }
    if (bitmap != null) Image(bitmap, "Foto profil $name", modifier.size(size).clip(CircleShape), contentScale = ContentScale.Crop)
    else Box(modifier.size(size).clip(CircleShape).background(p.soft).semantics { contentDescription = "Inisial $name" }, contentAlignment = Alignment.Center) {
        Text(initialsOf(name), style = if (size >= 80.dp) T.title1 else T.title2, color = p.onSoft)
    }
}

/** Profil: the photo (Photo Picker; nothing else on the phone is read) and the name. */
@Composable internal fun ProfileScreen(state: AppState, model: AgroViewModel) {
    val p = palette
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var photoActions by rememberSaveable { mutableStateOf(false) }
    var editingName by rememberSaveable { mutableStateOf(false) }
    val name = state.displayName.ifBlank { state.email.substringBefore('@') }.ifBlank { "Pemilik Smart Agro" }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) scope.launch {
            try { model.setAvatar(withContext(Dispatchers.IO) { avatarBytes(context, uri) }, "image/webp") }
            catch (error: Exception) { model.reportDocumentError(error.message ?: "Foto tidak bisa disiapkan.") }
        }
    }
    TitledScreen("Profil", back = "Akun", onBack = model::back) {
        notices(state)
        item(key = "photo") {
            Column(Modifier.fillMaxWidth().padding(vertical = 12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                AvatarImage(state.avatar, name, 104.dp, Modifier.clip(CircleShape).clickable(role = Role.Button, onClickLabel = "Ubah foto profil") { photoActions = true })
                PlainButton(if (state.avatar == null) "Tambah foto" else "Ubah foto", { photoActions = true }, Modifier.padding(top = 6.dp), enabled = !state.busy)
            }
        }
        item(key = "name") {
            Group(footer = "Nama tampil di aplikasi dan website. Email tidak berubah.") {
                Cell("Nama", value = name, onClick = { editingName = true }, enabled = !state.busy)
                Cell("Email", value = state.email, chevron = false)
            }
        }
    }
    if (photoActions) AgroSheet("Foto profil", { photoActions = false }) {
        Group(inset = 60.dp) {
            Cell("Pilih dari galeri", glyph = PhosphorPaths.Image, onClick = {
                photoActions = false; pick.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
            })
            if (state.avatar != null) Cell("Hapus foto", glyph = PhosphorPaths.Trash, glyphColor = p.warn, destructive = true, onClick = { photoActions = false; model.clearAvatar() })
        }
        Footnote("Foto dipotong persegi di tengah dan hanya terlihat oleh Anda di aplikasi dan website.")
        Spacer(Modifier.height(16.dp))
    }
    if (editingName) {
        var draft by rememberSaveable(state.displayName) { mutableStateOf(state.displayName) }
        AgroSheet("Nama profil", { editingName = false }) {
            Group { FieldRow("Nama", draft, { draft = it.take(40) }, "Nama panggilan Anda", ime = ImeAction.Done, enabled = !state.busy) }
            PrimaryButton(if (state.busy) "Menyimpan…" else "Simpan nama", { model.updateName(draft); editingName = false },
                Modifier.padding(16.dp).fillMaxWidth(), enabled = !state.busy && draft.trim().isNotEmpty(), busy = state.busy)
        }
    }
}

/**
 * Hapus akun in four steps, as on the web (#hapus-akun): what happens, verify, confirm, done. The server repeats every
 * check (request_account_deletion); Google Play asks for this in the app as well as on the web.
 */
@Composable internal fun DeleteAccountScreen(state: AppState, model: AgroViewModel, google: Boolean) {
    val p = palette
    val context = LocalContext.current
    var step by rememberSaveable { mutableIntStateOf(1) }
    var password by remember { mutableStateOf("") }
    var code by remember { mutableStateOf("") }
    LaunchedEffect(state.email, state.securityLoaded) { if (!state.demo && !state.securityLoaded && state.email.isNotBlank()) model.loadSecurity() }
    val mfa = state.security?.mfaEnabled == true
    val purge = dateOf(Instant.now().plusSeconds(14 * 86_400))
    val serials = state.products.map { it.serial }
    val scheduled = state.deletionScheduled
    // Each step starts at its top: the list would otherwise keep step 1's scroll and hide the next heading.
    val list = rememberLazyListState()
    LaunchedEffect(step, scheduled != null) { list.scrollToItem(0) }
    TitledScreen("Hapus akun", large = false, back = if (scheduled == null) "Akun" else null, onBack = model::back, state = list) {
        notices(state)
        if (scheduled != null) {
            item(key = "done") {
                Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 24.dp)) {
                    Text("Akun dijadwalkan dihapus", style = T.title2, color = p.ink, modifier = Modifier.semantics { heading() })
                    Text("Masuk lagi sebelum ${dateOf(scheduled.purgeAfter)} untuk membatalkan. Sesudah tanggal itu data tidak bisa dipulihkan.",
                        style = T.body, color = p.secondary, modifier = Modifier.padding(top = 8.dp))
                }
                PrimaryButton("Keluar", model::finishDeletion, Modifier.padding(16.dp).fillMaxWidth())
            }
            return@TitledScreen
        }
        item(key = "step") { StepDots(step) }
        when (step) {
            1 -> {
                item(key = "intro") {
                    Heading("Sebelum menghapus akun", "Akun langsung nonaktif. Data dihapus permanen pada $purge, 14 hari dari sekarang. Masuk lagi sebelum tanggal itu untuk membatalkan.")
                    SectionTitle("Dihapus")
                    Group(inset = 60.dp) {
                        Cell("Profil, nama, dan foto", glyph = PhosphorPaths.UserCircle, chevron = false)
                        Cell("Kebun, pot, dan nama tanaman", glyph = PhosphorPaths.Plant, chevron = false)
                        Cell("Jurnal perawatan dan pertanyaan ke asisten", glyph = PhosphorPaths.Notebook, chevron = false)
                        Cell("Sesi di semua perangkat", glyph = PhosphorPaths.SignOut, chevron = false)
                    }
                    SectionTitle("Kepemilikan dilepas")
                    if (serials.isEmpty()) Footnote("Akun ini tidak memiliki produk.")
                    else Group(inset = 60.dp, footer = "Setelah dilepas, pemilik baru bisa mendaftarkan perangkat ini.") {
                        serials.forEach { Cell(it, glyph = PhosphorPaths.Package, chevron = false) }
                    }
                    SectionTitle("Tetap ada, tanpa data pribadi")
                    Group(inset = 60.dp) {
                        Cell("Bukti kepemilikan on-chain", subtitle = "Hanya hash; catatan chain tidak bisa dihapus", glyph = PhosphorPaths.ShieldCheck, chevron = false)
                        Cell("Angka komunitas yang sudah digabung", subtitle = "Serta catatan poin dan pengajuan, tanpa nama", glyph = PhosphorPaths.UsersThree, chevron = false)
                    }
                    PrimaryButton("Lanjutkan", { step = 2 }, Modifier.padding(16.dp).fillMaxWidth())
                }
            }
            2 -> item(key = "verify") {
                Heading("Pastikan ini Anda", "Verifikasi berlaku 10 menit.")
                Group {
                    if (mfa) FieldRow("Kode autentikator", code, { code = it.filter(Char::isDigit).take(6) }, "6 angka", keyboard = KeyboardType.NumberPassword, ime = ImeAction.Done, enabled = !state.busy)
                    else FieldRow("Kata sandi", password, { password = it.take(256) }, "Kata sandi akun", secure = true, ime = ImeAction.Done, enabled = !state.busy)
                }
                PrimaryButton(if (state.busy) "Memeriksa…" else "Verifikasi", {
                    model.reverifyForDeletion(password.takeUnless { mfa }, code.takeIf { mfa }) { step = 3 }; password = ""; code = ""
                }, Modifier.padding(16.dp).fillMaxWidth(), enabled = !state.busy && (if (mfa) code.length == 6 else password.length >= 8), busy = state.busy)
                if (!mfa && google) TintedButton("Masuk ulang dengan Google", { model.reverifyGoogleForDeletion(context) { step = 3 } },
                    Modifier.padding(horizontal = 16.dp).fillMaxWidth(), enabled = !state.busy, path = PhosphorPaths.GoogleLogo)
            }
            else -> item(key = "confirm") {
                Heading("Hapus akun ${state.displayName.ifBlank { state.email }}?",
                    "Anda keluar dari semua perangkat sekarang${if (serials.isEmpty()) "" else " dan ${serials.size} produk dilepas"}. Data dihapus permanen pada $purge.")
                PrimaryButton(if (state.busy) "Menghapus…" else "Hapus akun", model::requestDeletion, Modifier.padding(16.dp).fillMaxWidth(),
                    enabled = !state.busy, busy = state.busy, destructive = true)
                PlainButton("Batal", model::back, Modifier.padding(horizontal = 16.dp).fillMaxWidth(), enabled = !state.busy)
            }
        }
    }
}

@Composable private fun Heading(title: String, detail: String) {
    val p = palette
    Column(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, top = 8.dp, bottom = 6.dp)) {
        Text(title, style = T.title2, color = p.ink, modifier = Modifier.semantics { heading() })
        Text(detail, style = T.body, color = p.secondary, modifier = Modifier.padding(top = 6.dp))
    }
}

/** Three short bars: where the person is in the deletion (no animation of their own; the filled one moves with the step). */
@Composable private fun StepDots(step: Int) {
    val p = palette
    Row(Modifier.padding(start = 20.dp, top = 4.dp, bottom = 4.dp).semantics(mergeDescendants = true) { contentDescription = "Langkah $step dari 3" },
        horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        (1..3).forEach { Box(Modifier.size(28.dp, 4.dp).clip(CircleShape).background(if (it <= step) p.tint else p.separator)) }
    }
}

/** Shown instead of the app when an account inside its grace period signs in: the only things it can do. */
@Composable internal fun DeletionPendingScreen(state: AppState, model: AgroViewModel) {
    val p = palette
    val d = state.deletion ?: return
    Column(Modifier.fillMaxSize().background(p.canvas).verticalScroll(rememberScrollState()).statusBarsPadding().navigationBarsPadding()
        .padding(horizontal = 20.dp, vertical = 32.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Spacer(Modifier.height(24.dp))
        Text("Akun ini dijadwalkan dihapus", style = T.largeTitle, color = p.ink, modifier = Modifier.semantics { heading() })
        Text("Data akan dihapus permanen pada ${dateOf(d.purgeAfter)}. Batalkan untuk memakai akun seperti biasa.", style = T.body, color = p.secondary)
        if (d.released.isNotEmpty()) Text(when {
            d.restorable.size == d.released.size -> "Produk ${d.released.joinToString()} kembali ke akun ini bila dibatalkan."
            d.restorable.isNotEmpty() -> "Produk ${d.restorable.joinToString()} kembali bila dibatalkan. Yang lain sudah didaftarkan pemilik baru."
            else -> "Produk yang dilepas sudah didaftarkan pemilik baru dan tidak kembali."
        }, style = T.subhead, color = p.secondary)
        state.message?.let { Banner(it, Modifier.padding(vertical = 4.dp), state.messageIsError) }
        Spacer(Modifier.height(8.dp))
        PrimaryButton(if (state.busy) "Membatalkan…" else "Batalkan penghapusan", model::cancelDeletion, Modifier.fillMaxWidth(), enabled = !state.busy, busy = state.busy)
        PlainButton("Tetap hapus dan keluar", model::logout, Modifier.fillMaxWidth(), enabled = !state.busy)
    }
}
