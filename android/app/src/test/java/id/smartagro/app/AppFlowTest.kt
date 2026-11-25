package id.smartagro.app

import androidx.compose.foundation.verticalScroll

import android.graphics.Bitmap
import android.graphics.Canvas
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.test.*
import org.junit.Assert.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w390dp-h844dp-mdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class AppFlowTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private fun screenshot(name: String) {
        val folder = File(requireNotNull(System.getProperty("smartagro.screenshots")))
        folder.mkdirs()
        // Compose's PixelCopy capture waits for a hardware window redraw unavailable in Robolectric.
        // Draw the real Android view tree through its native Canvas instead.
        val bitmap = bitmap()
        File(folder,"$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG,100,it) }
    }
    private fun bitmap() = compose.runOnIdle {
        val view = compose.activity.window.decorView
        Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888).also { view.draw(Canvas(it)) }
    }
    @Test fun moistureUsesAnIndexOutOf100() {
        assertEquals("68/100", reading(Sensor.Moisture, 68.0))
        assertEquals("100/100", reading(Sensor.Moisture, 100.0))
        assertEquals("—", reading(Sensor.Moisture, null))
    }

    @Test fun barsAverageTrustedReadingsByMeasurementTime() {
        val first = java.time.Instant.parse("2026-11-20T00:00:00Z")
        val m = Reading(Sensor.Moisture, "ok", 40.0, first)
        val readings = listOf(m, m.copy(value = 60.0, at = first.plusSeconds(1200)), m.copy(value = 99.0, quality = "error", at = first.plusSeconds(1300)),
            m.copy(value = 70.0, at = first.plusSeconds(5400)), m.copy(value = 10.0, at = first.plusSeconds(7200)), Reading(Sensor.Ph, "ok", 6.1, first))
        // Four 30-minute slices of two hours: the error and the reading at the end of the window are left out.
        assertEquals(listOf(50.0, null, null, 70.0), buckets(readings, Sensor.Moisture, first, first.plusSeconds(7200), 4))

        val zone = java.time.ZoneOffset.UTC
        val day = java.time.LocalDate.of(2026, 11, 20)
        fun entry(kind: String, d: Long) = day.plusDays(d).atStartOfDay(zone).plusHours(9).toInstant().let { CareEntry("e$d$kind", "unit", kind, it, it, null, "") }
        assertEquals(listOf(CareMark.Water, CareMark.None, CareMark.Check),
            careMarks(listOf(entry("watering", 0), entry("inspection", 0), entry("note", 2)), day, day.plusDays(2), zone))

        val chili = referenceFor(1)
        assertEquals(Tone.Dry, moistureWord(38.0, chili)?.tone)
        assertEquals("Mulai kering", moistureWord(45.0, chili)?.text)
        assertEquals("Cukup", moistureWord(60.0, chili)?.text)
        assertEquals(Tone.Wet, moistureWord(88.0, chili)?.tone)
        assertEquals(Tone.Learn, moistureWord(60.0, null)?.tone)

        val at = first
        val ph = Reading(Sensor.Ph, "not_measured", null, at)
        val good = ph.copy(quality = "ok", value = 6.2)
        assertEquals(SensorStatus.Waiting, sensorStatus(null, at, stale = false, revoked = false))
        assertEquals(SensorStatus.Unmeasured, sensorStatus(ph, at, stale = false, revoked = false))
        assertEquals(SensorStatus.Error, sensorStatus(ph.copy(quality = "error"), at, stale = false, revoked = false))
        assertEquals(SensorStatus.Ready, sensorStatus(good, at, stale = false, revoked = false))
        assertEquals(SensorStatus.Ready, sensorStatus(good, at.plusSeconds(86_400), stale = false, revoked = false))
        assertEquals(SensorStatus.Stale, sensorStatus(good, at.plusSeconds(90_901), stale = false, revoked = false))
        assertEquals(SensorStatus.Stale, sensorStatus(good.copy(sensor = Sensor.Moisture), at.plusSeconds(4_501), stale = false, revoked = false))
        assertEquals(SensorStatus.Stale, sensorStatus(good, at, stale = true, revoked = false))
        assertEquals(SensorStatus.UntrustedClock, sensorStatus(good.copy(synced = false), at, stale = false, revoked = false))
        assertEquals(SensorStatus.Revoked, sensorStatus(good, at, stale = false, revoked = true))
        assertEquals(listOf(listOf(good), listOf(good.copy(at = at.plusSeconds(3600)))),
            chartSegments(listOf(good, ph.copy(at = at.plusSeconds(1800)), good.copy(at = at.plusSeconds(3600))), Sensor.Ph))
    }

    @Test fun leafTouchAndSpeciesChangeKeepPotAnchored() {
        var onion by mutableStateOf(false)
        compose.mainClock.autoAdvance = false
        compose.runOnUiThread {
            compose.activity.setContent {
                AgroTheme(false) {
                    PlantScene(Modifier.fillMaxWidth().height(320.dp).testTag("interactive-plant"),
                        onion=onion,moisture=68.0,cutaway=false,interactive=true)
                }
            }
        }
        compose.mainClock.advanceTimeBy(1000)
        val node=compose.onNodeWithTag("interactive-plant")
        val bounds=node.fetchSemanticsNode().boundsInWindow
        fun pixels(top: Float, bottom: Float): IntArray {
            val frame=bitmap()
            val width=bounds.width.toInt()
            val y=(bounds.top+bounds.height*top).toInt()
            val height=(bounds.height*(bottom-top)).toInt()
            return IntArray(width*height).also { frame.getPixels(it,0,width,bounds.left.toInt(),y,width,height) }
        }
        val pot=pixels(.75f,.98f)
        val crown=pixels(.12f,.62f)
        node.assertHasClickAction().performClick()
        compose.mainClock.advanceTimeBy(270)
        assertFalse("Touch should move leaves",crown.contentEquals(pixels(.12f,.62f)))
        assertArrayEquals("Touch must leave pot anchored",pot,pixels(.75f,.98f))
        compose.mainClock.advanceTimeBy(1800)
        assertArrayEquals("Leaf motion settles instead of looping",crown,pixels(.12f,.62f))
        compose.runOnIdle { onion=true }
        compose.mainClock.advanceTimeBy(280)
        assertArrayEquals("Switching crops must leave pot anchored",pot,pixels(.75f,.98f))
        compose.mainClock.advanceTimeBy(1000)
        assertFalse("The selected crop must change its crown",crown.contentEquals(pixels(.12f,.62f)))
        screenshot("06-interactive-onion")
        compose.mainClock.autoAdvance = true
    }
    @OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
    @Test fun nativeRewardConfirmationProofsAndWeatherRemainInline() {
        val item=RewardItem("item-1","Bibit tomat",80,2,0,"available")
        val balance=RewardBalance(300,60,240,true)
        val redemption=Redemption("redemption-1","Benih cabai",60,"reserved",java.time.Instant.now(),null,null)
        var state by mutableStateOf(AppState(screen=Screen.Rewards,rewardLoaded=true,rewards=RewardWorkspace(balance,"v1",listOf(item),listOf(redemption),listOf(LedgerEntry("ledger-1",300,"Energi terverifikasi",java.time.Instant.now())))))
        var stage by mutableStateOf(0)
        var reservations=0;var cancellations=0
        compose.activity.runOnUiThread {
            compose.activity.setContent {
                AgroTheme(false) {
                    androidx.compose.runtime.CompositionLocalProvider(androidx.compose.material3.LocalRippleConfiguration provides null) {
                        androidx.compose.material3.Surface {
                            when(stage) {
                                0 -> RewardsScreen(state,{}, { selected,code->assertEquals(item,selected);assertEquals("123456",code);reservations++ }, { assertEquals(redemption.id,it);cancellations++ })
                                1 -> ProofsScreen(state,{})
                                else -> androidx.compose.foundation.layout.Column { WeatherValues(WeatherSnapshot("2026-11-16T12:00","berawan",25.0,70.0,55.0,5.0,0.0,emptyList())) }
                            }
                        }
                    }
                }
            }
        }
        compose.onNodeWithText("80 token = 1 Bibit tomat").assertExists()
        compose.onNodeWithText("Saldo dan stok cukup untuk 2 unit. Sisa setelah reservasi 1 unit: 160 token.").assertExists()
        compose.onNodeWithText("Tukar Bibit tomat").performScrollTo().performClick()
        compose.onNodeWithText("Konfirmasi reservasi").performScrollTo().assertIsDisplayed()
        assertEquals(0,reservations)
        compose.onNodeWithText("Kode autentikator jika diminta").performScrollTo().performTextInput("123456")
        compose.onNodeWithText("Konfirmasi reservasi").performScrollTo().performClick()
        assertEquals(1,reservations)
        compose.onNodeWithText("Batalkan reservasi").performScrollTo().performClick()
        assertEquals(0,cancellations)
        compose.onNodeWithText("Ya, batalkan reservasi").performScrollTo().performClick()
        assertEquals(1,cancellations)
        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasText("Lihat riwayat poin (1)"))
        compose.onNodeWithText("Lihat riwayat poin (1)").performClick()
        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasText("Energi terverifikasi"))
        compose.onNodeWithText("Energi terverifikasi").assertIsDisplayed()
        screenshot("07-native-rewards")
        compose.runOnIdle {
            state=state.copy(screen=Screen.Proofs,proofsLoaded=true,proofs=listOf(ChainProof("claim:example","ownership_claim","SA-1","mismatch","a".repeat(64),null,null,null,java.time.Instant.now(),null)))
            stage=1
        }
        compose.onNodeWithText("Tidak cocok, bukan bukti sah").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Lihat transaksi di explorer").assertDoesNotExist()
        screenshot("08-native-proofs")
        compose.runOnIdle { stage=2 }
        compose.onNodeWithText("Kelembapan udara 70,0% · Angin 5,0 m/s").assertIsDisplayed()
        compose.onNodeWithText("Prakiraan 2026-11-16 12:00 · waktu lokasi").assertIsDisplayed()
        screenshot("09-native-weather")
    }
    @Test fun explanationCanRetryDiscoveryAndOnlySubmitsTheVisibleQuestion() {
        var available by mutableStateOf(false)
        var loads=0
        var submitted=""
        compose.activity.runOnUiThread {
            compose.activity.setContent {
                AgroTheme(false) {
                    androidx.compose.foundation.layout.Column(androidx.compose.ui.Modifier.verticalScroll(androidx.compose.foundation.rememberScrollState())) {
                        ExplanationSection(null,false,"Layanan belum tersedia",{loads++},{submitted=it},available)
                    }
                }
            }
        }
        compose.onNodeWithText("Muat penjelasan tersimpan").performScrollTo().performClick()
        assertEquals(1,loads)
        compose.runOnIdle { available=true }
        compose.onNodeWithText("Pertanyaan atau pengamatan (opsional)").performScrollTo().performTextInput("Daun mulai menguning")
        compose.onNodeWithText("Buat penjelasan berbasis bukti").performScrollTo().performClick()
        assertEquals("Daun mulai menguning",submitted)
    }
    @Test fun loginDemoProductsDashboardHistoryAndBack() {
        compose.onNodeWithText("Smart Agro").assertIsDisplayed()
        // Appearance follows the system (HIG); the app has no light/dark switch of its own.
        compose.onNodeWithText("Mode gelap").assertDoesNotExist()
        screenshot("00-welcome")
        compose.onNodeWithText("Masuk dengan email").performScrollTo().performClick()
        compose.onNodeWithText("Masuk ke Smart Agro").assertIsDisplayed()
        compose.onNodeWithText("Email").performTextInput("grower@example.test")
        compose.onNodeWithText("Kata sandi").performTextInput("local-ui-check")
        screenshot("01-login-password")
        compose.onNodeWithText("Coba mode latihan").performScrollTo().performClick()
        compose.onNodeWithText("Tanaman saya").assertIsDisplayed()
        // Ten practice plants on two practice products; the one practice marker explains itself.
        compose.onNodeWithText("10 tanaman · 2 produk").assertIsDisplayed()
        compose.onNodeWithText("Latihan").performClick()
        compose.onNodeWithText("Mode latihan").assertIsDisplayed()
        compose.onNodeWithContentDescription("Tutup").performClick()
        screenshot("02-products")
        // The search narrows the grid; a tile opens the plant.
        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasText("Cari nama, kode, atau produk"))
        compose.onNodeWithText("Cari nama, kode, atau produk").performTextInput("T-CASE8")
        compose.onNodeWithText("Cabai 55 cepat mengering").assertDoesNotExist()
        compose.onNodeWithText("Kering terkonfirmasi").performClick()
        compose.onNodeWithText("Konfirmasi media kering, lalu siram bertahap dan catat volume").assertExists()
        screenshot("03-dashboard")
        // A dry pot offers one action: picking the amount records it, and Urungkan takes it back before it is sent.
        compose.onNode(hasText("Catat siram") and hasClickAction()).performScrollTo().performClick()
        compose.onNodeWithText("Simpan").performClick()
        compose.onNodeWithText("Siram dicatat", substring = true).assertExists()
        compose.onNodeWithText("Urungkan").performClick()
        compose.onNodeWithText("Siram dicatat", substring = true).assertDoesNotExist()
        compose.onNode(hasText("Catat siram") and hasClickAction()).assertExists()
        // Kondisi rows open that sensor's chart in place.
        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasText("Diagnostik sensor"))
        compose.onNodeWithText("Diagnostik sensor").performClick()
        compose.onNodeWithText("Data skenario latihan").assertIsDisplayed()
        compose.onAllNodesWithText("Waktu ukur:", substring = true).onFirst().assertIsDisplayed()
        compose.onAllNodesWithText("Waktu terima: Tidak tersedia").onFirst().assertIsDisplayed()
        compose.onNodeWithContentDescription("Tutup").performClick()
        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasText("pH tanah"))
        compose.onNodeWithText("pH tanah").performClick()
        compose.onNodeWithContentDescription("Telusuri bacaan pH tanah").assertExists()
        screenshot("03-trend-ph")
        compose.onNodeWithContentDescription("Tutup").performClick()
        compose.onNodeWithContentDescription("Ubah nama tanaman").performClick()
        compose.onNodeWithContentDescription("Nama tanaman").performTextReplacement("Cabai teras")
        compose.onNodeWithText("Simpan nama tanaman").performScrollTo().performClick()
        compose.onAllNodesWithText("Cabai teras").onFirst().assertExists()
        // Aktivitas keeps the plant that was open; its charts open the same chart sheet.
        compose.onNodeWithText("Aktivitas").performClick()
        compose.onNodeWithText("Cabai teras · T-CASE8").assertIsDisplayed()
        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasText("Jurnal"))
        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasText("pH tanah"))
        compose.onNodeWithText("pH tanah").performClick()
        compose.onNodeWithContentDescription("Telusuri bacaan pH tanah").assertExists()
        screenshot("04-history")
        compose.onNodeWithContentDescription("Tutup").performClick()
        compose.onNode(hasText("Akun") and hasClickAction()).performClick()
        compose.onNodeWithText("Mode latihan tanpa akun").assertIsDisplayed()
        compose.onNodeWithText("Putar animasi masuk").performScrollTo().assertIsDisplayed()
        screenshot("05-account")
        compose.onNodeWithText("Tanaman").performClick()
        compose.onNodeWithText("Tanaman saya").assertIsDisplayed()
        compose.onNode(hasText("Akun") and hasClickAction()).performClick()
        compose.onNodeWithText("Akhiri latihan").performScrollTo().performClick()
        screenshot("10-logout-return")
        compose.onNodeWithText("Smart Agro").assertIsDisplayed()
    }
    /** Account screens of a signed-in owner, for design review (the emulator tour can only show practice mode). */
    @Test fun accountScreensForReview() {
        fun set(transform: (AppState) -> AppState) = compose.runOnIdle {
            val model=androidx.lifecycle.ViewModelProvider(compose.activity)[AgroViewModel::class.java]
            val field=AgroViewModel::class.java.getDeclaredField("state\$delegate").apply { isAccessible=true }
            @Suppress("UNCHECKED_CAST")
            val state=field.get(model) as androidx.compose.runtime.MutableState<AppState>
            state.value=transform(state.value)
        }
        // First, from the signed-out start: the grace-period screen (a screen leaving mid-test may still run its effects).
        set { AppState(screen=Screen.DeletionPending,catalogLoaded=true,email="maliq@example.test",deletion=AccountDeletion(java.time.Instant.now(),java.time.Instant.parse("2026-12-06T04:00:00Z"),listOf("SA-POT-0001","SA-POT-0002"),listOf("SA-POT-0002"))) }
        compose.onNodeWithText("Batalkan penghapusan").assertIsDisplayed()
        screenshot("17-tenggang")
        val products=listOf(Product("00000000-0000-4000-8000-000000000001","SA-POT-0001","single_pot"),Product("00000000-0000-4000-8000-000000000002","SA-POT-0002","single_pot"))
        // busy: no session exists in the test, so a load would sign the state out (as the garden test does).
        set { AppState(screen=Screen.Account,busy=true,email="maliq@example.test",displayName="Maliq Athaya",products=products,catalogLoaded=true,
            securityLoaded=true,security=AccountSecurity(true,null,emptyList()),rewardLoaded=true) }
        compose.onNodeWithText("Maliq Athaya").assertIsDisplayed()
        screenshot("12-akun")
        set { it.copy(screen=Screen.Profile) }
        compose.onNodeWithText("Tambah foto").assertIsDisplayed()
        screenshot("13-profil")
        set { it.copy(screen=Screen.DeleteAccount) }
        compose.onNodeWithText("Sebelum menghapus akun").assertIsDisplayed()
        screenshot("14-hapus-1")
        // To the end of the list, as a person would: the last button then sits above the floating tab bar, not under it.
        repeat(4) { compose.onNode(hasScrollToNodeAction()).performTouchInput { swipeUp() } }
        compose.onNodeWithText("Lanjutkan").performClick()
        compose.onNodeWithText("Kode autentikator").assertExists()
        screenshot("15-hapus-2")
        set { it.copy(deletionScheduled=AccountDeletion(java.time.Instant.now(),java.time.Instant.parse("2026-12-06T04:00:00Z"),listOf("SA-POT-0001"),emptyList())) }
        screenshot("16-hapus-selesai")
    }
    @Test fun serverGardenUsesSpeciesCodeAndDoesNotInventDeviceMeasurements() {
        compose.runOnIdle {
            val model=androidx.lifecycle.ViewModelProvider(compose.activity)[AgroViewModel::class.java]
            val field=AgroViewModel::class.java.getDeclaredField("state\$delegate").apply { isAccessible=true }
            @Suppress("UNCHECKED_CAST")
            val state=field.get(model) as androidx.compose.runtime.MutableState<AppState>
            val plant=GardenPlant("cycle","site","slot","Jendela",null,"Anggrek ruang tamu",3,12,3000012,java.time.LocalDate.now().minusDays(12),null)
            state.value=AppState(screen=Screen.Products,busy=true,email="grower@example.test",catalogLoaded=true,
                garden=Garden(listOf(GardenSite("site","Pot ruang tamu","pot","indoor")),listOf(plant),0))
        }
        // The plants are the account's open plant cycles, not its sensor units (an account with a plant and no device has 1 plant).
        compose.onNodeWithText("1 tanaman · 0 produk").assertIsDisplayed()
        compose.onNodeWithText("Anggrek ruang tamu").performScrollTo().performClick()
        compose.onNodeWithText("AB-12 \u00b7 Anggrek bulan").assertIsDisplayed()
        compose.onNodeWithText("Mengamati \u00b7 profil perawatan spesies ini belum dikurasi.").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Belum ada unit sensor terhubung ke zona ini. Aplikasi tidak menampilkan bacaan atau saran perangkat tanpa data.").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Lihat sensor perangkat").assertDoesNotExist()
        screenshot("11-native-garden-orchid")
        compose.onNodeWithContentDescription("Kembali ke Tanaman").performClick()
        compose.onNodeWithText("Tanaman saya").assertIsDisplayed()
    }

}
