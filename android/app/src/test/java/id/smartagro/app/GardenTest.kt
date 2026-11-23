package id.smartagro.app

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
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
    @Test fun serverCoordinatesFollowTheSelectedGardenAndNeverGuessAMissingLocation() {
        val data=garden();data.getJSONArray("sites").getJSONObject(0).put("latitude",-6.91).put("longitude",107.61)
        val parsed=parseGarden(data)
        assertEquals(-6.91,parsed.sites.single().latitude!!,0.0)
        val state=AppState(screen=Screen.Garden,garden=parsed,gardenPlant=parsed.plants.single())
        assertEquals(parsed.sites.single(),state.weatherSite)
        val unit=PlantUnit(id(9),id(10),"Cabai","Cabai")
        assertEquals("CB-12",state.copy(garden=parsed.copy(plants=listOf(parsed.plants.single().copy(unitId=unit.id)))).plantCode(unit))
        assertNull(state.copy(screen=Screen.Dashboard,selectedUnit=null).weatherSite)
        data.getJSONArray("sites").getJSONObject(0).put("longitude",JSONObject.NULL)
        assertThrows(IllegalArgumentException::class.java) { parseGarden(data) }
    }
    @Test fun invalidRelationshipsAndConflictingIdentitiesFailClosed() {
        val data=garden();data.getJSONArray("slots").getJSONObject(0).put("site_id",id(4))
        assertThrows(IllegalArgumentException::class.java) { parseGarden(data) }
        val wrong=garden();wrong.getJSONArray("cycles").getJSONObject(0).put("code",2000012)
        assertThrows(IllegalArgumentException::class.java) { parseGarden(wrong) }
        val doubled=garden();doubled.getJSONArray("cycles").put(JSONObject(doubled.getJSONArray("cycles").getJSONObject(0).toString()).put("id",id(4)))
        assertThrows(IllegalArgumentException::class.java) { parseGarden(doubled) }
    }
    @Test fun optionalGardenRetainsPriorSnapshotAndPropagatesSessionAndCancellation() {
        val previous = parseGarden(garden())
        val unavailable = ApiFailure("Kebun tidak tersedia", status = 503)
        val failed = runBlocking { fetchOptional<Garden> { throw unavailable } }
        assertSame(unavailable, failed.exceptionOrNull())
        assertSame(previous, failed.getOrElse { previous })
        val expired = ApiFailure("Sesi berakhir", expired = true)
        assertSame(expired, assertThrows(ApiFailure::class.java) {
            runBlocking { fetchOptional<Garden> { throw expired } }
        })
        assertThrows(CancellationException::class.java) {
            runBlocking { fetchOptional<Garden> { throw CancellationException() } }
        }
    }

}
