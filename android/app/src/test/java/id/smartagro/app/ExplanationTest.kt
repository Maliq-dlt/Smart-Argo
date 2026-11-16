package id.smartagro.app

import org.json.JSONObject
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test

class ExplanationTest {
    private val id="00000000-0000-4000-8000-000000000001"
    private fun snapshot(): JSONObject {
        val evidence=JSONObject().put("ok",true).put("unit_id",id).put("device_id",id).put("ownership_id",id)
            .put("profile_version_id",id).put("evaluated_at","2026-11-16T07:00:00+07:00").put("question","")
            .put("device_status","active").put("registry_status","active").put("packets",JSONArray())
        val decision=JSONObject().put("decision","DATA_BELUM_ADA").put("action","Tunggu bacaan perangkat")
            .put("reason","Belum ada paket").put("explanation","Penjelasan aturan.").put("mascot_state","bingung_menunggu")
            .put("rule_version","agronomy-v1.telemetry-v1").put("source_mode","rule_fallback").put("ai_status","not_configured")
        return JSONObject().put("id",id).put("created_at","2026-11-16T00:00:01Z").put("profile_version_id",id)
            .put("context_sha256","a".repeat(64)).put("evidence_ref",evidence).put("decision_payload",decision)
    }
    private fun rejects(row: JSONObject) {
        try { parseExplanationSnapshot(row); fail("Invalid snapshot accepted") }
        catch (_: IllegalArgumentException) { }
        catch (_: org.json.JSONException) { }
    }
    @Test fun storedRuleSnapshotPreservesIdentityAndDoesNotInventAi() {
        val row=parseExplanationSnapshot(snapshot().put("future_extra",true))
        assertEquals(id,row.unitId); assertEquals(id,row.deviceId)
        assertEquals("2026-11-16T00:00:00Z",row.evaluatedAt.toString())
        assertEquals("rule_fallback",row.sourceMode); assertNull(row.ai)
        assertEquals("",row.question)
        assertEquals(1,parseUnitExplanations(JSONObject().put("snapshots",JSONArray().put(snapshot()))).size)
    }
    @Test fun aiRequiresCheckedStatusAndBoundedTextWhileActionRemainsRuleOutput() {
        val row=snapshot()
        val decision=row.getJSONObject("decision_payload")
        decision.put("source_mode","ai_explained").put("ai_status","ok").put("ai",JSONObject()
            .put("model","model-v1").put("prompt_version","v1").put("explanation","AI menjelaskan bukti.").put("answer",JSONObject.NULL))
        assertEquals("model-v1",parseExplanationSnapshot(row).ai!!.model)
        assertEquals("Tunggu bacaan perangkat",parseExplanationSnapshot(row).action)
        decision.put("ai_status","failed"); rejects(row)
        decision.put("ai_status","ok").getJSONObject("ai").put("answer","x".repeat(1001)); rejects(row)
    }
    @Test fun invalidIdentityEnumsQuestionsAndOversizedHistoryAreRejected() {
        rejects(snapshot().put("id","not-an-id"))
        rejects(snapshot().put("context_sha256","z".repeat(64)))
        rejects(snapshot().also { it.getJSONObject("evidence_ref").put("profile_version_id","00000000-0000-4000-8000-000000000002") })
        rejects(snapshot().also { it.getJSONObject("evidence_ref").put("question","x".repeat(501)) })
        rejects(snapshot().also { it.getJSONObject("decision_payload").put("decision","FAKE") })
        rejects(snapshot().also { it.getJSONObject("decision_payload").put("ai_status","ok") })
        rejects(snapshot().also { it.getJSONObject("decision_payload").put("reason","") })
        val rows=JSONArray(); repeat(11) { rows.put(snapshot()) }
        try { parseUnitExplanations(JSONObject().put("snapshots",rows)); fail("Oversized history accepted") }
        catch (_: IllegalArgumentException) { }
    }
}
