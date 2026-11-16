package id.smartagro.app

import android.app.Activity
import android.app.KeyguardManager
import android.content.Intent
import android.view.WindowManager
import androidx.compose.runtime.MutableState
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModelProvider
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w390dp-h844dp-mdpi")
@org.robolectric.annotation.GraphicsMode(org.robolectric.annotation.GraphicsMode.Mode.NATIVE)
class SecurityTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private fun secure(enabled: Boolean) {
        compose.runOnIdle { shadowOf(compose.activity.getSystemService(KeyguardManager::class.java)).setIsDeviceSecure(enabled) }
        compose.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
        compose.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
    }
    private fun account(email: String, demo: Boolean = false, screen: Screen = Screen.Products) {
        compose.runOnIdle {
            val model = ViewModelProvider(compose.activity)[AgroViewModel::class.java]
            // Set a signed-in UI fixture without credentials, cloud calls, or a production bypass.
            val field = AgroViewModel::class.java.getDeclaredField("state\$delegate").apply { isAccessible = true }
            @Suppress("UNCHECKED_CAST")
            val state = field.get(model) as MutableState<AppState>
            state.value = AppState(screen = screen, email = email, demo = demo, catalogLoaded = true)
        }
    }
    private val secureFlag get() = compose.activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0

    @Test fun onlyScreensThatShowOrAskForCodesBlockScreenshots() {
        account("alice@example.test")
        compose.waitForIdle()
        assertFalse("plant screens can be captured, so the owner can send them for review", secureFlag)
        account("alice@example.test", screen = Screen.Mfa)
        compose.waitForIdle()
        assertTrue("the authenticator code screen is protected", secureFlag)
        account("alice@example.test")
        compose.waitForIdle()
        assertFalse("leaving the code screen lifts the protection", secureFlag)
    }

    @Test fun accountWorksWithoutAdditionalDeviceLockAndSurvivesBackground() {
        secure(false)
        account("alice@example.test")
        compose.onNodeWithText("Tanaman saya").assertIsDisplayed()
        compose.onNodeWithText("Akun terkunci").assertDoesNotExist()
        compose.activityRule.scenario.moveToState(Lifecycle.State.CREATED)
        compose.activityRule.scenario.moveToState(Lifecycle.State.RESUMED)
        compose.onNodeWithText("Tanaman saya").assertIsDisplayed()
    }
    @Test fun themeChoiceSurvivesActivityRecreation() {
        secure(false)
        account("alice@example.test")
        compose.onNodeWithText("Mode gelap").performClick()
        compose.activityRule.scenario.recreate()
        compose.onNodeWithText("Mode terang").assertIsDisplayed()
        compose.onNodeWithText("Tanaman saya").assertIsDisplayed()
    }
    @Test fun practiceStillWorksWithoutDeviceLock() {
        secure(false)
        account("",demo=true)
        compose.onNodeWithText("Tanaman saya").assertIsDisplayed()
    }
    @Test fun queuedRenameKeepsItsOriginalUnitWhileNavigationRemainsAvailable() {
        account("",demo=true)
        lateinit var model: AgroViewModel
        compose.runOnIdle {
            model=ViewModelProvider(compose.activity)[AgroViewModel::class.java]
            val field=AgroViewModel::class.java.getDeclaredField("state\$delegate").apply { isAccessible=true }
            @Suppress("UNCHECKED_CAST")
            val state=field.get(model) as MutableState<AppState>
            val product=Product("product","SA-TEST","single_pot")
            val first=PlantUnit("case-0",product.id,"Cabai awal","Cabai")
            val second=PlantUnit("case-1",product.id,"Bawang awal","Bawang merah")
            state.value=state.value.copy(screen=Screen.Dashboard,busy=true,products=listOf(product),units=listOf(first,second),selectedProduct=product,selectedUnit=first,historyLoaded=true)
            val lock=AgroViewModel::class.java.getDeclaredField("operations").apply { isAccessible=true }.get(model) as kotlinx.coroutines.sync.Mutex
            assertTrue(lock.tryLock())
            model.renameUnit("Cabai teras")
            model.openUnit(second)
            assertEquals(second.id,model.state.selectedUnit?.id)
            model.navigate(Screen.Products)
            assertEquals(Screen.Products,model.state.screen)
            lock.unlock()
        }
        compose.waitUntil(5_000) { model.state.units.first().name=="Cabai teras" }
        compose.runOnIdle {
            assertEquals("Bawang awal",model.state.selectedUnit?.name)
            assertEquals("Bawang awal",model.state.units.last().name)
            assertFalse(model.state.busy)
        }
    }

    @Config(sdk=[34],qualifiers="w320dp-h640dp-mdpi")
    @Test fun smallScreenHeaderWrapsWithLargeText() {
        compose.runOnIdle {
            val resources=compose.activity.resources
            val configuration=android.content.res.Configuration(resources.configuration).apply { fontScale=2f }
            @Suppress("DEPRECATION")
            resources.updateConfiguration(configuration,resources.displayMetrics)
        }
        compose.activityRule.scenario.recreate()
        account("alice@example.test")
        listOf("Smart Agro","Segarkan","Mode gelap").forEach { text ->
            val node=compose.onNodeWithText(text).assertIsDisplayed()
            val layouts=mutableListOf<androidx.compose.ui.text.TextLayoutResult>()
            node.performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.GetTextLayoutResult) { it(layouts) }
            // Every character is laid out and visible (nothing cut or ellipsized), and the text stays inside a 320 dp screen.
            // Not hasVisualOverflow: under Robolectric it reported a 188 px "Smart Agro" in a 288 px slot as overflowing, while
            // the same header on an API 35 emulator at 320 dp and 200 % text shows the title whole (2026-11-16).
            val layout=layouts.single()
            assertEquals("all of \"$text\" is visible",text.length,layout.getLineEnd(layout.lineCount-1,visibleEnd=true))
            assertTrue("\"$text\" fits its height",!layout.didOverflowHeight)
            val bounds=node.fetchSemanticsNode().boundsInRoot
            assertTrue("\"$text\" inside the screen: $bounds",bounds.left>=0 && bounds.right<=320)
        }
    }

}
