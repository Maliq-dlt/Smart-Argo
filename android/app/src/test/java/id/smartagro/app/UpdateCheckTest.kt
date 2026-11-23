package id.smartagro.app

import org.junit.Assert.*
import org.junit.Test

class UpdateCheckTest {
    @Test fun comparesActualAndroidReleaseTagsNumerically() {
        assertTrue(isNewer("v0.1.2", "0.1.1"))
        assertTrue(isNewer("android-v0.2.0", "0.1.9"))
        assertTrue(isNewer("android-v0.1.10", "0.1.9"))
        assertFalse(isNewer("v0.1.1", "0.1.1"))
        assertFalse(isNewer("android-v0.1.0", "0.1.1"))
        assertFalse(isNewer("android-v0.2.0-beta", "0.1.1"))
        assertFalse(isNewer("invalid", "0.1.1"))
        assertFalse(isNewer("v99999999999.0.0", "0.1.1"))
    }
}
