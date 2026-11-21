package id.smartagro.app

import java.text.DecimalFormat
import java.text.DecimalFormatSymbols
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.util.Locale
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.pow
import kotlin.math.round
import kotlin.math.roundToLong

enum class InspectionState(val key: String, val label: String) {
    Sehat("sehat", "Sehat"),
    Biasa("biasa", "Biasa"),
    Bermasalah("bermasalah", "Bermasalah");

    companion object {
        fun fromJournalNotes(notes: String): InspectionState? {
            val lower = notes.trim().lowercase(Locale.ROOT)
            return entries.find { lower.startsWith("[${it.key}]") || lower == it.key || lower.startsWith("${it.key} ") || lower.startsWith("${it.key}:") }
        }
    }
}

data class Inspection(val tH: Double, val state: InspectionState, val note: String = "")
data class ReadingPoint(val tH: Double, val moisture: Double, val valid: Boolean)
data class ObservationThresholds(val days: Int = 7, val inspections: Int = 3, val waterings: Int = 2)
data class Observation(val days: Int, val readings: Int, val waterings: Int, val inspections: List<Inspection>)

data class LearningEvidence(
    val speciesName: String,
    val level: Int,
    val days: Int,
    val readings: Int,
    val waterings: Int,
    val inspections: Int,
    val healthy: Pair<Int, Int>?,
    val dryingPerHour: Double?,
    val waterRise: Double?,
    val missingDays: Int,
    val missingInspections: Int,
    val missingWaterings: Int,
)

data class LearningSummary(
    val evidence: LearningEvidence,
    val text: String,
    val nextAction: String,
    val originLabel: String = ORIGIN_LABEL,
)

internal const val ORIGIN_LABEL = "Berdasarkan pola pot Anda, bukan standar tanaman."

internal object ObservationEngine {
    val THRESHOLDS = ObservationThresholds()
    private const val BEFORE_H = 2.0
    private const val AFTER_H = 3.0
    private const val HEALTHY_WINDOW_H = 6.0
    private const val MIN_HEALTHY_READINGS = 3
    private const val DAY_FROM = 8
    private const val DAY_TO = 16
    private const val MAX_GAP_H = 1.5
    private const val MIN_PAIRS = 2
    private val ID_FORMAT = DecimalFormat("#.##", DecimalFormatSymbols(Locale.forLanguageTag("id-ID")))

    private fun usable(samples: List<ReadingPoint>) = samples.filter { it.valid && it.tH.isFinite() && it.moisture.isFinite() }.sortedBy { it.tH }
    private fun roundTo(x: Double, places: Int): Double {
        val factor = 10.0.pow(places)
        return round(x * factor) / factor
    }

    fun measuredWaterings(samples: List<ReadingPoint>, wateringAt: List<Double>): List<Pair<Double, Double>> {
        val points = usable(samples)
        return wateringAt.mapNotNull { at ->
            val before = points.filter { it.tH <= at && it.tH >= at - BEFORE_H }.lastOrNull()
            val after = points.filter { it.tH > at && it.tH <= at + AFTER_H }
            if (before != null && after.isNotEmpty()) at to (after.maxOf { it.moisture } - before.moisture) else null
        }
    }

    fun waterResponse(samples: List<ReadingPoint>, wateringAt: List<Double>): Double? {
        val measured = measuredWaterings(samples, wateringAt)
        val rises = measured.map { it.second }.filter { it > 0 }
        return if (rises.isEmpty()) null else roundTo(rises.average(), 1).takeIf { it > 0 }
    }

    fun dryingRate(samples: List<ReadingPoint>, hourOf: (Double) -> Double): Double? {
        val points = usable(samples)
        val rates = mutableListOf<Double>()
        for (i in 1 until points.size) {
            val a = points[i - 1]
            val b = points[i]
            val dt = b.tH - a.tH
            if (dt <= 0.0 || dt > MAX_GAP_H || b.moisture > a.moisture) continue
            val ha = hourOf(a.tH)
            val hb = hourOf(b.tH)
            if (ha !in DAY_FROM.toDouble()..DAY_TO.toDouble() || hb !in DAY_FROM.toDouble()..DAY_TO.toDouble()) continue
            rates.add((a.moisture - b.moisture) / dt)
        }
        return if (rates.size >= MIN_PAIRS) roundTo(rates.average(), 2).takeIf { it > 0 } else null
    }

    fun healthyMoistureRange(samples: List<ReadingPoint>, inspections: List<Inspection>): Pair<Int, Int>? {
        val points = usable(samples)
        val found = linkedSetOf<ReadingPoint>()
        inspections.filter { it.state == InspectionState.Sehat }.forEach { check ->
            points.filterTo(found) { it.tH >= check.tH && it.tH <= check.tH + HEALTHY_WINDOW_H }
        }
        if (found.size < MIN_HEALTHY_READINGS) return null
        val values = found.map { it.moisture }
        return floor(values.min()).toInt() to ceil(values.max()).toInt()
    }

