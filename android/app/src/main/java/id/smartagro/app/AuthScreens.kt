package id.smartagro.app

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.LineBreak
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import java.time.LocalTime
import kotlin.math.min

/* Signed-out screens (A4a). The web's sign-in card, rebuilt as an iOS form: labelled fields in one grouped cell, a
 * segmented Masuk/Daftar switch that grows the form in place, and pushed steps for the emailed and authenticator codes. */

private val EMAIL = Regex("^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$")
private val SPARE_CODE = Regex("[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}")

/** Welcome cover, email form, signup code and the two reset steps as one navigation stack; typed inputs survive revisiting. */
@Composable internal fun AuthFlow(state: AppState, model: AgroViewModel, google: (() -> Unit)?) {
    val saved = rememberSaveableStateHolder()
    val page = if (state.auth == AuthStep.SignUp) AuthStep.SignIn else state.auth
    AnimatedContent(page, Modifier.fillMaxSize().background(palette.canvas), transitionSpec = { stack(targetState.ordinal > initialState.ordinal) },
        label = "Langkah masuk") { step ->
        saved.SaveableStateProvider(step.name) {
            when (step) {
                AuthStep.Welcome -> AuthWelcome(state, model, google)
                AuthStep.SignIn, AuthStep.SignUp -> AuthForm(state, model, google)
                AuthStep.SignupCode -> SignupCode(state, model)
                AuthStep.ResetEmail -> ResetEmail(state, model)
                AuthStep.ResetCode -> ResetCode(state, model)
            }
        }
    }
}

