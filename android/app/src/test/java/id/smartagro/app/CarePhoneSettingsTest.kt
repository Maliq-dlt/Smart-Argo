package id.smartagro.app

import android.Manifest
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class CarePhoneSettingsTest {
    @Test fun permissionAnswerAndSavedSwitchControlPhoneNotifications() {
        val context=ApplicationProvider.getApplicationContext<android.app.Application>()
        runCatching { androidx.work.WorkManager.initialize(context, androidx.work.Configuration.Builder().build()) }
        val shadow=shadowOf(context)
        shadow.denyPermissions(Manifest.permission.POST_NOTIFICATIONS)
        assertFalse(CareNotifications.allowed(context))
        CareNotifications.setEnabled(context,false)
        assertFalse(CareNotifications.enabled(context))
        shadow.grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        assertTrue(CareNotifications.allowed(context))
        CareNotifications.setEnabled(context,true)
        assertTrue(CareNotifications.enabled(context))
        assertTrue(context.getSharedPreferences("care-notifications",Context.MODE_PRIVATE).getBoolean("enabled",false))
        CareNotifications.remember(context,setOf("old-account:below"))
        CareNotifications.setEnabled(context,false)
        assertFalse(CareNotifications.enabled(context))
        assertTrue(CareNotifications.seen(context).isEmpty())
    }
}
