package id.smartagro.app

import org.json.JSONObject
import java.time.LocalDate

data class GardenSite(val id: String,val name: String,val kind: String,val placement: String,val latitude: Double? = null,val longitude: Double? = null)
data class GardenSlot(val id: String,val siteId: String,val name: String,val unitId: String?,val share: Boolean = false)
data class GardenPlant(val id: String,val siteId: String,val slotId: String,val zone: String,val unitId: String?,val name: String,
    val species: Int,val ordinal: Int,val code: Long,val plantedOn: LocalDate,val endedOn: LocalDate?,val outcome: String? = null,val shared: Boolean = false) {
    val tag get() = "${when(species) { 1->"CB";2->"BM";3->"AB";4->"PN";else->"SP$species" }}-$ordinal"
    val crop get() = when(species) { 1->"Cabai";2->"Bawang merah";3->"Anggrek bulan";4->"Peoni";else->"Spesies $species" }
}
data class Garden(val sites: List<GardenSite>,val plants: List<GardenPlant>,val emptySlots: Int,val slots: List<GardenSlot> = emptyList())

/** Read the same account garden as the web. A garden cycle is distinct from a physical sensor unit. */
internal fun parseGarden(json: JSONObject): Garden {
    require(json.opt("ok")==true) { "Kebun akun belum dapat dimuat." }
    val sites=json.array("sites").objects(20).map { row ->
        val kind=row.text("kind",40);val placement=row.text("placement",40)
        val latitude=if(row.has("latitude")) row.nullableNumber("latitude") else null
        val longitude=if(row.has("longitude")) row.nullableNumber("longitude") else null
        require((latitude==null)==(longitude==null) && (latitude==null || latitude in -90.0..90.0) && (longitude==null || longitude in -180.0..180.0)) { "Koordinat kebun tidak valid." }
        GardenSite(row.id("id"),row.text("name",60),kind,placement,latitude,longitude)
    }
    require(sites.map { it.id }.distinct().size==sites.size)
    val slots=json.array("slots").objects(60)
    require(slots.map { it.id("id") }.distinct().size==slots.size)
    val parsedSlots=slots.map { row ->
        val siteId=row.id("site_id").also { s -> require(sites.any { it.id==s }) }
        val unitId=if(row.isNull("unit_id")) null else row.id("unit_id")
        val share=row.opt("share") as? Boolean ?: false
        GardenSlot(row.id("id"),siteId,row.text("name",60),unitId,share)
    }
    val plants=json.array("cycles").objects(300).map { row ->
        val slot=parsedSlots.singleOrNull { it.id==row.id("slot_id") } ?: throw IllegalArgumentException("Slot kebun tidak valid.")
        val species=row.whole("species_id",1,2146).toInt();val ordinal=row.whole("plant_no",1,999999).toInt()
        val code=row.whole("code",1,Int.MAX_VALUE.toLong())
        require(code==species*1000000L+ordinal) { "Kode tanaman tidak sesuai." }
        val planted=LocalDate.parse(row.text("planted_on",10))
        val ended=if(row.isNull("ended_on")) null else LocalDate.parse(row.text("ended_on",10))
        val outcome=if(!row.has("outcome") || row.isNull("outcome")) null else row.text("outcome",20).also { require(it in listOf("berhasil","gagal","dihentikan")) }
        val shared=row.opt("shared") as? Boolean ?: false
        require(ended==null || !ended.isBefore(planted))
        GardenPlant(row.id("id"),slot.siteId,slot.id,slot.name,slot.unitId,
            row.text("nickname",60),species,ordinal,code,planted,ended,outcome,shared)
    }
    require(plants.map { it.id }.distinct().size==plants.size && plants.map { it.code }.distinct().size==plants.size)
    require(plants.filter { it.endedOn==null }.groupBy { it.slotId }.all { it.value.size==1 })
    return Garden(sites,plants,parsedSlots.count { slot -> plants.none { it.slotId==slot.id && it.endedOn==null } },parsedSlots)
}
