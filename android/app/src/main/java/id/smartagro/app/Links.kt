package id.smartagro.app

import android.content.ActivityNotFoundException
import android.widget.Toast
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.UriHandler

@Composable internal fun rememberSafeUriHandler(): UriHandler {
    val handler=LocalUriHandler.current
    val context=LocalContext.current
    return remember(handler,context) { object: UriHandler {
        override fun openUri(uri: String) {
            try { handler.openUri(uri) }
            catch (_: ActivityNotFoundException) { Toast.makeText(context,"Tidak ada browser yang dapat membuka tautan ini.",Toast.LENGTH_LONG).show() }
            catch (_: SecurityException) { Toast.makeText(context,"Tautan tidak dapat dibuka di perangkat ini.",Toast.LENGTH_LONG).show() }
        }
    } }
}
