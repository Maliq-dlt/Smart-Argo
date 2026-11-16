package id.smartagro.app

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class GardenTest {
    private fun id(n: Int)="00000000-0000-4000-8000-%012d".format(n)
    private fun garden()=JSONObject().put("ok",true)
        .put("sites",JSONArray().put(JSONObject().put("id",id(1)).put("name","Kebun belakang").put("kind","garden").put("placement","outdoor")))
        .put("slots",JSONArray().put(JSONObject().put("id",id(2)).put("site_id",id(1)).put("name","Bedeng A").put("unit_id",JSONObject.NULL)))
        .put("cycles",JSONArray().put(JSONObject().put("id",id(3)).put("slot_id",id(2)).put("species_id",1).put("plant_no",12).put("code",1000012)
            .put("nickname","Cabai dapur").put("planted_on","2026-11-10").put("ended_on",JSONObject.NULL)))
    @Test fun gardenReadsTheWebsPlantCodeWithoutInventingASensorUnit() {
        val data=parseGarden(garden());val plant=data.plants.single()
        assertEquals("CB-12",plant.tag);assertEquals("Cabai dapur",plant.name);assertNull(plant.unitId)
        assertEquals(0,data.emptySlots)
    }
    @Test fun invalidRelationshipsAndConflictingIdentitiesFailClosed() {
        val data=garden();data.getJSONArray("slots").getJSONObject(0).put("site_id",id(4))
        assertThrows(IllegalArgumentException::class.java) { parseGarden(data) }
        val wrong=garden();wrong.getJSONArray("cycles").getJSONObject(0).put("code",2000012)
        assertThrows(IllegalArgumentException::class.java) { parseGarden(wrong) }
        val doubled=garden();doubled.getJSONArray("cycles").put(JSONObject(doubled.getJSONArray("cycles").getJSONObject(0).toString()).put("id",id(4)))
        assertThrows(IllegalArgumentException::class.java) { parseGarden(doubled) }
    }
}
