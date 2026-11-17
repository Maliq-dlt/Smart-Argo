package id.smartagro.app

import android.graphics.Bitmap
import android.graphics.Canvas
import android.view.WindowManager
import java.io.File
import org.robolectric.annotation.GraphicsMode
import androidx.compose.runtime.MutableState
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.text.TextLayoutResult
import androidx.lifecycle.ViewModelProvider
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The signed-out screens (A4a), driven through what an owner sees; network steps are set as states, not faked servers. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w390dp-h844dp-mdpi")
class AuthFlowTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()
    private val model get() = ViewModelProvider(compose.activity)[AgroViewModel::class.java]
    private fun state(value: AppState) = compose.runOnIdle {
        val field = AgroViewModel::class.java.getDeclaredField("state\$delegate").apply { isAccessible = true }
        @Suppress("UNCHECKED_CAST")
        (field.get(model) as MutableState<AppState>).value = value
    }
    private val secureFlag get() = compose.activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0
    private fun button(text: String) = compose.onNode(hasText(text) and hasClickAction())

    @Test fun signUpGrowsTheFormInPlaceAndChecksThePassword() {
        compose.onNodeWithText("Masuk ke Smart Agro").assertIsDisplayed()
        compose.onNodeWithText("Nama").assertDoesNotExist()
        compose.onNode(hasText("Daftar") and isSelectable()).performClick()
        compose.onNodeWithText("Buat akun Smart Agro").assertIsDisplayed()
        compose.onNodeWithText("Nama").performTextInput("Petani")
        compose.onNodeWithText("Email").performTextInput("grower@example.test")
        compose.onNodeWithText("Kata sandi").performTextInput("pendek")
        compose.onNodeWithText("Tambah 4 karakter lagi.").assertIsDisplayed()
        button("Buat akun").assertIsNotEnabled()
        compose.onNodeWithText("Kata sandi").performTextInput("-sekali")
        compose.onNodeWithText("Konfirmasi").performTextInput("pendek-sekalu")
        compose.onNodeWithText("Konfirmasi kata sandi belum sama.").assertIsDisplayed()
        button("Buat akun").assertIsNotEnabled()
        compose.onNodeWithText("Konfirmasi").performTextReplacement("pendek-sekali")
        compose.onNodeWithText("Kata sandi siap.").assertIsDisplayed()
        if (model.config.valid) button("Buat akun").assertIsEnabled()
        // Back to Masuk: the extra fields fold away and the typed email stays.
        compose.onNode(hasText("Masuk") and isSelectable()).performClick()
        compose.onNodeWithText("Nama").assertDoesNotExist()
        compose.onNodeWithText("Konfirmasi").assertDoesNotExist()
        compose.onNodeWithText("Email").assert(hasText("grower@example.test"))
        compose.onNodeWithText("Lupa kata sandi?").assertIsDisplayed()
    }

    @Test fun emailedCodeIsProtectedAndBackReturnsToTheForm() {
        state(AppState(auth = AuthStep.SignupCode, authEmail = "grower@example.test"))
        compose.onNodeWithText("Cek email Anda").assertIsDisplayed()
        compose.onNodeWithText("Kami kirim kode 6 angka ke grower@example.test.").assertIsDisplayed()
        compose.onNodeWithContentDescription("Kode verifikasi").assertExists()
        compose.onNode(hasText("Kirim ulang", substring = true)).assertExists()
        assertTrue("an emailed code cannot be captured", secureFlag)
        compose.onNodeWithContentDescription("Kembali ke Daftar").performClick()
        compose.onNodeWithText("Buat akun Smart Agro").assertIsDisplayed()
        compose.onNodeWithText("Email").assert(hasText("grower@example.test"))
        assertFalse(secureFlag)
    }

    @Test fun forgotPasswordCarriesTheEmailIntoTheCodeAndNewPasswordStep() {
        compose.onNodeWithText("Email").performTextInput("grower@example.test")
        compose.onNodeWithText("Lupa kata sandi?").performScrollTo().performClick()
        compose.onNodeWithText("Atur ulang kata sandi").assertIsDisplayed()
        compose.onNodeWithText("Email").assert(hasText("grower@example.test"))
        if (model.config.valid) button("Kirim kode").assertIsEnabled()
        state(model.state.copy(auth = AuthStep.ResetCode))
        compose.onNodeWithText("Buat kata sandi baru").assertIsDisplayed()
        assertTrue(secureFlag)
        compose.onNodeWithContentDescription("Kode verifikasi").performTextInput("12a3456")
        compose.onNodeWithContentDescription("Kode verifikasi").assert(hasText("123456"))
        compose.onNodeWithText("Sandi baru").performTextInput("sandi-baru-123")
        button("Simpan kata sandi").assertIsNotEnabled()
        compose.onNodeWithText("Konfirmasi").performTextInput("sandi-baru-123")
        button("Simpan kata sandi").assertIsEnabled()
        compose.onNodeWithContentDescription("Kembali ke Email").performClick()
        compose.onNodeWithText("Atur ulang kata sandi").assertIsDisplayed()
        compose.onNodeWithContentDescription("Kembali ke Masuk").performClick()
        compose.onNodeWithText("Masuk ke Smart Agro").assertIsDisplayed()
    }

    @Test fun lostAuthenticatorOffersAOneTimeRecoveryCode() {
        state(AppState(screen = Screen.Mfa))
        compose.onNodeWithText("Verifikasi dua langkah").assertIsDisplayed()
        compose.onNodeWithContentDescription("Kode autentikator").assertExists()
        compose.onNodeWithText("Autentikator hilang? Pakai kode pemulihan").performClick()
        compose.onNodeWithText("Kode").performTextInput("abcd-1234-5678")
        compose.onNodeWithText("Kode").assert(hasText("ABCD-1234-5678"))
        button("Verifikasi").assertIsEnabled()
        compose.onNodeWithText("Pakai kode autentikator").performClick()
        compose.onNodeWithContentDescription("Kode autentikator").assertExists()
    }

    @Test fun welcomeSheetShowsOnceAndIsRemembered() {
        state(AppState(screen = Screen.Products, email = "grower@example.test", catalogLoaded = true, welcome = true))
        compose.onNodeWithText("Smart Agro siap menemani pot Anda").assertIsDisplayed()
        button("Mulai").performScrollTo().performClick()
        compose.onNodeWithText("Smart Agro siap menemani pot Anda").assertDoesNotExist()
        assertFalse(model.state.welcome)
        // Robolectric keeps a separate SharedPreferences map on the Activity's Application wrapper; verify the Application the ViewModel actually reads.
        assertTrue(model.getApplication<android.app.Application>().getSharedPreferences("smart-agro", 0).getBoolean("welcome-seen", false))
    }

    /** Review renders of the steps the emulator cannot reach without sending real email (debug talks to production). */
    private fun shot(name: String) = compose.runOnIdle {
        val view = compose.activity.window.decorView
        val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888).also { view.draw(Canvas(it)) }
        val folder = File(requireNotNull(System.getProperty("smartagro.screenshots")), "a4a").apply { mkdirs() }
        File(folder, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
    private fun codePages(tag: String) {
        state(AppState(auth = AuthStep.SignupCode, authEmail = "grower@example.test"))
        compose.onNodeWithContentDescription("Kode verifikasi").performTextInput("1234")
        shot("$tag-1-kode-daftar")
        state(AppState(auth = AuthStep.ResetCode, authEmail = "grower@example.test"))
        compose.onNodeWithContentDescription("Kode verifikasi").performTextInput("123456")
        compose.onNodeWithText("Sandi baru").performTextInput("pendek")
        shot("$tag-2-kode-reset")
        state(AppState(screen = Screen.Mfa, message = "Kode verifikasi tidak berlaku. Gunakan kode terbaru dari autentikator.", messageIsError = true))
        shot("$tag-3-2fa")
        state(AppState(auth = AuthStep.SignIn, authEmail = "grower@example.test", message = "Email ini sudah terdaftar. Silakan masuk."))
        shot("$tag-4-sudah-terdaftar")
        state(AppState(screen = Screen.Products, email = "grower@example.test", catalogLoaded = true, welcome = true))
        shot("$tag-5-sambutan")
    }
    @GraphicsMode(GraphicsMode.Mode.NATIVE) @Test fun codePagesRenderLight() = codePages("terang")
    @GraphicsMode(GraphicsMode.Mode.NATIVE) @Config(sdk = [34], qualifiers = "w390dp-h844dp-night-mdpi")
    @Test fun codePagesRenderDark() = codePages("gelap")

    @Config(sdk = [34], qualifiers = "w320dp-h640dp-mdpi")
    @Test fun signInAndCodeFitA320dpScreenAtDoubleTextSize() {
        compose.runOnIdle {
            val resources = compose.activity.resources
            val configuration = android.content.res.Configuration(resources.configuration).apply { fontScale = 2f }
            @Suppress("DEPRECATION") resources.updateConfiguration(configuration, resources.displayMetrics)
        }
        compose.activityRule.scenario.recreate()
        fun whole(text: String) {
            val node = compose.onNodeWithText(text).assertExists()
            val layouts = mutableListOf<TextLayoutResult>()
            node.performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layouts) }
            val layout = layouts.first()
            assertEquals("all of \"$text\" is laid out", text.length, layout.getLineEnd(layout.lineCount - 1, visibleEnd = true))
            val bounds = node.fetchSemanticsNode().boundsInRoot
            assertTrue("\"$text\" inside the screen: $bounds", bounds.left >= 0 && bounds.right <= 320)
        }
        whole("Masuk ke Smart Agro")
        whole("Satu akun untuk pot, data sensor, dan poin Anda.")
        state(AppState(auth = AuthStep.SignupCode, authEmail = "grower@example.test"))
        whole("Cek email Anda")
        val boxes = compose.onNodeWithContentDescription("Kode verifikasi").fetchSemanticsNode().boundsInRoot
        assertTrue("six code boxes fit: $boxes", boxes.left >= 0 && boxes.right <= 320)
    }
}
