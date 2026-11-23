package id.smartagro.app

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.Instant

class CareWidgetTest {
    @Test fun prioritizesDryPlantsAndRequiresFreshOkReadingsForAllClear() {
        val now=Instant.parse("2026-11-23T07:00:00Z")
        fun overview(state: String, at: Instant = now)=JSONObject().put("plants", org.json.JSONArray().put(JSONObject().put("state",state).put("name","Cabai 1").put("measured_at",at.toString())))
        assertEquals("Buka Smart Agro untuk memuat",widgetLine(null,now))
        assertEquals("Cabai 1 perlu disiram",widgetLine(overview("below"),now))
        assertEquals("Semua tanaman aman",widgetLine(overview("ok"),now))
        assertEquals("Cabai 1 di atas pita kelembapan",widgetLine(overview("above"),now))
        assertEquals("Bacaan tanaman belum segar; buka Smart Agro",widgetLine(overview("ok",now.minusSeconds(76*60)),now))
        assertEquals("Pola atau bacaan tanaman belum lengkap",widgetLine(overview("no_reading"),now))
        assertEquals("Belum ada tanaman aktif",widgetLine(JSONObject("""{"plants":[]}"""),now))
    }
}
