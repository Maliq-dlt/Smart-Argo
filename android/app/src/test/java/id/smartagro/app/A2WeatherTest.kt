package id.smartagro.app

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class A2WeatherTest {
    private fun snapshot() = JSONObject("""{"at":"2026-11-16T14:15","condition":"cerah","tempC":34,"humidity":65,"cloud":12,"windMs":2.5,"rainMm":0,"forecast":[{"inHours":2,"condition":"hujan","rainMm":3,"tempC":28}]}""")
    @Test fun serverSnapshotPreservesLocalTimeAndMetersPerSecond() {
        val weather=parseWeatherSnapshot(snapshot())
        assertEquals("2026-11-16T14:15",weather.at)
        assertEquals(2.5,weather.windMs,0.0)
        assertEquals(2,weather.forecast.single().inHours)
        assertEquals("Cerah",weather.label)
    }
    @Test fun contextMatchesWebAndNeverPrescribesAnAmount() {
        val weather=parseWeatherSnapshot(snapshot())
        assertNull(weatherNote(weather,"indoor"))
        assertEquals("Hujan sekitar 2 jam lagi: pertimbangkan menunda siram.",weatherNote(weather,"outdoor"))
        assertEquals("Sedang hujan: pertimbangkan menunda siram.",weatherNote(weather.copy(condition="badai"),"rooftop"))
        assertEquals("Suhu tinggi: periksa media lebih sering.",weatherNote(weather.copy(forecast=emptyList()),"outdoor"))
        assertNull(weatherNote(weather.copy(tempC=28.0,forecast=emptyList()),"outdoor"))
    }
    @Test fun malformedForecastFailsInsteadOfInventingWeather() {
        val bad=listOf(snapshot().put("condition","unknown"),snapshot().put("humidity",101),snapshot().put("windMs",-1),
            snapshot().put("at","2026-11-16 14:15"),snapshot().put("tempC",JSONObject.NULL),
            snapshot().also { it.getJSONArray("forecast").getJSONObject(0).put("inHours",0) },
            snapshot().also { it.getJSONArray("forecast").put(it.getJSONArray("forecast").getJSONObject(0)) })
        bad.forEach { row ->
            try { parseWeatherSnapshot(row); fail("Invalid snapshot accepted: $row") }
            catch (_: IllegalArgumentException) { }
            catch (_: java.time.format.DateTimeParseException) { }
        }
    }
}
