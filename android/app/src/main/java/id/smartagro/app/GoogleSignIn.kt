package id.smartagro.app

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64

/** Google verifies the device/app; Supabase verifies the signed ID token and the original nonce. */
internal suspend fun googleCredential(context: Context, clientId: String): Pair<String,String> {
    require(Regex("[0-9]+-[A-Za-z0-9_-]+\\.apps\\.googleusercontent\\.com").matches(clientId)) {
        "Login Google belum dikonfigurasi untuk aplikasi Android ini. Gunakan email atau buka website."
    }
    val nonce=Base64.getUrlEncoder().withoutPadding().encodeToString(ByteArray(32).also { SecureRandom().nextBytes(it) })
    val hashed=MessageDigest.getInstance("SHA-256").digest(nonce.toByteArray()).joinToString("") { "%02x".format(it) }
    val option=GetSignInWithGoogleOption.Builder(clientId).setNonce(hashed).build()
    try {
        val response=CredentialManager.create(context).getCredential(context,GetCredentialRequest.Builder().addCredentialOption(option).build())
        val credential=response.credential
        require(credential is CustomCredential && credential.type==GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL) { "Respons Google tidak dikenali. Coba lagi." }
        return GoogleIdTokenCredential.createFrom(credential.data).idToken to nonce
    } catch (_: GetCredentialCancellationException) { throw ApiFailure("Masuk dengan Google dibatalkan.") }
    catch (_: GetCredentialException) { throw ApiFailure("Google belum dapat masuk. Periksa koneksi, Google Play Services, dan konfigurasi aplikasi Android.") }
}
