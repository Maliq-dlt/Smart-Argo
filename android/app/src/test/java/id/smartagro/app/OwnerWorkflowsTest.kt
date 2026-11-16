package id.smartagro.app

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.time.Instant
import javax.crypto.KeyGenerator

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34], shadows=[WindowsAtomicFileShadow::class])
class OwnerWorkflowsTest {
    private val id = "00000000-0000-4000-8000-000000000001"
    private fun rejected(block: () -> Unit) {
        try { block(); fail("Invalid contract accepted") } catch (_: IllegalArgumentException) { }
    }
    @Test fun publicQrNeverImportsSecretsAndRejectsAmbiguousSerials() {
        assertEquals(ProductScan("SA-01", false), parseProductScan(" sa-01 "))
        assertEquals(ProductScan("SA-01", true), parseProductScan("https://example.test/?serial=sa-01&sealed_code=private#ekosistem"))
        listOf("javascript:alert(1)", "https://x.test/?serial=SA1&serial=SA2", "https://x.test/?serial=%20", "x".repeat(2049)).forEach {
            rejected { parseProductScan(it) }
        }
    }
    @Test fun challengeExpiryOffsetsAndSecretRedactionMatchServer() {
        val now = Instant.parse("2026-11-16T00:00:00Z")
        fun challenge(at: String) = JSONObject().put("nonce_id", id).put("challenge", "private-challenge").put("expires_at", at)
        val parsed = parseActivationChallenge(challenge("2026-11-16T00:05:00+00:00"), now)
        assertEquals(now.plusSeconds(300), parsed.expiresAt)
        assertFalse(parsed.toString().contains("private-challenge"))
        rejected { parseActivationChallenge(challenge("2026-11-16T00:00:00Z"), now) }
        rejected { parseActivationChallenge(challenge("2026-11-16T00:10:01Z"), now) }
        val offer = parseTransferOffer(JSONObject().put("ok", true).put("transfer_id", id).put("code", "A".repeat(32)).put("expires_at", "2026-11-17T00:00:00+00:00"))
        assertFalse(offer.toString().contains("A".repeat(32)))
    }
    @Test fun recoveryEvidenceAllowsOnlyBoundedReferencesAndNoSecretLogging() {
        val evidence = RecoveryEvidence("receipt", "receipt-private-123", "a".repeat(64))
        assertEquals("receipt-private-123", evidence.toJson().getString("reference"))
        assertFalse(evidence.toString().contains("receipt-private-123"))
        rejected { RecoveryEvidence("upload", "x").toJson() }
        rejected { RecoveryEvidence("photo", "x", "A".repeat(64)).toJson() }
        rejected { RecoveryEvidence("photo", "x".repeat(241)).toJson() }
        val unicodeReference = String(Character.toChars(0x1F331)).repeat(240)
        val unicodeEvidence = RecoveryEvidence("photo", unicodeReference)
        val recovery = JSONObject().put("id", id).put("serial_public", "SA-01").put("statement", "A valid ownership recovery statement.")
            .put("evidence", JSONArray().put(unicodeEvidence.toJson())).put("status", "open")
            .put("decision_reason", JSONObject.NULL).put("created_at", "2026-11-16T00:00:00Z").put("closed_at", JSONObject.NULL)
        assertEquals(unicodeReference, parseOwnershipRecoveries(JSONObject().put("ok", true).put("cases", JSONArray().put(recovery))).single().evidence.single().reference)

    }
    @Test fun communityRetainsUncuratedLabelAndRejectsLeakingOrUnroundedAggregates() {
        fun response() = JSONObject("""{"ok":true,"label":"belum dikurasi","source":"komunitas","species_id":1,"zones":[{"zone":"tropis","cycles":5,"owners":3,"watering_interval_days":{"low":1,"median":1.5,"high":2},"moisture":{"low":45,"high":45}}]}""")
        assertEquals(45L, parseCommunityKnowledge(response()).zones.single().moistureLow)
        // Independent medians rounded to 5 may legitimately coincide; do not turn that into a false recommendation.
        rejected { parseCommunityKnowledge(response().put("label", "rekomendasi")) }
        rejected { parseCommunityKnowledge(response().also { it.getJSONArray("zones").getJSONObject(0).put("owners", 2) }) }
        rejected { parseCommunityKnowledge(response().also { it.getJSONArray("zones").getJSONObject(0).getJSONObject("moisture").put("low", 47) }) }
    }
    @Test fun energyRequiresVerifiedAlignedQuarterHours() {
        fun response() = JSONObject().put("ok", true).put("roles", JSONArray().put("owner")).put("meters", JSONArray())
            .put("windows", JSONArray().put(JSONObject().put("id", id).put("device_id", id).put("meter_id", id)
                .put("start_at", "2026-11-16T00:00:00+00:00").put("end_at", "2026-11-16T00:15:00Z")
                .put("received_at", "2026-11-16T00:15:01Z").put("solar_harvest_wh", 2).put("load_wh", 1)
                .put("battery_soc_pct", JSONObject.NULL).put("evidence_quality", "verified_meter")
                .put("credited_points", 0).put("reward_reason", "below_threshold")))
        assertEquals(2.0, parseEnergyEvidence(response()).windows.single().solarHarvestWh, 0.0)
        rejected { parseEnergyEvidence(response().also { it.getJSONArray("windows").getJSONObject(0).put("end_at", "2026-11-16T00:30:00Z") }) }
        rejected { parseEnergyEvidence(response().also { it.getJSONArray("windows").getJSONObject(0).put("evidence_quality", "forecast") }) }
        rejected { parseEnergyEvidence(response().also { it.getJSONArray("windows").getJSONObject(0).put("start_at", "2026-11-16T00:00:00.000000001Z").put("end_at", "2026-11-16T00:15:00.000000001Z") }) }
    }
    @Test fun anomalyCasesAndWithdrawalReadRealNullableContract() {
        val row = JSONObject().put("id", id).put("kind", "anomaly").put("energy_window_id", id).put("redemption_id", JSONObject.NULL)
            .put("statement", JSONObject.NULL).put("status", "open").put("decision_reason", JSONObject.NULL)
            .put("credited_points", JSONObject.NULL).put("created_at", "2026-11-16T00:00:00+00:00").put("decided_at", JSONObject.NULL)
        assertEquals("anomaly", parseRewardCases(JSONObject().put("ok", true).put("cases", JSONArray().put(row))).single().kind)
        rejected { parseRewardCases(JSONObject().put("ok", true).put("cases", JSONArray().put(row.put("kind", "appeal")))) }
    }
    @Test fun writesValidateBeforeNetworkAndKeepCallerRequestIdentity() = runBlocking {
        val sent = mutableListOf<Pair<String, JSONObject>>()
        val response = JSONObject().put("ok", true).put("case_id", id).put("status", "open").put("idempotent", true)
        val context = ApplicationProvider.getApplicationContext<Context>()
        val endpoint = "https://owner-contract.test"
        val key = KeyGenerator.getInstance("AES").apply { init(256) }.generateKey()
        val store = SessionStore(context, endpoint) { key }
        val api = AgroApi(BackendConfig(endpoint, "sb_publishable_contract_test"), store) { uri ->
            object : HttpURLConnection(uri.toURL()) {
                private val output = ByteArrayOutputStream()
                override fun connect() { }
                override fun disconnect() { }
                override fun usingProxy() = false
                override fun getOutputStream() = output
                override fun getResponseCode(): Int {
                    sent += uri.path to if(output.size() == 0) JSONObject() else JSONObject(output.toString("UTF-8"))
                    return 200
                }
                override fun getInputStream() = ByteArrayInputStream(
                    (if(uri.path == "/auth/v1/user") JSONObject().put("email", "owner@example.test").put("factors", JSONArray()) else response).toString().toByteArray()
                )
            }
        }
        store.save(Session("access-owner", "refresh-owner", Instant.now().epochSecond + 3600, "owner@example.test"))
        assertTrue(api.restore())
        sent.clear()
        try { api.openRewardAppeal(id, "appeal"); fail("Two null subjects") } catch (_: IllegalArgumentException) { }
        try { api.shareCycle(id, id, Double.NaN, 30.0, 60.0); fail("NaN") } catch (_: IllegalArgumentException) { }
        try { api.claimProduct(id, "secret", "bad"); fail("Bad proof") } catch (_: IllegalArgumentException) { }
        assertTrue(sent.isEmpty())
        repeat(2) { api.openRewardAppeal(id, " appeal ", energyWindowId=id) }
        assertEquals(2, sent.size)
        sent.forEach {
            assertEquals("/rest/v1/rpc/open_reward_appeal", it.first)
            assertEquals(id, it.second.getString("p_request_id"))
            assertEquals(id, it.second.getString("p_energy_window_id"))
            assertTrue(it.second.has("p_redemption_id") && it.second.isNull("p_redemption_id"))
            assertEquals("appeal", it.second.getString("p_statement"))
        }
        store.clear()
    }
}
