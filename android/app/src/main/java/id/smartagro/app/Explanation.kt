package id.smartagro.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
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
            if(value.has("answer") && value.isNull("answer")) null else value.bounded("answer",1000))
    } else { require(status!="ok" && !d.has("ai")); null }
    val hash=json.text("context_sha256",64)
    require(Regex("[0-9a-f]{64}").matches(hash))
    return UnitExplanation(json.id("id"),json.instant("created_at"),evidence.instant("evaluated_at"),hash,profile,
        evidence.id("unit_id"),evidence.id("device_id"),decision,d.text("action",8000),d.text("reason",8000),
        d.text("explanation",8000),source,status,evidence.bounded("question",500),ai)
}
internal fun parseUnitExplanations(json: JSONObject): List<UnitExplanation> =
    json.array("snapshots").objects(10).map(::parseExplanationSnapshot)

@Composable internal fun ExplanationSection(explanation: UnitExplanation?,busy: Boolean,message: String?,load: ()->Unit,
    explain: (String)->Unit,available: Boolean) {
    var question by remember { mutableStateOf("") }
    var evidence by remember { mutableStateOf(false) }
    Surface(shape=RoundedCornerShape(24.dp),color=MaterialTheme.colorScheme.surfaceVariant) {
        Column(Modifier.fillMaxWidth().padding(20.dp),verticalArrangement=Arrangement.spacedBy(10.dp)) {
            Text("Penjelasan berbasis bukti",style=MaterialTheme.typography.titleLarge)
            Text("Penilaian memakai bacaan perangkat dan versi profil saat diminta. Emosi maskot adalah petunjuk antarmuka, bukan emosi biologis tanaman.",style=MaterialTheme.typography.bodySmall)
            if(!available) Text("Hubungkan unit dengan perangkat milik akun untuk meminta penjelasan.")
            if(busy) LinearProgressIndicator(Modifier.fillMaxWidth())
            message?.let { Text(it,color=MaterialTheme.colorScheme.error) }
            OutlinedTextField(question,{question=it.take(500)},label={Text("Pertanyaan atau pengamatan (opsional)")},
                enabled=available && !busy,modifier=Modifier.fillMaxWidth(),supportingText={Text("${question.length}/500")})
            Button(onClick={explain(question.trim())},enabled=available && !busy) { Text("Buat penjelasan berbasis bukti") }
            TextButton(onClick=load,enabled=!busy) { Text("Muat penjelasan tersimpan") }
            explanation?.let { result ->
                Text(result.action,style=MaterialTheme.typography.titleMedium)
                Text(result.reason)
                Text("Dinilai ${time(result.evaluatedAt)}. Rekaman penilaian, bukan pemantauan langsung.",style=MaterialTheme.typography.bodySmall)
                Text(result.explanation)
                result.ai?.let { ai ->
                    Text("Penjelasan AI",style=MaterialTheme.typography.titleMedium)
                    Text(ai.explanation)
                    ai.answer?.takeIf { it.isNotBlank() }?.let { Text("Jawaban: $it") }
                    Text("${ai.model} · ${ai.promptVersion}. AI menjelaskan hasil aturan; tindakan tetap dari aturan.",style=MaterialTheme.typography.bodySmall)
                } ?: Text(when(result.aiStatus) {
                    "failed" -> "AI tidak tersedia saat diminta; penjelasan berasal dari aturan."
                    "refused" -> "AI menolak permintaan ini; penjelasan berasal dari aturan."
                    "rejected" -> "Jawaban AI tidak lolos pemeriksaan; penjelasan berasal dari aturan."
                    else -> "Layanan AI belum dikonfigurasi; penjelasan berasal dari aturan."
                },style=MaterialTheme.typography.bodySmall)
                TextButton(onClick={evidence=!evidence}) { Text(if(evidence) "Tutup bukti penilaian" else "Lihat bukti penilaian") }
                if(evidence) {
                    Text("Kode: ${result.decision} · agronomy-v1.telemetry-v1",style=MaterialTheme.typography.bodySmall)
                    Text("Profil versi ${result.profileVersion}",style=MaterialTheme.typography.bodySmall)
                    Text("Pertanyaan: ${result.question.ifBlank { "Tidak ada" }}",style=MaterialTheme.typography.bodySmall)
                    Text("Snapshot ${result.id} · Disimpan ${time(result.createdAt)}",style=MaterialTheme.typography.bodySmall)
                    Text("SHA256 konteks ${result.contextSha}",style=MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}
