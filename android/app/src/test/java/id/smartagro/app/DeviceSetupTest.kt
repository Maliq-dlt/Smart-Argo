package id.smartagro.app

import org.junit.Assert.*
import org.junit.Test

class DeviceSetupTest {
    @Test fun validatesFirmwareUtf8ByteLimits() {
        assertNotNull(wifiFormError("", ""))
        assertNotNull(wifiFormError("a".repeat(33), ""))
        assertNotNull(wifiFormError("rumah", "1234567"))
        assertNotNull(wifiFormError("rumah", "a".repeat(64)))
        assertNull(wifiFormError("rumah", ""))
        assertNull(wifiFormError("a".repeat(32), "a".repeat(63)))
        assertNotNull(wifiFormError("\u00e9".repeat(17), ""))
        assertNull(wifiFormError("\u00e9".repeat(16), "12345678"))
    }
    @Test fun acceptsOnlyPublicProductionProductLinks() {
        assertEquals("SA-123", productLinkSerial("https://live.smart-agro-demo.pages.dev/?serial=sa-123#ekosistem"))
        assertNull(productLinkSerial("https://evil.example/?serial=SA-123"))
        assertNull(productLinkSerial("http://live.smart-agro-demo.pages.dev/?serial=SA-123"))
        assertNull(productLinkSerial("https://live.smart-agro-demo.pages.dev/?serial=SA-1&serial=SA-2"))
        assertNull(productLinkSerial("https://live.smart-agro-demo.pages.dev:443/?serial=SA-1"))
        assertNull(productLinkSerial(null))
    }
}
