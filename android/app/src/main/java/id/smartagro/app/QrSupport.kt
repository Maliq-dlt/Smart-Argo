package id.smartagro.app

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.core.content.FileProvider
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.EncodeHintType
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.common.GlobalHistogramBinarizer
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeReader
import com.google.zxing.qrcode.QRCodeWriter
import java.io.File
import kotlin.math.max
import kotlin.math.roundToInt

internal data class QrMatrix(val side: Int, val dark: BooleanArray)

internal fun encodeQrMatrix(content: String): QrMatrix? {
    if (content.isBlank() || content.length > 2048) return null
    return runCatching {
        val matrix = QRCodeWriter().encode(
            content,
            BarcodeFormat.QR_CODE,
            0,
            0,
            mapOf(EncodeHintType.MARGIN to 1),
        )
        val side = matrix.width
        val dark = BooleanArray(side * side) { idx -> matrix.get(idx % side, idx / side) }
        QrMatrix(side, dark)
    }.getOrNull()
}

internal fun decodeQrFromBitmap(bitmap: Bitmap): String? {
    val maxDim = max(bitmap.width, bitmap.height).coerceAtLeast(1)
    val scaled = if (maxDim > 1400) {
        val ratio = 1400f / maxDim
        Bitmap.createScaledBitmap(bitmap, (bitmap.width * ratio).roundToInt().coerceAtLeast(1), (bitmap.height * ratio).roundToInt().coerceAtLeast(1), true)
    } else bitmap
    val argb = if (scaled.config == Bitmap.Config.ARGB_8888) scaled else scaled.copy(Bitmap.Config.ARGB_8888, false)
    val w = argb.width
    val h = argb.height
    val pixels = IntArray(w * h)
    argb.getPixels(pixels, 0, w, 0, 0, w, h)
    val source = RGBLuminanceSource(w, h, pixels)
    val reader = QRCodeReader()
    val hints = mapOf(DecodeHintType.TRY_HARDER to true, DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE))
    return runCatching { reader.decode(BinaryBitmap(HybridBinarizer(source)), hints).text }.getOrNull()
        ?: runCatching { reader.decode(BinaryBitmap(GlobalHistogramBinarizer(source)), hints).text }.getOrNull()
}

internal fun decodeQrFromUri(context: Context, uri: Uri): String? = runCatching {
    context.contentResolver.openInputStream(uri)?.use { stream ->
        val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        val bytes = stream.readBytes()
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
        var sample = 1
        while (max(options.outWidth / sample, options.outHeight / sample) > 1400) sample *= 2
        val decodeOpts = BitmapFactory.Options().apply { inSampleSize = sample }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, decodeOpts)?.let(::decodeQrFromBitmap)
    }
}.getOrNull()

internal fun tempCameraQrUri(context: Context, prefix: String = "qr-scan"): Uri {
    val dir = File(context.cacheDir, "shared").apply { mkdirs() }
    val target = File(dir, "$prefix-${System.currentTimeMillis()}.jpg")
    return FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", target)
}

internal fun shareTextFile(context: Context, filename: String, mimeType: String, title: String, content: String) {
    val safeName = filename.replace(Regex("[^A-Za-z0-9._-]"), "_")
    val dir = File(context.cacheDir, "shared").apply { mkdirs() }
    val target = File(dir, safeName)
    target.writeText(content, Charsets.UTF_8)
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", target)
    val intent = Intent(Intent.ACTION_SEND).apply {
        type = mimeType
        putExtra(Intent.EXTRA_STREAM, uri)
        putExtra(Intent.EXTRA_SUBJECT, title)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    }
    context.startActivity(Intent.createChooser(intent, title).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
}

/** Crisp white-backed vector QR code for TOTP authenticator enrollment. Always dark modules on white for reliable scanning. */
@Composable
internal fun QrMatrixBox(content: String, label: String, modifier: Modifier = Modifier) {
    val matrix = remember(content) { encodeQrMatrix(content) } ?: return
    Box(
        modifier
            .clip(RoundedCornerShape(18.dp))
            .background(Color.White)
            .padding(14.dp)
            .semantics { contentDescription = label },
    ) {
        Canvas(Modifier.fillMaxSize()) {
            val cell = size.minDimension / matrix.side
            val offsetX = (size.width - cell * matrix.side) / 2f
            val offsetY = (size.height - cell * matrix.side) / 2f
            for (y in 0 until matrix.side) {
                for (x in 0 until matrix.side) {
                    if (matrix.dark[y * matrix.side + x]) {
                        drawRect(
                            color = Color(0xFF141B16),
                            topLeft = Offset(offsetX + x * cell, offsetY + y * cell),
                            size = Size(cell + 0.5f, cell + 0.5f),
                        )
                    }
                }
            }
        }
    }
}