/** Brand-first welcome cover: live local-time sky, layered terasering, Smart Agro mark, separate access actions, zero mascot. */
@Composable private fun AuthWelcome(state: AppState, model: AgroViewModel, google: (() -> Unit)?) {
    val p = palette
    val localTime by produceState(LocalTime.now()) {
        while (true) {
            value = LocalTime.now()
            delay(60_000L - value.second * 1_000L - value.nano / 1_000_000L)
        }
    }
    val phase = timePhaseFor(localTime.hour)
    val configured = model.config.valid
    Box(Modifier.fillMaxSize()) {
        BotanicalSkyBackdrop(localTime, Modifier.fillMaxSize())
        // Gentle readability veil so hero text stays crisp across all 4 local-time sky phases.
        Box(
            Modifier
                .fillMaxSize()
                .background(
                    Brush.verticalGradient(
                        listOf(Color(0x380A1D16), Color(0x280A1D16), Color(0x880A1D16)),
                    ),
                ),
        )
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .statusBarsPadding()
                .navigationBarsPadding()
                .padding(horizontal = 16.dp, vertical = 16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            Column(
                Modifier.widthIn(max = 460.dp).fillMaxWidth().padding(top = 12.dp, bottom = 20.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Row(
                    Modifier
                        .clip(RoundedCornerShape(50))
                        .background(Color(0x52091B14))
                        .border(.75.dp, Color.White.copy(alpha = .24f), RoundedCornerShape(50))
                        .padding(horizontal = 14.dp, vertical = 7.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(7.dp),
                ) {
                    Icon(icon(phase.glyph), null, Modifier.size(16.dp), tint = Color(0xFFE7F5D8))
                    Text(phase.greeting, style = T.footnote.copy(fontWeight = FontWeight.Medium), color = Color(0xFFF3F8F2))
                }
                Spacer(Modifier.height(26.dp))
                Box(
                    Modifier
                        .size(80.dp)
                        .shadow(20.dp, RoundedCornerShape(22.dp), ambientColor = Color(0x80071A13), spotColor = Color(0x80071A13))
                        .clip(RoundedCornerShape(22.dp))
                        .border(1.dp, Color.White.copy(alpha = .28f), RoundedCornerShape(22.dp)),
                ) {
                    SmartAgroMark(Modifier.fillMaxSize())
                }
                Spacer(Modifier.height(18.dp))
                Text(
                    "Smart Agro",
                    Modifier.padding(horizontal = 12.dp).semantics { heading() },
                    style = T.largeTitle.balanced(),
                    color = Color(0xFFF7FBF6),
                    textAlign = TextAlign.Center,
                )
                Text(
                    "Pantau kelembapan, suhu, dan pH pot Anda dengan tenang.",
                    Modifier.padding(start = 16.dp, end = 16.dp, top = 8.dp),
                    style = T.subhead.balanced(),
                    color = Color(0xFFE0ECE3),
                    textAlign = TextAlign.Center,
                )
            }

            Column(
                Modifier
                    .widthIn(max = 460.dp)
                    .fillMaxWidth()
                    .shadow(24.dp, RoundedCornerShape(30.dp), ambientColor = Color(0x55000000), spotColor = Color(0x55000000))
                    .clip(RoundedCornerShape(30.dp))
                    .background(p.cell)
                    .border(.75.dp, p.separator, RoundedCornerShape(30.dp))
                    .padding(horizontal = 18.dp, vertical = 20.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                if (!configured) {
                    Banner(
                        "Layanan akun belum tersedia pada versi aplikasi ini. Anda tetap bisa mencoba mode latihan.",
                        Modifier.padding(bottom = 12.dp),
                    )
                }
                state.message?.let { msg ->
                    Banner(msg, Modifier.padding(bottom = 12.dp), state.messageIsError)
                }
                if (google != null) {
                    PrimaryButton(
                        if (state.busy) "Menghubungkan Google…" else "Lanjutkan dengan Google",
                        google,
                        Modifier.fillMaxWidth(),
                        enabled = configured && !state.busy,
                        busy = state.busy,
                        path = PhosphorPaths.GoogleLogo,
                    )
                    Spacer(Modifier.height(10.dp))
                    TintedButton(
                        "Masuk dengan email",
                        { model.authStep(AuthStep.SignIn) },
                        Modifier.fillMaxWidth(),
                        enabled = !state.busy,
                        path = PhosphorPaths.EnvelopeSimple,
                    )
                } else {
                    PrimaryButton(
                        "Masuk dengan email",
                        { model.authStep(AuthStep.SignIn) },
                        Modifier.fillMaxWidth(),
                        enabled = !state.busy,
                        path = PhosphorPaths.EnvelopeSimple,
                    )
                }
                Spacer(Modifier.height(10.dp))
                TintedButton(
                    "Buat akun",
                    { model.authStep(AuthStep.SignUp) },
                    Modifier.fillMaxWidth(),
                    enabled = !state.busy,
                    path = PhosphorPaths.PlusBold,
                )
                PlainButton(
                    "Jelajahi mode latihan",
                    model::demo,
                    Modifier.padding(top = 6.dp),
                    enabled = !state.busy,
                    path = PhosphorPaths.Leaf,
                )
                Text(
                    "Akun yang sama dengan website Smart Agro.",
                    Modifier.padding(top = 4.dp, start = 12.dp, end = 12.dp),
                    style = T.footnote.balanced(),
                    color = p.secondary,
                    textAlign = TextAlign.Center,
                )
            }
        }
    }
}

@Composable private fun AuthForm(state: AppState, model: AgroViewModel, google: (() -> Unit)?) {
    val p = palette
    val signUp = state.auth == AuthStep.SignUp
    val focus = LocalFocusManager.current
    var name by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable(state.authEmail) { mutableStateOf(state.authEmail) }
    // Passwords stay in memory only: never in saved state, logs or preferences.
    var password by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var nameFocused by remember { mutableStateOf(false) }
    var emailFocused by remember { mutableStateOf(false) }
    var secretFocused by remember { mutableStateOf(false) }
    val configured = model.config.valid
    val ready = configured && !state.busy && EMAIL.matches(email.trim()) &&
        if (signUp) name.isNotBlank() && password.length >= 10 && confirm == password else password.isNotEmpty()
    val signUpPasswordIssue = signUp && ((password.isNotEmpty() && password.length < 10) || (confirm.isNotEmpty() && confirm != password))
    val mascotMood = when {
        secretFocused -> MascotMood.Shy
        state.messageIsError && state.message != null -> MascotMood.Care
        signUpPasswordIssue -> MascotMood.Care
        ready -> MascotMood.Happy
        emailFocused || nameFocused -> MascotMood.Reading
        else -> MascotMood.Smile
    }
    val mascotLabel = when {
        secretFocused -> "Menjaga sandi"
        state.messageIsError && state.message != null -> "Perlu diperiksa"
        signUpPasswordIssue -> "Periksa sandi"
        ready -> if (signUp) "Siap daftar" else "Siap masuk"
        emailFocused || nameFocused -> "Mengamati"
        else -> "Tenang"
    }
    val submit = {
        if (ready) {
            focus.clearFocus()
            if (signUp) model.signup(name, email, password) else model.login(email, password)
            password = ""
            confirm = ""
        }
    }
    Column(Modifier.fillMaxSize().background(p.canvas)) {
        NavBar("", 0f, titleAlpha = 0f, back = "Awal", onBack = { if (!state.busy) model.authStep(AuthStep.Welcome, email) })
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).navigationBarsPadding().padding(bottom = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally) {
            Column(Modifier.widthIn(max = 480.dp).fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                Mascot(
                    Modifier.padding(top = 4.dp).size(104.dp, 116.dp),
                    mood = mascotMood,
                    gaze = when {
                        emailFocused -> min(1f, email.length / 32f)
                        nameFocused -> min(1f, name.length / 20f)
                        else -> .35f
                    },
                    interactive = true,
                )
                MascotPill(mascotMood, Modifier.padding(top = 2.dp), customLabel = mascotLabel)
                AnimatedContent(signUp, transitionSpec = { fadeIn(tween(220)) togetherWith fadeOut(tween(220)) }, label = "Judul masuk") { up ->
                    Text(if (up) "Buat akun Smart Agro" else "Masuk ke Smart Agro", Modifier.padding(start = 24.dp, end = 24.dp, top = 10.dp).semantics { heading() },
                        style = T.title1.balanced(), color = p.ink, textAlign = TextAlign.Center)
                }
                Text("Satu akun untuk pot, data sensor, dan poin Anda.", Modifier.padding(start = 32.dp, end = 32.dp, top = 6.dp),
                    style = T.subhead.balanced(), color = p.secondary, textAlign = TextAlign.Center)
                Segmented(listOf("Masuk", "Daftar"), if (signUp) 1 else 0, { model.authStep(if (it == 1) AuthStep.SignUp else AuthStep.SignIn, email) },
                    Modifier.padding(start = 16.dp, end = 16.dp, top = 18.dp, bottom = 14.dp))
                Group {
                    Reveal(signUp) {
                        FieldRow("Nama", name, { if (it.length <= 40) name = it }, placeholder = "Nama panggilan", type = ContentType.PersonFullName,
                            capitalize = true, onFocus = { nameFocused = it }, enabled = !state.busy)
                    }
                    FieldRow("Email", email, { if (it.length <= 320) email = it }, placeholder = "nama@email.com", keyboard = KeyboardType.Email,
                        type = ContentType.Username + ContentType.EmailAddress, onFocus = { emailFocused = it }, enabled = !state.busy)
                    FieldRow("Kata sandi", password, { password = it.take(256) }, placeholder = if (signUp) "Minimal 10 karakter" else "Wajib diisi",
                        secure = true, type = if (signUp) ContentType.NewPassword else ContentType.Password, ime = if (signUp) ImeAction.Next else ImeAction.Done,
                        onIme = if (signUp) null else submit, onFocus = { secretFocused = it }, enabled = !state.busy)
                    Reveal(signUp) {
                        FieldRow("Konfirmasi", confirm, { confirm = it.take(256) }, placeholder = "Ketik ulang sandi", secure = true,
                            type = ContentType.NewPassword, ime = ImeAction.Done, onIme = submit, onFocus = { secretFocused = it }, enabled = !state.busy)
                    }
                }
                Reveal(signUp) { PasswordHint(password, confirm) }
                if (!configured) Banner("Layanan akun belum tersedia pada versi aplikasi ini. Anda tetap bisa mencoba mode latihan.",
                    Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp))
                Message(state)
                PrimaryButton(when { signUp && state.busy -> "Membuat akun…"; signUp -> "Buat akun"; state.busy -> "Memeriksa…"; else -> "Masuk" }, submit,
                    Modifier.padding(start = 16.dp, end = 16.dp, top = 20.dp).fillMaxWidth(), enabled = ready || state.busy, busy = state.busy)
                Reveal(!signUp) {
                    PlainButton("Lupa kata sandi?", { model.authStep(AuthStep.ResetEmail, email) }, Modifier.padding(top = 4.dp), enabled = !state.busy)
                }
                if (google != null) {
                    OrDivider()
                    TintedButton("Lanjut dengan Google", google, Modifier.padding(horizontal = 16.dp).fillMaxWidth(), enabled = configured && !state.busy,
                        path = PhosphorPaths.GoogleLogo)
                }
                PlainButton("Coba mode latihan", model::demo, Modifier.padding(top = 8.dp), enabled = !state.busy)
                Text("Akun yang sama dengan website Smart Agro.", Modifier.padding(horizontal = 32.dp), style = T.footnote.balanced(), color = p.secondary,
                    textAlign = TextAlign.Center)
            }
        }
    }
}

@Composable private fun SignupCode(state: AppState, model: AgroViewModel) {
    var code by remember { mutableStateOf("") }
    LaunchedEffect(state.message, state.messageIsError) { if (state.messageIsError) code = "" }
    StepPage("Daftar", model::back, PhosphorPaths.EnvelopeSimple, "Cek email Anda", sentTo("Kami kirim kode 6 angka ke ", state.authEmail, "."), state.busy) {
        CodeBoxes(code, { code = it; if (it.length == 6 && !state.busy) model.verifySignup(it) }, enabled = !state.busy)
        Message(state)
        PrimaryButton(if (state.busy) "Memeriksa…" else "Verifikasi", { model.verifySignup(code) }, Modifier.padding(start = 16.dp, end = 16.dp, top = 20.dp).fillMaxWidth(),
            enabled = code.length == 6 || state.busy, busy = state.busy)
        Resend(!state.busy, model::resendSignup)
        Text("Tidak ada? Periksa folder Spam atau Promosi.", Modifier.padding(horizontal = 32.dp), style = T.footnote.balanced(), color = palette.secondary,
            textAlign = TextAlign.Center)
    }
}

@Composable private fun ResetEmail(state: AppState, model: AgroViewModel) {
    var email by rememberSaveable(state.authEmail) { mutableStateOf(state.authEmail) }
    val ok = model.config.valid && !state.busy && EMAIL.matches(email.trim())
    StepPage("Masuk", model::back, PhosphorPaths.Key, "Atur ulang kata sandi", AnnotatedString("Kami kirim kode 6 angka ke email akun Anda."), state.busy) {
        Group {
            FieldRow("Email", email, { if (it.length <= 320) email = it }, placeholder = "nama@email.com", keyboard = KeyboardType.Email,
                type = ContentType.Username + ContentType.EmailAddress, ime = ImeAction.Send, onIme = { if (ok) model.requestReset(email) }, enabled = !state.busy)
        }
        Message(state)
        PrimaryButton(if (state.busy) "Mengirim…" else "Kirim kode", { model.requestReset(email) },
            Modifier.padding(start = 16.dp, end = 16.dp, top = 20.dp).fillMaxWidth(), enabled = ok || state.busy, busy = state.busy)
        if (state.resetCodeRequested) {
            PlainButton("Saya sudah punya kode", { model.authStep(AuthStep.ResetCode) }, enabled = !state.busy)
        }
        WebsiteResetFallback(!state.busy)
    }
}

@Composable private fun ResetCode(state: AppState, model: AgroViewModel) {
    val focus = LocalFocusManager.current
    // Kept after an error: once the code is accepted, a retry only rewrites the password (see AgroViewModel.finishReset).
    var code by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    val ready = !state.busy && code.length == 6 && password.length >= 10 && confirm == password
    val save = {
        if (ready) {
            focus.clearFocus()
            model.finishReset(code, password)
            password = ""
            confirm = ""
        }
    }
    StepPage("Email", model::back, PhosphorPaths.LockSimple, "Buat kata sandi baru",
        sentTo("Masukkan kode yang dikirim ke ", state.authEmail, ", lalu kata sandi baru."), state.busy) {
        CodeBoxes(code, { code = it; if (it.length == 6) focus.moveFocus(FocusDirection.Down) }, enabled = !state.busy)
        Group(Modifier.padding(top = 20.dp)) {
            FieldRow("Sandi baru", password, { password = it.take(256) }, placeholder = "Minimal 10 karakter", secure = true,
                type = ContentType.NewPassword, enabled = !state.busy)
            FieldRow("Konfirmasi", confirm, { confirm = it.take(256) }, placeholder = "Ketik ulang sandi", secure = true,
                type = ContentType.NewPassword, ime = ImeAction.Done, onIme = save, enabled = !state.busy)
        }
        PasswordHint(password, confirm)
        Message(state)
        PrimaryButton(if (state.busy) "Menyimpan…" else "Simpan kata sandi", save, Modifier.padding(start = 16.dp, end = 16.dp, top = 20.dp).fillMaxWidth(),
            enabled = ready || state.busy, busy = state.busy)
        Resend(!state.busy) { model.requestReset(state.authEmail) }
        WebsiteResetFallback(!state.busy)
    }
}

/** The authenticator step after a password or Google sign-in, with the web's recovery-code way out (APP-01). */
@Composable internal fun MfaPage(state: AppState, model: AgroViewModel) {
    var spare by rememberSaveable { mutableStateOf(false) }
    var code by remember { mutableStateOf("") }
    var recovery by remember { mutableStateOf("") }
    LaunchedEffect(state.message, state.messageIsError) { if (state.messageIsError) code = "" }
    val ready = !state.busy && if (spare) SPARE_CODE.matches(recovery) else code.length == 6
    val submit = { if (ready) { if (spare) model.recoverMfa(recovery) else model.verify(code) } }
    StepPage("Masuk", model::back, PhosphorPaths.ShieldCheck, "Verifikasi dua langkah", null, state.busy) {
        // Both ways cross-fade together, so the page never passes through an empty frame.
        AnimatedContent(spare, transitionSpec = { (fadeIn(tween(220)) togetherWith fadeOut(tween(220))).using(SizeTransform(clip = false)) },
            label = "Cara verifikasi") { useSpare ->
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(if (useSpare) "Masukkan salah satu kode pemulihan. Kode hanya berlaku sekali." else "Masukkan kode 6 angka dari aplikasi autentikator Anda.",
                    Modifier.padding(start = 32.dp, end = 32.dp, bottom = 24.dp), style = T.subhead.balanced(), color = palette.secondary, textAlign = TextAlign.Center)
                if (useSpare) Group {
                    FieldRow("Kode", recovery, { recovery = it.uppercase().filter { c -> c.isLetterOrDigit() || c == '-' }.take(14) },
                        placeholder = "XXXX-XXXX-XXXX", keyboard = KeyboardType.Ascii, capitalize = true, ime = ImeAction.Done, onIme = submit, enabled = !state.busy)
                } else CodeBoxes(code, { code = it; if (it.length == 6 && !state.busy) model.verify(it) }, label = "Kode autentikator", enabled = !state.busy)
            }
        }
        Message(state)
        PrimaryButton(if (state.busy) "Memeriksa…" else "Verifikasi", submit, Modifier.padding(start = 16.dp, end = 16.dp, top = 20.dp).fillMaxWidth(),
            enabled = ready || state.busy, busy = state.busy)
        PlainButton(if (spare) "Pakai kode autentikator" else "Autentikator hilang? Pakai kode pemulihan", { spare = !spare }, Modifier.padding(top = 4.dp),
            enabled = !state.busy)
    }
}

