package id.smartagro.app

import android.app.Application
import android.graphics.Bitmap
import android.graphics.Color as AndroidColor
import android.view.WindowManager
import androidx.compose.runtime.MutableState
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.lifecycle.ViewModelProvider
import androidx.test.core.app.ApplicationProvider
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.time.Instant
import java.time.temporal.ChronoUnit
import java.util.UUID
import javax.crypto.KeyGenerator

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w390dp-h844dp-mdpi")
class NewWorkflowsAndScreensTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    private fun setState(transform: (AppState) -> AppState) {
        compose.runOnIdle {
            val model = ViewModelProvider(compose.activity)[AgroViewModel::class.java]
            val field = AgroViewModel::class.java.getDeclaredField("state\$delegate").apply { isAccessible = true }
            @Suppress("UNCHECKED_CAST")
            val state = field.get(model) as MutableState<AppState>
            state.value = transform(state.value)
        }
    }

    private val secureFlag get() = compose.activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0

    @Test fun speciesCatalogSearchAndPhasesMatchContract() {
        assertEquals(4, SpeciesCatalog.all.size)
        assertEquals(3, SpeciesCatalog.plantable.size)
        assertFalse(SpeciesCatalog.byId("peoni")!!.plantable)
        assertEquals(1, SpeciesCatalog.search("lombok").first().speciesId)
        assertEquals(3, SpeciesCatalog.search("phalaenopsis").first().speciesId)
        val chiliPhases = SpeciesCatalog.phaseRanges(1)
        assertEquals(listOf("0" to "Awal tanam", "1–30" to "Vegetatif", "31–55" to "Berbunga", "56–90" to "Berbuah"), chiliPhases)
    }

    @Test fun observationEngineReachesLevel1WithDeterministicStats() {
        val anchor = Instant.parse("2026-11-01T01:00:00Z") // 08:00 local-offset (+7 = 08:00)
        // Build 9 days of daytime moisture points + 2 waterings + 3 checks
        val samples = mutableListOf<ReadingPoint>()
        for (day in 0..8) {
            val baseH = day * 24.0
            samples.add(ReadingPoint(baseH + 3.0, 58.0, true)) // tH%24=3 -> 06+3=9
            samples.add(ReadingPoint(baseH + 5.0, 54.0, true)) // tH%24=5 -> 11
            samples.add(ReadingPoint(baseH + 7.0, 50.0, true)) // tH%24=7 -> 13
        }
        // Watering spikes at day 1 h=5.5 and day 4 h=5.5
        samples.add(ReadingPoint(29.5, 53.0, true))
        samples.add(ReadingPoint(30.5, 73.0, true))
        samples.add(ReadingPoint(101.5, 52.0, true))
        samples.add(ReadingPoint(102.5, 72.0, true))

        val checks = listOf(
            Inspection(2.0, InspectionState.Sehat),
            Inspection(48.0, InspectionState.Sehat),
            Inspection(120.0, InspectionState.Biasa),
        )
        val summary0 = ObservationEngine.summarize("Anggrek bulan", samples.take(4), checks.take(1), listOf(30.0))
        assertEquals(0, summary0.evidence.level)
        assertTrue(summary0.text.contains("Smart Agro belum punya acuan untuk Anggrek bulan"))

        val summary1 = ObservationEngine.summarize("Anggrek bulan", samples, checks, listOf(30.0, 102.0)) { hours ->
            val local = anchor.plusSeconds((hours * 3600).toLong()).atOffset(java.time.ZoneOffset.ofHours(7)).toLocalTime()
            local.toSecondOfDay() / 3600.0
        }
        assertEquals(1, summary1.evidence.level)
        assertNotNull(summary1.evidence.healthy)
        assertNotNull(summary1.evidence.dryingPerHour)
        assertNotNull(summary1.evidence.waterRise)
        assertEquals(ORIGIN_LABEL, summary1.originLabel)
        assertTrue(summary1.text.contains("pola pot Anda, bukan standar tanaman"))
    }

    @Test fun ownedUnitsWorkspaceAndPublicStatusParsersWork() {
        val u1 = UUID.randomUUID().toString()
        val u2 = UUID.randomUUID().toString()
        val p1 = UUID.randomUUID().toString()
        val d1 = UUID.randomUUID().toString()
        val json = JSONObject().put("ok", true)
            .put("units", JSONArray()
                .put(JSONObject().put("unit_id", u1).put("product_id", p1).put("location_label", "Teras").put("species_variety", "Cabai").put("archived_at", JSONObject.NULL))
                .put(JSONObject().put("unit_id", u2).put("product_id", p1).put("location_label", "Gudang").put("species_variety", "Bawang").put("archived_at", "2026-11-10T00:00:00Z")))
            .put("devices", JSONArray()
                .put(JSONObject().put("device_id", d1).put("product_id", p1).put("unit_id", u1).put("status", "active").put("placed_at", "2026-11-10T00:00:00Z")))
        val ws = parseOwnedUnitsWorkspace(json)
        assertEquals(1, ws.active.size)
        assertEquals("Teras", ws.active.first().name)
        assertEquals(1, ws.archived.size)
        assertEquals("Gudang", ws.archived.first().name)
        assertEquals(u1, ws.devices.first().unitId)

        val pub = parseProductPublicStatus(JSONObject().put("ok", true).put("serial_public", "SA-9001").put("variant", "garden").put("registry_status", "active").put("claimed", false).put("issuer_verified", true))
        assertEquals("SA-9001", pub.serial)
        assertFalse(pub.claimed)
        assertTrue(pub.issuerVerified)
    }

    @Test fun sessionStorePayloadRequestIsIdempotentAcrossReopenAndClearsOnFinish() {
        val ctx = ApplicationProvider.getApplicationContext<Application>()
        val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val scope = "https://example.supabase.co/${UUID.randomUUID()}"
        val s1 = SessionStore(ctx, scope) { key }
        val h1 = payloadHash("Kebun A", "garden", "outdoor")
        val h2 = payloadHash("Kebun B", "garden", "outdoor")

        val id1 = s1.payloadRequest("u@example.test", "garden-site", "new-site", h1)
        val s2 = SessionStore(ctx, scope) { key }
        assertEquals(id1, s2.payloadRequest("u@example.test", "garden-site", "new-site", h1))
        assertNotEquals(id1, s2.payloadRequest("u@example.test", "garden-site", "new-site", h2))

        s2.finishPayloadRequest("u@example.test", "garden-site", "new-site", h1)
        assertNotEquals(id1, s2.payloadRequest("u@example.test", "garden-site", "new-site", h1))
    }

    @Test fun qrEncodeAndDecodeRoundtripExtractsProductSerial() {
        val raw = "https://smart-agro-demo.pages.dev/?serial=SA-2026-XYZ&extra=ignored"
        val matrix = encodeQrMatrix(raw)!!
        val scale = 8
        val pad = 16
        val imgSize = matrix.side * scale + pad * 2
        val bmp = Bitmap.createBitmap(imgSize, imgSize, Bitmap.Config.ARGB_8888)
        bmp.eraseColor(AndroidColor.WHITE)
        for (y in 0 until matrix.side) {
            for (x in 0 until matrix.side) {
                if (matrix.dark[y * matrix.side + x]) {
                    for (dy in 0 until scale) for (dx in 0 until scale) {
                        bmp.setPixel(pad + x * scale + dx, pad + y * scale + dy, AndroidColor.BLACK)
                    }
                }
            }
        }
        val decoded = decodeQrFromBitmap(bmp)
        assertEquals(raw, decoded)
        val scan = parseProductScan(decoded!!)
        assertEquals("SA-2026-XYZ", scan.serial)
        assertTrue(scan.hasExtraParameters)
    }

    @Test fun flagSecureProtectsTotpRecoveryCodesTransferAndChallenge() {
        setState {
            it.copy(
                screen = Screen.Security,
                email = "owner@example.test",
                securityLoaded = true,
                totpEnrollment = TotpEnrollment("factor-1", "JBSWY3DPEHPK3PXP", "otpauth://totp/SmartAgro:owner?secret=JBSWY3DPEHPK3PXP"),
            )
        }
        compose.waitForIdle()
        assertTrue("TOTP enrollment sheet must block screenshots", secureFlag)

        setState { it.copy(totpEnrollment = null, generatedRecoveryCodes = listOf("AAAA-BBBB-CCCC")) }
        compose.waitForIdle()
        assertTrue("Recovery codes display must block screenshots", secureFlag)

        setState {
            it.copy(
                generatedRecoveryCodes = null,
                screen = Screen.ManageProducts,
                recoveriesLoaded = true,
                activeTransfer = TransferOffer("tx-1", "0123456789ABCDEF0123456789ABCDEF", Instant.now().plusSeconds(600)),
            )
        }
        compose.waitForIdle()
        assertTrue("Active transfer code must block screenshots", secureFlag)

        setState {
            it.copy(
                activeTransfer = null,
                activationChallenge = ActivationChallenge(UUID.randomUUID().toString(), "CHALLENGE-TEXT", Instant.now().plusSeconds(300)),
            )
        }
        compose.waitForIdle()
        assertTrue("Activation challenge with sealed code input must block screenshots", secureFlag)

        setState { it.copy(activationChallenge = null) }
        compose.waitForIdle()
        assertFalse("Clearing sensitive overlays lifts FLAG_SECURE", secureFlag)
    }

    @Test fun modeBelajarRecordsInspectionInDemoDashboard() {
        val prod = Product(UUID.randomUUID().toString(), "SA-ORCHID", "single_pot")
        val unit = PlantUnit(UUID.randomUUID().toString(), prod.id, "Anggrek Jendela", "Anggrek bulan")
        setState {
            it.copy(
                screen = Screen.Dashboard,
                demo = true,
                catalogLoaded = true,
                products = listOf(prod),
                units = listOf(unit),
                selectedProduct = prod,
                selectedUnit = unit,
                historyLoaded = true,
            )
        }
        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasText(ORIGIN_LABEL))
        compose.onNodeWithText(ORIGIN_LABEL).assertIsDisplayed()
        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasText("Sehat"))
        // Scrolling to the next section lifts the buttons clear of the floating tab bar, which would take the tap.
        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasText("Kondisi"))
        compose.onNodeWithText("Sehat").performClick()
        compose.onNode(hasScrollToNodeAction()).performScrollToNode(hasText("Pengecekan terakhir: sehat."))
        compose.onNodeWithText("Pengecekan terakhir: sehat.").assertIsDisplayed()
    }

    @Config(sdk = [34], qualifiers = "w320dp-h640dp-mdpi")
    @Test fun securityAndProductsTitlesWrapInside320dpAt2xScale() {
        compose.runOnIdle {
            val resources = compose.activity.resources
            val config = android.content.res.Configuration(resources.configuration).apply { fontScale = 2f }
            @Suppress("DEPRECATION")
            resources.updateConfiguration(config, resources.displayMetrics)
        }
        compose.activityRule.scenario.recreate()
        for ((screen, title) in listOf(Screen.Security to "Keamanan", Screen.ManageProducts to "Produk & kepemilikan")) {
            setState {
                it.copy(
                    screen = screen,
                    email = "owner@example.test",
                    securityLoaded = true,
                    recoveriesLoaded = true,
                )
            }
            val node = compose.onNodeWithText(title).assertIsDisplayed()
            val layouts = mutableListOf<TextLayoutResult>()
            node.performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
            val layout = layouts.single()
            assertEquals("$title full text rendered", title.length, layout.getLineEnd(layout.lineCount - 1, visibleEnd = true))
            val bounds = node.fetchSemanticsNode().boundsInRoot
            assertTrue("$title fits 320dp: $bounds", bounds.left >= 0 && bounds.right <= 320)
        }
    }
}
