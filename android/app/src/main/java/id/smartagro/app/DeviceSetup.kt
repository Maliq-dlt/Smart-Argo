package id.smartagro.app

import android.Manifest
import android.app.Activity
import android.view.WindowManager
import kotlinx.coroutines.CancellationException
import android.content.Context
import android.content.pm.PackageManager
import android.net.*
import android.net.wifi.WifiNetworkSpecifier
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

internal fun wifiFormError(ssid: String, pass: String): String? = when {
    ssid.toByteArray(Charsets.UTF_8).size !in 1..32 -> "Nama Wi-Fi harus 1-32 byte UTF-8."
    pass.isNotEmpty() && pass.toByteArray(Charsets.UTF_8).size !in 8..63 -> "Sandi Wi-Fi harus kosong atau 8-63 byte UTF-8."
    else -> null
}

// Only this socket uses the setup network; cloud/auth traffic keeps the default validated network.
internal suspend fun setupPost(network: Network, path: String, values: Map<String, String>): JSONObject? = withContext(Dispatchers.IO) {
    require(path in setOf("/save", "/api/calibration"))
    val body = values.entries.joinToString("&") { (key, value) -> "${URLEncoder.encode(key, "UTF-8")}=${URLEncoder.encode(value, "UTF-8")}" }
    val connection = network.openConnection(URL("http://192.168.4.1$path")) as HttpURLConnection
    try {
        connection.requestMethod = "POST"
        connection.instanceFollowRedirects = false
        connection.connectTimeout = 8_000
        connection.readTimeout = 8_000
        connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
        if (path == "/api/calibration") connection.setRequestProperty("X-Smart-Agro-Setup", "1")
        connection.doOutput = true
        connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
        check(connection.responseCode == 200) { "Perangkat menolak permintaan (${connection.responseCode}). Periksa probe dan ulangi." }
        val response = connection.inputStream.bufferedReader().use { it.readText() }
        if (path == "/save") {
            check(response.contains("Tersimpan")) { "Wi-Fi belum dikonfirmasi tersimpan." }
            null
        } else JSONObject(response).also { check(it.optBoolean("ok")) { "Kalibrasi ditolak perangkat." } }
    } finally { connection.disconnect() }
}

/** Whether the probe already holds a dry/wet pair (GET /api/calibration). Unknown counts as not calibrated. */
internal suspend fun setupHasMoistureCalibration(network: Network): Boolean = withContext(Dispatchers.IO) {
    val connection = network.openConnection(URL("http://192.168.4.1/api/calibration")) as HttpURLConnection
    try {
        connection.instanceFollowRedirects = false
        connection.connectTimeout = 8_000
        connection.readTimeout = 8_000
        connection.responseCode == 200 && JSONObject(connection.inputStream.bufferedReader().use { it.readText() }).optBoolean("moisture_saved")
    } catch (_: Exception) { false } finally { connection.disconnect() }
}