/** Shown once after the first sign-in on this phone: three things the app does, like an iOS welcome sheet. */
@Composable internal fun WelcomeSheet(onDone: () -> Unit) {
    val p = palette
    AgroSheet("Selamat datang", onDone) {
        Text("Smart Agro siap menemani pot Anda", Modifier.fillMaxWidth().padding(start = 28.dp, end = 28.dp, top = 8.dp, bottom = 12.dp),
            style = T.title2.balanced(), color = p.ink, textAlign = TextAlign.Center)
        listOf(Triple(PhosphorPaths.Plant, "Tanaman sekilas", "Kelembapan, suhu, dan pH tiap pot, lengkap dengan langit dan cuaca setempat."),
            Triple(PhosphorPaths.Sparkle, "Saran dengan alasan", "Kapan menyiram dan kenapa, dihitung dari data sensor pot Anda."),
            Triple(PhosphorPaths.Medal, "Poin dari perawatan", "Kumpulkan poin dan tukar dengan hadiah di halaman Akun.")).forEach { (glyph, title, text) ->
            Row(Modifier.fillMaxWidth().padding(horizontal = 28.dp, vertical = 12.dp).semantics(mergeDescendants = true) { },
                horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                Icon(icon(glyph), null, Modifier.size(34.dp), tint = p.tint)
                Column(Modifier.weight(1f)) {
                    Text(title, style = T.headline, color = p.ink)
                    Text(text, Modifier.padding(top = 2.dp), style = T.subhead, color = p.secondary)
                }
            }
        }
        PrimaryButton("Mulai", onDone, Modifier.padding(start = 20.dp, end = 20.dp, top = 20.dp).fillMaxWidth())
    }
}

