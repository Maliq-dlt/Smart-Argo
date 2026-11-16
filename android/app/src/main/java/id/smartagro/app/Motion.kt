package id.smartagro.app

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput

/** A quiet press cue without a ripple or overshoot; Compose honors the system animation scale. */
internal fun Modifier.pressFeedback(): Modifier = composed {
    var pressed by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(if(pressed) .98f else 1f,spring(dampingRatio=1f,stiffness=700f),label="Tekan")
    graphicsLayer { scaleX=scale;scaleY=scale }.pointerInput(Unit) {
        awaitEachGesture {
            awaitFirstDown(requireUnconsumed=false)
            pressed=true
            try { waitForUpOrCancellation() } finally { pressed=false }
        }
    }
}
