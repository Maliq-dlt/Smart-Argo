package id.smartagro.app

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CareNotificationsTest {
    private val all = setOf("soil_dry", "battery_low", "device_silent", "soil_hot")
    private fun plant(unit: Any, state: String, name: String = "Cabai 1") =
        JSONObject().put("unit_id", unit).put("name", name).put("state", state)
    private fun overview(vararg plants: JSONObject, issues: List<JSONObject> = emptyList()) = JSONObject()
        .put("ok", true).put("plants", JSONArray(plants.toList()))
        .put("devices", JSONObject().put("total", 1).put("issues", JSONArray(issues)))

    @Test fun aLastingConditionIsAnnouncedOnce() {
        val dry = overview(plant("u1", "below"))
        val (first, seen) = noticesFor(emptySet(), dry, all)
        assertEquals(listOf("Cabai 1 perlu disiram"), first.map { it.title })
        val (second, _) = noticesFor(seen, dry, all)
        assertTrue("the same dry pot an hour later is not a new notification", second.isEmpty())
    }

    @Test fun aConditionThatClearedAndReturnedIsAnnouncedAgain() {
        val (_, dry) = noticesFor(emptySet(), overview(plant("u1", "below")), all)
        val (_, watered) = noticesFor(dry, overview(plant("u1", "ok")), all)
        assertTrue(watered.isEmpty())
        val (again, _) = noticesFor(watered, overview(plant("u1", "below")), all)
        assertEquals(1, again.size)
    }

    @Test fun kindsTheOwnerSwitchedOffStayQuiet() {
        val issues = listOf(
            JSONObject().put("unit_id", "u1").put("device_id", "d1").put("kind", "silent"),
            JSONObject().put("unit_id", "u1").put("device_id", "d1").put("kind", "battery_low"),
            JSONObject().put("unit_id", "u1").put("device_id", "d1").put("kind", "gap"),
        )
        val snapshot = overview(plant("u1", "below"), issues = issues)
        val (onlyBattery, _) = noticesFor(emptySet(), snapshot, setOf("battery_low"))
        assertEquals(listOf("Cabai 1: baterai perangkat lemah"), onlyBattery.map { it.title })
        val (everything, _) = noticesFor(emptySet(), snapshot, all)
        assertEquals("a Wi-Fi gap is shown in the app, not pushed", 3, everything.size)
    }

    @Test fun aSlotWithoutAProbeIsIgnored() {
        val (notices, keys) = noticesFor(emptySet(), overview(plant(JSONObject.NULL, "no_device")), all)
        assertTrue(notices.isEmpty() && keys.isEmpty())
    }
}