// ---------------------------------------------------------------- Parts

/** A pushed step: back to [back], a symbol in a soft circle, a Fraunces title and a line of explanation. */
@Composable private fun StepPage(back: String, onBack: () -> Unit, glyph: String, title: String, text: AnnotatedString?, busy: Boolean,
                                 content: @Composable ColumnScope.() -> Unit) {
    val p = palette
    Column(Modifier.fillMaxSize().background(p.canvas)) {
        // The way back stays visible while a request runs; it just waits (no button that blinks away and back).
        NavBar("", 0f, titleAlpha = 0f, back = back, onBack = { if (!busy) onBack() })
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).navigationBarsPadding().padding(bottom = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally) {
            Column(Modifier.widthIn(max = 480.dp).fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
                Box(Modifier.padding(top = 8.dp).size(64.dp).clip(CircleShape).background(p.soft), contentAlignment = Alignment.Center) {
                    Icon(icon(glyph), null, Modifier.size(30.dp), tint = p.onSoft)
                }
                Text(title, Modifier.padding(start = 24.dp, end = 24.dp, top = 16.dp).semantics { heading() }, style = T.title1.balanced(), color = p.ink,
                    textAlign = TextAlign.Center)
                if (text != null) Text(text, Modifier.padding(start = 32.dp, end = 32.dp, top = 8.dp, bottom = 24.dp), style = T.subhead.balanced(),
                    color = p.secondary, textAlign = TextAlign.Center)
                else Spacer(Modifier.height(8.dp))
                content()
            }
        }
    }
}

