package id.smartagro.app

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp

/** Debug-only gallery of the A3 kit, for design review on a device in both appearances and at large text sizes. */
@Composable internal fun ComponentGallery(onBack: () -> Unit) {
    val p = palette
    var range by rememberSaveable { mutableIntStateOf(0) }
    var share by rememberSaveable { mutableStateOf(true) }
    var sheet by rememberSaveable { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    TitledScreen("Komponen", subtitle = "Sistem desain A3 · hanya build debug", back = "Akun", onBack = onBack,
        actions = { BarButton(PhosphorPaths.PlusBold, "Tambah contoh", {}) }) {
        item { SectionTitle("Tombol") }
        item {
            Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                PrimaryButton("Catat penyiraman", { busy = !busy }, Modifier.fillMaxWidth(), busy = busy, path = PhosphorPaths.DropFill)
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    TintedButton("Kenapa?", {}, Modifier.weight(1f), path = PhosphorPaths.Sparkle)
                    TintedButton("Hapus", {}, Modifier.weight(1f), destructive = true)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    PrimaryButton("Nonaktif", {}, Modifier.weight(1f), enabled = false)
                    PlainButton("Lihat semua", {}, Modifier.weight(1f))
                }
            }
        }
        item { SectionTitle("Segmen") }
        item { Box(Modifier.padding(horizontal = 16.dp)) { Segmented(listOf("24 jam", "7 hari", "30 hari"), range, { range = it }) } }
        item { SectionTitle("Daftar") }
        item {
            Group(inset = 60.dp, footer = "Baris dengan simbol berwarna, nilai di kanan, dan chevron untuk membuka detail.") {
                Cell("Kelembapan tanah", glyph = PhosphorPaths.DropFill, glyphColor = p.water, value = "62%", onClick = {})
                Cell("Suhu tanah", glyph = PhosphorPaths.Thermometer, glyphColor = p.sun, value = "27,4 °C", onClick = {})
                Cell("pH tanah", glyph = PhosphorPaths.Flask, glyphColor = p.tint, value = "6,4")
                ToggleCell("Bagikan ke komunitas", share, { share = it }, glyph = PhosphorPaths.UsersThree, glyphColor = Moss,
                    subtitle = "Tiga angka per siklus, tanpa identitas.")
            }
        }
        item { Spacer(Modifier.height(16.dp)) }
        item {
            Group {
                Cell("Pot teras", subtitle = "SA-POT-0001 · aktif", onClick = {})
                Cell("Keluar", destructive = true, onClick = {})
            }
        }
        item { SectionTitle("Status") }
        item {
            Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Banner("Tanah mulai kering. Saran berikutnya dihitung dari bacaan 12 menit lalu.")
                Banner("Prakiraan belum dapat dimuat. Bacaan sensor tetap tersedia.", error = true)
                Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) { ActivityIndicator(); ActivityIndicator(color = p.tint) }
            }
        }
        item { SectionTitle("Sheet") }
        item { TintedButton("Buka sheet", { sheet = true }, Modifier.padding(horizontal = 16.dp).fillMaxWidth()) }
        item { SectionTitle("Huruf") }
        item {
            Panel {
                Text("Judul besar", style = T.largeTitle, color = p.ink)
                Text("Judul 1", style = T.title1, color = p.ink)
                Text("Judul 2", style = T.title2, color = p.ink)
                Text("Judul 3", style = T.title3, color = p.ink)
                Text("Headline 17", style = T.headline, color = p.ink)
                Text("Isi 17 untuk teks yang dibaca.", style = T.body, color = p.ink)
                Text("Subjudul 15 untuk keterangan.", style = T.subhead, color = p.secondary)
                Text("Catatan kaki 13.", style = T.footnote, color = p.secondary)
                Text("62%", style = T.figure, color = p.ink)
            }
        }
        item { SectionTitle("Warna") }
        item {
            Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf(p.tint, p.soft, p.water, p.sun, p.warn, p.cell, p.canvas).forEach {
                    Box(Modifier.weight(1f).height(44.dp).clip(RoundedCornerShape(12.dp)).background(it))
                }
            }
        }
    }
    if (sheet) AgroSheet("Catat perawatan", { sheet = false }, action = "Simpan", onAction = { sheet = false }) {
        Box(Modifier.padding(horizontal = 16.dp)) { Segmented(listOf("Siram", "Pupuk", "Catatan"), 0, {}) }
        Spacer(Modifier.height(16.dp))
        Group { Cell("Waktu", value = "Sekarang"); Cell("Tanaman", value = "Cabai teras · CB-1") }
    }
}
