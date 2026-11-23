package id.smartagro.app

import java.text.Normalizer
import java.util.Locale

data class PhaseSpec(val name: String, val start: Int)

data class SpeciesSpec(
    val id: String,
    val speciesId: Int,
    val tag: String,
    val name: String,
    val category: String,
    val form: String,
    val tier: String,
    val aliases: List<String>,
    val latin: String,
    val scene: String?,
    val growthDays: Int,
    val maxDay: Int,
    val phases: List<PhaseSpec>,
) {
    val curated: Boolean get() = tier == "kurasi"
    val plantable: Boolean get() = scene != null
}

private val LEARNING_PHASES = listOf(PhaseSpec("Mengamati", 0))

internal object SpeciesCatalog {
    val all: List<SpeciesSpec> = listOf(
        SpeciesSpec(
            id = "cabai",
            speciesId = 1,
            tag = "CB",
            name = "Cabai",
            category = "sayur_buah",
            form = "semak",
            tier = "kurasi",
            aliases = listOf("cabe", "lombok", "cabai rawit", "cabai merah"),
            latin = "Capsicum annuum",
            scene = "cabai",
            growthDays = 62,
            maxDay = 90,
            phases = listOf(
                PhaseSpec("Awal tanam", 0),
                PhaseSpec("Vegetatif", 1),
                PhaseSpec("Berbunga", 31),
                PhaseSpec("Berbuah", 56),
            ),
        ),
        SpeciesSpec(
            id = "bawang",
            speciesId = 2,
            tag = "BM",
            name = "Bawang merah",
            category = "sayur_buah",
            form = "umbi",
            tier = "kurasi",
            aliases = listOf("bawang", "shallot", "brambang"),
            latin = "Allium cepa var. aggregatum",
            scene = "bawang",
            growthDays = 48,
            maxDay = 65,
            phases = listOf(
                PhaseSpec("Awal tanam", 0),
                PhaseSpec("Vegetatif", 1),
                PhaseSpec("Pembentukan umbi", 26),
                PhaseSpec("Pematangan umbi", 51),
            ),
        ),
        SpeciesSpec(
            id = "anggrek",
            speciesId = 3,
            tag = "AB",
            name = "Anggrek bulan",
            category = "hias",
            form = "roset",
            tier = "belajar",
            aliases = listOf("anggrek", "orchid", "phalaenopsis"),
            latin = "Phalaenopsis amabilis",
            scene = "anggrek",
            growthDays = 120,
            maxDay = 180,
            phases = LEARNING_PHASES,
        ),
        SpeciesSpec(
            id = "peoni",
            speciesId = 4,
            tag = "PN",
            name = "Peoni",
            category = "hias",
            form = "semak",
            tier = "belajar",
            aliases = listOf("peony", "paeonia", "mawar cina"),
            latin = "Paeonia lactiflora",
            scene = null,
            growthDays = 120,
            maxDay = 180,
            phases = LEARNING_PHASES,
        ),
    )

    val plantable: List<SpeciesSpec> get() = all.filter { it.plantable }

    fun byId(id: String): SpeciesSpec? = all.find { it.id == id }
    fun byCode(speciesId: Int): SpeciesSpec? = all.find { it.speciesId == speciesId }

    fun ofCrop(crop: String): SpeciesSpec {
        val text = crop.lowercase(Locale.ROOT)
        return when {
            "bawang" in text -> all[1]
            "anggrek" in text -> all[2]
            "peoni" in text -> all[3]
            "cabai" in text || "cabe" in text || "lombok" in text || "capsicum" in text -> all[0]
            else -> SpeciesSpec("unknown", 0, "", crop, "", "", "belajar", emptyList(), "", null, 62, 90, LEARNING_PHASES)
        }
    }

    fun phaseRanges(speciesId: Int): List<Pair<String, String>> {
        val spec = byCode(speciesId) ?: return emptyList()
        return spec.phases.mapIndexed { i, phase ->
            val last = if (i + 1 < spec.phases.size) spec.phases[i + 1].start - 1 else spec.maxDay
            val range = if (last == phase.start) "${phase.start}" else "${phase.start}–$last"
            range to phase.name
        }
    }

    private fun fold(text: String): String = Normalizer.normalize(text.lowercase(Locale.ROOT), Normalizer.Form.NFD)
        .replace(Regex("[\\u0300-\\u036f]"), "")
        .trim()

    fun search(query: String, onlyPlantable: Boolean = false): List<SpeciesSpec> {
        val source = if (onlyPlantable) plantable else all
        val q = fold(query)
        val words = q.split(Regex("\\s+")).filter { it.isNotEmpty() }
        if (words.isEmpty()) return source
        fun rank(s: SpeciesSpec): Int = when {
            fold(s.name).startsWith(q) -> 0
            s.aliases.any { fold(it).startsWith(q) } -> 1
            else -> 2
        }
        return source.mapIndexedNotNull { order, species ->
            val hay = fold((listOf(species.name, species.latin) + species.aliases).joinToString(" "))
            if (words.all { it in hay }) Triple(species, rank(species), order) else null
        }.sortedWith(compareBy<Triple<SpeciesSpec, Int, Int>> { it.second }.thenBy { it.third }).map { it.first }
    }
}