/** Balanced lines for centered text, so a paragraph never ends on one stray word. */
private fun TextStyle.balanced() = copy(lineBreak = LineBreak.Heading)

private fun sentTo(before: String, email: String, after: String) =
    buildAnnotatedString { append(before); withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(email) }; append(after) }

/** Grows or folds part of the form in place on a critically damped spring, without a blank frame. */
@Composable private fun Reveal(visible: Boolean, content: @Composable () -> Unit) =
    AnimatedVisibility(visible, enter = expandVertically(Springs.smooth()) + fadeIn(tween(220)),
        exit = shrinkVertically(Springs.smooth()) + fadeOut(tween(160))) { content() }

/** The current message, folded in and out; the text stays while it folds away. */
@Composable private fun Message(state: AppState) {
    val last = remember { arrayOfNulls<Pair<String, Boolean>>(1) }
    state.message?.let { last[0] = it to state.messageIsError }
    Reveal(state.message != null) {
        last[0]?.let { (text, error) -> Banner(text, Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp), error) }
    }
}

@Composable private fun OrDivider() {
    val p = palette
    Row(Modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 14.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f).height(1.dp).background(p.separator))
        Text("atau", Modifier.padding(horizontal = 12.dp), style = T.footnote, color = p.secondary)
        Box(Modifier.weight(1f).height(1.dp).background(p.separator))
    }
}