    fun observe(samples: List<ReadingPoint>, inspections: List<Inspection>, wateringAt: List<Double>): Observation {
        val points = usable(samples)
        val days = if (points.size >= 2) floor((points.last().tH - points.first().tH) / 24.0).toInt() else 0
        return Observation(days, points.size, measuredWaterings(points, wateringAt).size, inspections)
    }

    fun evidenceLevel(obs: Observation, th: ObservationThresholds = THRESHOLDS): Int =
        if (obs.days >= th.days && obs.inspections.size >= th.inspections && obs.waterings >= th.waterings) 1 else 0

    fun summarize(
        speciesName: String,
        samples: List<ReadingPoint>,
        inspections: List<Inspection>,
        wateringAt: List<Double>,
        th: ObservationThresholds = THRESHOLDS,
        hourOf: (Double) -> Double = { Double.NaN },
    ): LearningSummary {
        val obs = observe(samples, inspections, wateringAt)
        val level = evidenceLevel(obs, th)
        val missDays = maxOf(0, th.days - obs.days)
        val missInspections = maxOf(0, th.inspections - obs.inspections.size)
        val missWaterings = maxOf(0, th.waterings - obs.waterings)
        val healthy = healthyMoistureRange(samples, inspections)
        val drying = dryingRate(samples, hourOf)
        val rise = waterResponse(samples, wateringAt)
        val ev = LearningEvidence(
            speciesName, level, obs.days, obs.readings, obs.waterings, obs.inspections.size,
            healthy, drying, rise, missDays, missInspections, missWaterings,
        )
        val text = if (level == 0) {
            val lacking = listOfNotNull(
                if (missDays > 0) "$missDays hari lagi" else null,
                if (missInspections > 0) "$missInspections pengecekan lagi" else null,
                if (missWaterings > 0) "$missWaterings siraman terukur lagi" else null,
            )
            val tail = if (lacking.isNotEmpty()) " Masih perlu ${lacking.joinToString(", ")}." else ""
            "Smart Agro belum punya acuan untuk $speciesName, jadi belum memberi saran siram. Ia merekam bacaan, siraman, dan pengecekan Anda: ${ev.days} hari, ${ev.readings} bacaan, ${ev.waterings} siraman terukur, ${ev.inspections} pengecekan.$tail"
        } else {
            val parts = listOfNotNull(
                healthy?.let { "Pada saat Anda menilai tanaman sehat, indeks lembap media berkisar ${it.first}–${it.second}/100." },
                drying?.let { "Media mengering sekitar ${ID_FORMAT.format(it)} poin per jam pada siang hari." },
                rise?.let { "Satu siraman menaikkannya sekitar ${ID_FORMAT.format(it)} poin." },
            )
            "${if (parts.isNotEmpty()) parts.joinToString(" ") else "Belum ada pola yang cukup jelas untuk dicatat."} Ini pola pot Anda, bukan standar tanaman."
        }
        val next = when {
            level == 1 -> "Catat pengecekan hari ini supaya pola pot ini makin tepat."
            missInspections > 0 -> "Yang bisa dilakukan sekarang: nilai tanaman Anda hari ini."
            missWaterings > 0 -> "Yang bisa dilakukan sekarang: catat satu siraman, lalu biarkan bacaan berikutnya mengukur efeknya."
            else -> "Tinggal menunggu: $missDays hari lagi."
        }
        return LearningSummary(ev, text, next)
    }

    /** Projects unit sensor readings and care journal entries onto continuous hours from the first sample. */
    fun fromHistory(speciesName: String, readings: List<Reading>, journal: List<CareEntry>): Pair<LearningSummary, InspectionState?> {
        val moisture = readings.filter { it.sensor == Sensor.Moisture && it.quality == "ok" && it.synced && it.value != null }.sortedBy { it.at }
        val anchor = listOfNotNull(moisture.firstOrNull()?.at, journal.minOfOrNull { it.observedAt }).minOrNull() ?: Instant.now()
        fun hoursSince(at: Instant): Double = Duration.between(anchor, at).toMillis() / 3_600_000.0
        val points = moisture.map { ReadingPoint(hoursSince(it.at), it.value!!, true) }
        val inspections = journal.filter { it.kind == "inspection" }.mapNotNull { entry ->
            InspectionState.fromJournalNotes(entry.notes)?.let { st -> Inspection(hoursSince(entry.observedAt), st, entry.notes) }
        }
        val waterings = journal.filter { it.kind == "watering" }.map { hoursSince(it.observedAt) }.sorted()
        val zone = ZoneId.systemDefault()
        return summarize(speciesName, points, inspections, waterings) { hours ->
            val time = anchor.plusMillis((hours * 3_600_000).roundToLong()).atZone(zone).toLocalTime()
            time.toSecondOfDay() / 3600.0
        } to inspections.maxByOrNull { it.tH }?.state
    }
}
