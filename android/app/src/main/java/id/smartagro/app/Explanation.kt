package id.smartagro.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.unit.dp
import org.json.JSONObject
import java.time.Instant

data class ExplanationAi(val model: String,val promptVersion: String,val explanation: String,val answer: String?)
data class UnitExplanation(val id: String,val createdAt: Instant,val evaluatedAt: Instant,val contextSha: String,
    val profileVersion: String,val unitId: String,val deviceId: String,val decision: String,val action: String,val reason: String,
    val explanation: String,val sourceMode: String,val aiStatus: String,val question: String,val ai: ExplanationAi?)

private fun JSONObject.choice(key: String, options: List<String>) = text(key,80).also { require(it in options) { "Hasil penjelasan tidak valid." } }
private fun JSONObject.bounded(key: String,max: Int) = (opt(key) as? String)?.also {
    require(it.length<=max && it.none { c -> c.isISOControl() && c!='\n' && c!='\r' && c!='\t' }) { "Teks penjelasan tidak valid." }
} ?: throw IllegalArgumentException("Teks penjelasan tidak valid.")

internal fun parseExplanationSnapshot(json: JSONObject): UnitExplanation {
    val evidence=json.getJSONObject("evidence_ref")
    require(evidence.opt("ok")==true)
    val profile=json.id("profile_version_id")
    require(profile==evidence.id("profile_version_id")) { "Versi bukti penjelasan tidak sesuai." }
    evidence.id("ownership_id")
    evidence.choice("device_status",listOf("active","revoked","offline"))
    evidence.choice("registry_status",listOf("active","revoked","pending"))
    // Only identity, evaluation time and question are shown; raw packets never become current sensor values here.
    evidence.array("packets").objects(120)
    val d=json.getJSONObject("decision_payload")
    val decision=d.choice("decision",listOf("DATA_BELUM_ADA","PROFIL_BELUM_LAYAK","KALIBRASI_LOKAL","PULIHKAN_DATA","PERIKSA_SENSOR","PERIKSA_SIRAMAN","PERIKSA_DRAINASE","PERIKSA_MEDIA_KERING","PERIKSA_PANAS","UKUR_ULANG_PH","PERIKSA_SEBELUM_PERGI","AMATI"))
    d.choice("mascot_state",listOf("bingung_menunggu","tenang_senang","sedih_perhatian","waspada_marah"))
    require(d.text("rule_version",64)=="agronomy-v1.telemetry-v1")
    val source=d.choice("source_mode",listOf("rule_fallback","ai_explained"))
    val status=d.choice("ai_status",listOf("not_configured","ok","failed","refused","rejected"))
    val ai=if(source=="ai_explained") {
        require(status=="ok")
        val value=d.getJSONObject("ai")
        val model=value.text("model",80)
        require(Regex("[A-Za-z0-9][A-Za-z0-9./:_-]{0,79}").matches(model))
        ExplanationAi(model,value.bounded("prompt_version",64),value.text("explanation",2000),
            if(value.isNull("answer")) null else value.bounded("answer",1000))
    } else { require(status!="ok" && !d.has("ai")); null }
    val hash=json.text("context_sha256",64)
    require(Regex("[0-9a-f]{64}").matches(hash))
    return UnitExplanation(json.id("id"),json.instant("created_at"),evidence.instant("evaluated_at"),hash,profile,
        evidence.id("unit_id"),evidence.id("device_id"),decision,d.text("action",8000),d.text("reason",8000),
        d.text("explanation",8000),source,status,evidence.bounded("question",500),ai)
}
internal fun parseUnitExplanations(json: JSONObject): List<UnitExplanation> =
    json.array("snapshots").objects(10).map(::parseExplanationSnapshot)