/**
 * A row of an iOS form: the label and the field are one text field (the label sits in its decoration), so TalkBack
 * reads them together and a tap anywhere on the row types there. Labels move above the field for large text.
 */
@Composable internal fun FieldRow(label: String, value: String, onValue: (String) -> Unit, placeholder: String = "", secure: Boolean = false,
                                 keyboard: KeyboardType = KeyboardType.Text, ime: ImeAction = ImeAction.Next, onIme: (() -> Unit)? = null,
                                 type: ContentType? = null, capitalize: Boolean = false, enabled: Boolean = true, singleLine: Boolean = true, onFocus: (Boolean) -> Unit = {}) {
    val p = palette
    val focus = LocalFocusManager.current
    var shown by remember { mutableStateOf(false) }
    val stacked = LocalDensity.current.fontScale > 1.15f
    Row(Modifier.fillMaxWidth().heightIn(min = 52.dp), verticalAlignment = Alignment.CenterVertically) {
        BasicTextField(value, onValue, Modifier.weight(1f).onFocusChanged { onFocus(it.isFocused) }.semantics { if (type != null) contentType = type },
            enabled = enabled, singleLine = singleLine, textStyle = T.body.copy(color = if (enabled) p.ink else p.secondary), cursorBrush = SolidColor(p.tint),
            visualTransformation = if (secure && !shown) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = KeyboardOptions(capitalization = if (capitalize) KeyboardCapitalization.Characters.takeIf { keyboard == KeyboardType.Ascii }
                ?: KeyboardCapitalization.Words else KeyboardCapitalization.None, autoCorrectEnabled = false,
                keyboardType = if (secure) KeyboardType.Password else keyboard, imeAction = ime),
            keyboardActions = KeyboardActions(onAny = { if (onIme != null) onIme() else focus.moveFocus(FocusDirection.Down) }),
            decorationBox = { inner ->
                val field = @Composable {
                    Box(contentAlignment = Alignment.CenterStart) {
                        if (value.isEmpty()) Text(placeholder, style = T.body, color = p.tertiary, maxLines = 2)
                        inner()
                    }
                }
                val edge = Modifier.fillMaxWidth().padding(start = 16.dp, end = if (secure) 0.dp else 16.dp)
                if (stacked) Column(edge.padding(vertical = 10.dp)) {
                    Text(label, style = T.subhead, color = p.secondary)
                    Box(Modifier.padding(top = 4.dp)) { field() }
                } else Row(edge.padding(vertical = 15.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(label, Modifier.width(108.dp), style = T.body, color = p.ink)
                    Box(Modifier.weight(1f)) { field() }
                }
            })
        if (secure) Box(Modifier.size(48.dp).clip(CircleShape).clickable(role = Role.Button) { shown = !shown }
            .semantics { contentDescription = if (shown) "Sembunyikan kata sandi" else "Tampilkan kata sandi" }, contentAlignment = Alignment.Center) {
            Icon(icon(if (shown) PhosphorPaths.EyeSlash else PhosphorPaths.Eye), null, Modifier.size(20.dp), tint = p.secondary)
        }
    }
}

/**
 * Six boxes over one hidden field. The box waiting for the next digit has a steady tinted edge instead of a blinking
 * caret; the keyboard opens on arrival, and Android's one-time-code autofill can fill it.
 */
@Composable private fun CodeBoxes(value: String, onValue: (String) -> Unit, label: String = "Kode verifikasi", enabled: Boolean = true) {
    val p = palette
    val requester = remember { FocusRequester() }
    var focused by remember { mutableStateOf(false) }
    val scale = LocalDensity.current.fontScale
    LaunchedEffect(Unit) { runCatching { requester.requestFocus() } }
    BasicTextField(value, { next -> onValue(next.filter(Char::isDigit).take(6)) },
        Modifier.padding(horizontal = 16.dp).widthIn(max = 360.dp).fillMaxWidth().focusRequester(requester).onFocusChanged { focused = it.isFocused }
            .semantics { contentDescription = label; contentType = ContentType.SmsOtpCode },
        enabled = enabled, singleLine = true, textStyle = TextStyle(color = Color.Transparent), cursorBrush = SolidColor(Color.Transparent),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Done),
        decorationBox = { inner ->
            Box {
                Box(Modifier.size(1.dp)) { inner() }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    repeat(6) { i ->
                        val waiting = focused && i == min(value.length, 5)
                        val edge by animateColorAsState(if (waiting) p.tint else Color.Transparent, Springs.smooth(), label = "Kotak kode")
                        Box(Modifier.weight(1f).heightIn(min = 56.dp).clip(RoundedCornerShape(12.dp)).background(p.cell)
                            .border(1.5.dp, edge, RoundedCornerShape(12.dp)), contentAlignment = Alignment.Center) {
                            // Digits grow with the system size only to 1.3x so six still fit a 320 dp screen.
                            Text(value.getOrNull(i)?.toString().orEmpty(), style = T.title2.copy(fontSize = (22 * min(scale, 1.3f) / scale).sp), color = p.ink)
                        }
                    }
                }
            }
        })
}

