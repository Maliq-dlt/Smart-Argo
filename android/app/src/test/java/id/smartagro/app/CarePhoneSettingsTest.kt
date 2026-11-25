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
    @Test fun blockedChannelKeepsAnOngoingAlertEligibleForDelivery() {
        val context = ApplicationProvider.getApplicationContext<android.app.Application>()
        shadowOf(context).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        val manager = context.getSystemService(android.app.NotificationManager::class.java)
        manager.createNotificationChannel(android.app.NotificationChannel(CareNotifications.CHANNEL, "Perawatan", android.app.NotificationManager.IMPORTANCE_NONE))
        val overview = org.json.JSONObject("""{"plants":[{"unit_id":"u1","name":"Cabai","state":"below"}]}""")
        assertFalse(CareNotifications.allowed(context))
        assertEquals(android.provider.Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS, CareNotifications.settingsIntent(context).action)
        CareNotifications.notifyChanges(context, overview, setOf("soil_dry"))
        assertTrue(CareNotifications.seen(context).isEmpty())
        assertEquals(0, manager.activeNotifications.size)
        // Robolectric models an OS-wide block separately from runtime permission.
        shadowOf(manager).setNotificationsEnabled(false)
        assertEquals(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS, CareNotifications.settingsIntent(context).action)
    }

    @Test fun aSuccessfulCheckRecordsTheTimeAndTheDeliveredEpisode() {
        val context = ApplicationProvider.getApplicationContext<android.app.Application>()
        shadowOf(context).grantPermissions(Manifest.permission.POST_NOTIFICATIONS)
        val overview = org.json.JSONObject("""{"plants":[{"unit_id":"u1","name":"Cabai","state":"below"}]}""")
        CareNotifications.notifyChanges(context, overview, setOf("soil_dry"))
        assertEquals(setOf("u1:below"), CareNotifications.seen(context))
        CareNotifications.markChecked(context)
        assertNotNull(CareNotifications.lastCheck(context))
        CareNotifications.setEnabled(context, false)
        assertNull(CareNotifications.lastCheck(context))
    }

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