/** Why the advice says what it says: the stored rule result, the AI's wording of it when allowed, and the evidence. */
@Composable internal fun ExplanationSection(explanation: UnitExplanation?,busy: Boolean,message: String?,load: ()->Unit,
    explain: (String)->Unit,available: Boolean) {
    val p = palette
    var question by rememberSaveable { mutableStateOf("") }
    var evidence by rememberSaveable { mutableStateOf(false) }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        message?.let { Banner(it, Modifier.padding(horizontal = 16.dp), error = true) }
        if (!available) Footnote("Hubungkan unit dengan perangkat milik akun untuk meminta penjelasan.")
        explanation?.let { result ->
            Panel {
                Text(result.action, style = T.title3, color = p.ink)
                Text(result.reason, style = T.body, color = p.secondary, modifier = Modifier.padding(top = 4.dp))
                Text(result.explanation, style = T.body, color = p.ink, modifier = Modifier.padding(top = 12.dp))
                result.ai?.let { ai ->
                    Row(Modifier.padding(top = 16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Icon(icon(PhosphorPaths.Sparkle), null, Modifier.size(18.dp), tint = p.tint)
                        Text("Penjelasan AI", style = T.headline, color = p.ink)
                    }
                    Text(ai.explanation, style = T.body, color = p.ink, modifier = Modifier.padding(top = 6.dp))
                    ai.answer?.takeIf { it.isNotBlank() }?.let { Text("Jawaban: $it", style = T.body, color = p.ink, modifier = Modifier.padding(top = 6.dp)) }
                    Text("${ai.model} \u00b7 ${ai.promptVersion}. AI menjelaskan hasil aturan; tindakan tetap dari aturan.", style = T.footnote, color = p.secondary, modifier = Modifier.padding(top = 6.dp))
                } ?: Text(when(result.aiStatus) {
                    "failed" -> "AI tidak tersedia saat diminta; penjelasan berasal dari aturan."
                    "refused" -> "AI menolak permintaan ini; penjelasan berasal dari aturan."
                    "rejected" -> "Jawaban AI tidak lolos pemeriksaan; penjelasan berasal dari aturan."
                    else -> "Layanan AI belum dikonfigurasi; penjelasan berasal dari aturan."
                }, style = T.footnote, color = p.secondary, modifier = Modifier.padding(top = 12.dp))
                Text("Dinilai ${time(result.evaluatedAt)}. Rekaman penilaian, bukan pemantauan langsung.", style = T.footnote, color = p.secondary, modifier = Modifier.padding(top = 6.dp))
            }
            Group {
                Cell(if (evidence) "Tutup bukti penilaian" else "Lihat bukti penilaian", chevron = false, onClick = { evidence = !evidence })
                if (evidence) {
                    Cell("Kode", subtitle = "${result.decision} \u00b7 agronomy-v1.telemetry-v1")
                    Cell("Profil", subtitle = "Versi ${result.profileVersion}")
                    Cell("Pertanyaan", subtitle = result.question.ifBlank { "Tidak ada" })
                    Cell("Snapshot", subtitle = "${result.id} \u00b7 Disimpan ${time(result.createdAt)}")
                    Cell("SHA256 konteks", subtitle = result.contextSha)
                }
            }
        }
        Group(footer = "${question.length}/500 \u00b7 Penilaian memakai bacaan perangkat dan versi profil saat diminta.") {
            BasicTextField(question, { question = it.take(500) }, Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(horizontal = 16.dp, vertical = 15.dp),
                enabled = available && !busy, textStyle = T.body.copy(color = p.ink), cursorBrush = SolidColor(p.tint),
                decorationBox = { field -> Box { if (question.isEmpty()) Text("Pertanyaan atau pengamatan (opsional)", style = T.body, color = p.secondary); field() } })
        }
        PrimaryButton("Buat penjelasan berbasis bukti", { explain(question.trim()) }, Modifier.padding(horizontal = 16.dp).fillMaxWidth(),
            enabled = available && !busy, busy = busy, path = PhosphorPaths.Sparkle)
        PlainButton("Muat penjelasan tersimpan", load, Modifier.padding(horizontal = 16.dp).fillMaxWidth(), enabled = !busy)
    }
}