/** Red boxes fill as the password grows and all turn green at ten characters, as on the web; then the match is checked. */
@Composable private fun PasswordHint(password: String, confirm: String) {
    val p = palette
    val long = password.length >= 10
    val mismatch = confirm.isNotEmpty() && confirm != password
    Column(Modifier.fillMaxWidth().padding(start = 32.dp, end = 32.dp, top = 10.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            repeat(10) { i ->
                val color by animateColorAsState(when { i >= password.length -> p.fill; long -> p.tint; else -> p.warn }, Springs.smooth(), label = "Kotak sandi")
                Box(Modifier.weight(1f).height(4.dp).clip(CircleShape).background(color))
            }
        }
        Text(when {
            password.isEmpty() -> "Minimal 10 karakter."
            !long -> "Tambah ${10 - password.length} karakter lagi."
            mismatch -> "Konfirmasi kata sandi belum sama."
            confirm.isEmpty() -> "Panjang kata sandi sudah cukup."
            else -> "Kata sandi siap."
        }, Modifier.padding(top = 6.dp), style = T.footnote, color = if ((password.isNotEmpty() && !long) || mismatch) p.warn else p.secondary)
    }
}

/** Resend after a 60 s wait (GoTrue's own email interval), counted in steps of the coroutine clock, not wall time. */
@Composable private fun Resend(enabled: Boolean, onResend: () -> Unit) {
    var left by rememberSaveable { mutableIntStateOf(60) }
    LaunchedEffect(left) { if (left > 0) { delay(1_000); left-- } }
    PlainButton(if (left > 0) "Kirim ulang dalam $left detik" else "Kirim ulang kode", { onResend(); left = 60 }, Modifier.padding(top = 4.dp),
        enabled = enabled && left == 0)
}

/** Fallback when the live cloud email template still sends only a confirmation link without a 6-digit token. */
@Composable private fun WebsiteResetFallback(enabled: Boolean) {
    val uri = LocalUriHandler.current
    PlainButton("Atur ulang lewat website", { uri.openUri(WEB + "#masuk") }, Modifier.padding(top = 2.dp), enabled = enabled)
}