@Composable internal fun DeviceSetupSheet(onClose: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val manager = remember { context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager }
    var callback by remember { mutableStateOf<ConnectivityManager.NetworkCallback?>(null) }
    var network by remember { mutableStateOf<Network?>(null) }
    var ap by remember { mutableStateOf("SmartAgro-") }
    var labelPassword by remember { mutableStateOf("") }
    var ssid by remember { mutableStateOf("") }
    var pass by remember { mutableStateOf("") }
    var step by remember { mutableIntStateOf(0) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    // A new calibration changes the moisture scale, so the server restarts the pot's own pattern (7 days) from it.
    // Changing Wi-Fi on a calibrated probe must not force that.
    var calibrated by remember { mutableStateOf(false) }
    LaunchedEffect(network) { calibrated = network?.let { setupHasMoistureCalibration(it) } ?: false }
    val browser = rememberSafeUriHandler()
    fun release() {
        callback?.let { runCatching { manager.unregisterNetworkCallback(it) } }
        callback = null
        network = null
    }
    DisposableEffect(Unit) {
        val window = (context as? Activity)?.window
        val wasSecure = window?.attributes?.flags?.and(WindowManager.LayoutParams.FLAG_SECURE) != 0
        window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        onDispose { if (!wasSecure) window?.clearFlags(WindowManager.LayoutParams.FLAG_SECURE) }
    }
    DisposableEffect(Unit) { onDispose { callback?.let { runCatching { manager.unregisterNetworkCallback(it) } } } }
    fun connect() {
        if (Build.VERSION.SDK_INT < 29) return
        if (!ap.startsWith("SmartAgro-") || ap.toByteArray().size !in 11..32 || labelPassword.length !in 8..63 || labelPassword.any { it.code !in 32..126 }) {
            message = "Isi nama jaringan SmartAgro lengkap dan sandi 8-63 karakter dari label."
            return
        }
        release()
        busy = true
        message = "Setujui sambungan Wi-Fi perangkat pada dialog Android."
        val listener = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(value: Network) { if (callback !== this) return; network = value; busy = false; step = 1; labelPassword = ""; message = null }
            override fun onUnavailable() { if (callback !== this) return; busy = false; message = "Sambungan tidak tersedia atau dibatalkan. Aktifkan mode setup dan coba lagi." }
            override fun onLost(value: Network) { if (callback !== this) return; if (network == value) { network = null; busy = false; if (step != 4) { step = 0; message = "Sambungan setup terputus. Sambungkan ulang dan ulangi kalibrasi." } } }
        }
        callback = listener
        try {
            val specifier = WifiNetworkSpecifier.Builder().setSsid(ap).setWpa2Passphrase(labelPassword).build()
            manager.requestNetwork(NetworkRequest.Builder().addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).setNetworkSpecifier(specifier).build(),
                listener, Handler(Looper.getMainLooper()), 45_000)
        } catch (_: Exception) { release(); busy = false; message = "Tidak dapat meminta jaringan. Aktifkan Wi-Fi serta izin perangkat sekitar/lokasi." }
    }
    val permission = if (Build.VERSION.SDK_INT >= 33) Manifest.permission.NEARBY_WIFI_DEVICES else Manifest.permission.ACCESS_FINE_LOCATION
    val requestPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        if (granted[permission] == true) connect() else message = "Izin diperlukan untuk menyambung jaringan perangkat. Anda dapat memakai portal browser."
    }
    fun submit(path: String, values: Map<String, String>, next: Int) {
        val pinned = network ?: return
        busy = true
        message = null
        scope.launch {
            try {
                val result = setupPost(pinned, path, values)
                if (next == 3) check(result?.optBoolean("saved") == true) { "Pasangan kering/basah belum tersimpan. Ulangi titik basah." }
                step = next
                if (next == 4) { pass = ""; release() }
            } catch (_: java.io.IOException) { message = "Respons tidak diterima. Periksa jaringan; bila Wi-Fi sudah dikirim, cek bacaan cloud sebelum mengulang setup." }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (error: IllegalStateException) { message = error.message }
            catch (_: Exception) { message = "Respons perangkat tidak valid. Ulangi langkah ini." }
            finally { busy = false }
        }
    }
    AgroSheet("Siapkan perangkat", onClose) {
        Footnote("Tekan EN lalu tahan BOOT 2 detik. Setup ditutup setelah 10 menit tanpa aktivitas. Kalibrasi harus disimpan sebelum Wi-Fi rumah karena alat akan memulai ulang.")
        if (Build.VERSION.SDK_INT < 29) {
            Footnote("Android 8-9: buka pengaturan Wi-Fi, sambung ke SmartAgro pada label, lalu buka portal. Kalibrasi kering dan basah dahulu, baru simpan Wi-Fi rumah.")
            PrimaryButton("Buka portal perangkat", { browser.openUri("http://192.168.4.1/") }, Modifier.padding(16.dp).fillMaxWidth())
        } else when (step) {
            0 -> {
                Group {
                    FieldRow("Jaringan alat", ap, { ap = it }, "SmartAgro-...")
                    FieldRow("Sandi label", labelPassword, { labelPassword = it }, secure = true)
                }
                PrimaryButton(if (busy) "Menyambungkan..." else "Sambung ke alat", {
                    if (ContextCompat.checkSelfPermission(context, permission) == PackageManager.PERMISSION_GRANTED) connect() else requestPermission.launch(if (Build.VERSION.SDK_INT >= 33) arrayOf(permission) else arrayOf(Manifest.permission.ACCESS_COARSE_LOCATION, permission))
                }, Modifier.padding(16.dp).fillMaxWidth(), enabled = !busy)
            }
            1, 2 -> {
                Footnote(if (step == 1) "Tempatkan probe kelembapan di media kering acuan dan tunggu stabil. Titik kering belum menjadi kalibrasi lengkap sampai titik basah tersimpan."
                    else "Tempatkan probe di kondisi basah acuan sesuai manual pemasok; tunggu stabil. Jangan rendam bagian elektronik.")
                PrimaryButton(if (busy) "Merekam..." else if (step == 1) "Rekam kering" else "Rekam basah", {
                    submit("/api/calibration", mapOf("point" to if (step == 1) "dry" else "wet"), step + 1)
                }, Modifier.padding(16.dp).fillMaxWidth(), enabled = !busy && network != null)
                if (step == 1 && calibrated) {
                    Footnote("Alat ini sudah terkalibrasi. Kalibrasi ulang membuat pola pot dipelajari lagi dari awal (7 hari).")
                    PlainButton("Pakai kalibrasi tersimpan", { step = 3 }, enabled = !busy && network != null)
                }
            }
            3 -> {
                Footnote("Kalibrasi kelembapan tersimpan. Masukkan Wi-Fi rumah 2,4 GHz. Penyimpanan akan memulai ulang alat. pH memakai prosedur buffer khusus di portal, sesuai manual probe.")
                Group {
                    FieldRow("Wi-Fi rumah", ssid, { ssid = it })
                    FieldRow("Sandi Wi-Fi", pass, { pass = it }, secure = true)
                }
                PrimaryButton(if (busy) "Menyimpan..." else "Simpan Wi-Fi dan mulai ulang", {
                    val error = wifiFormError(ssid, pass)
                    if (error != null) message = error else submit("/save", mapOf("ssid" to ssid, "pass" to pass), 4)
                }, Modifier.padding(16.dp).fillMaxWidth(), enabled = !busy && network != null)
            }
            4 -> Footnote("Perangkat mengonfirmasi Wi-Fi tersimpan dan memulai ulang. Sambungkan HP kembali ke internet, lalu segarkan bacaan. Respons ini belum membuktikan koneksi router atau kiriman cloud berhasil.")
        }
        message?.let { Footnote(it) }
    }
}
