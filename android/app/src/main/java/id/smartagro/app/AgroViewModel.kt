package id.smartagro.app

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate

enum class Screen { Login, Mfa, Products, Dashboard, History, Account, Rewards, Proofs, Garden, Security, ManageProducts, Gallery, Profile, DeleteAccount, DeletionPending }
/** Where the signed-out owner is: the welcome cover, Masuk/Daftar form, the emailed signup code, or the two reset steps. */
enum class AuthStep { Welcome, SignIn, SignUp, SignupCode, ResetEmail, ResetCode }
data class DeviceSetupReadings(val device: OwnedDevice, val readings: List<Reading>)
/** A care note waiting out its undo window before it is sent. */
data class PendingCare(val unitId: String, val kind: String, val at: Instant, val amountMl: Double?)
data class AppState(
    /** An account inside its 14-day deletion grace period (it may only cancel), and the result of asking to delete. */
    val deletion: AccountDeletion? = null, val deletionScheduled: AccountDeletion? = null,
    /** The profile photo's bytes (WebP, JPEG or PNG as stored); null shows initials. */
    val avatar: ByteArray? = null,
    val screen: Screen = Screen.Login, val busy: Boolean = false, val message: String? = null, val messageIsError: Boolean = false,
    val auth: AuthStep = AuthStep.Welcome, val authEmail: String = "", val welcome: Boolean = false, val introPlaying: Boolean = false,
    val resetCodeRequested: Boolean = false,
    val historySensor: Sensor = Sensor.Moisture,
    val historyRange: HistoryRange = HistoryRange.Day, val historyChartWindow: HistoryWindow? = null,
    val products: List<Product> = emptyList(), val units: List<PlantUnit> = emptyList(),
    val overviews: List<Overview> = emptyList(), val selectedProduct: Product? = null,
    val selectedUnit: PlantUnit? = null, val history: List<Reading> = emptyList(), val historyLoaded: Boolean = false, val historyWindow: HistoryWindow? = null, val historySnapshot: Instant? = null, val historyCursor: HistoryCursor? = null,
    val displayName: String = "", val rewardBalance: RewardBalance? = null, val rewardLoaded: Boolean = false,
    val rewards: RewardWorkspace? = null, val proofs: List<ChainProof> = emptyList(), val proofsLoaded: Boolean = false,
    val weather: WeatherSnapshot? = null, val weatherSiteId: String? = null, val weatherBusy: Boolean = false, val weatherMessage: String? = null,
    val explanation: UnitExplanation? = null, val explanationUnitId: String? = null, val explanationDeviceId: String? = null,
    val explanationBusy: Boolean = false, val explanationMessage: String? = null,
    val garden: Garden? = null, val gardenPlant: GardenPlant? = null, val catalogLoaded: Boolean = false, val email: String = "", val demo: Boolean = false, val demoAdvice: Map<String, Pair<String, String>> = emptyMap(),
    val archivedUnits: List<PlantUnit> = emptyList(), val devices: List<OwnedDevice> = emptyList(), val unitEvents: Map<String, List<UnitLifecycleEvent>> = emptyMap(),
    val deviceSetupReadings: DeviceSetupReadings? = null,
    val careJournal: List<CareEntry> = emptyList(), val careUnitId: String? = null, val careLoaded: Boolean = false,
    val careSnapshot: Instant? = null, val careNext: HistoryCursor? = null,
    val historyComparison: MeasurementComparison? = null, val comparisonUnitId: String? = null,
    val community: CommunityKnowledge? = null, val communitySpeciesId: Int? = null,
    val communityError: String? = null, val dashboardFromGarden: Boolean = false,
    val security: AccountSecurity? = null, val securityLoaded: Boolean = false, val recoveryStatus: RecoveryCodeStatus? = null,
    val totpEnrollment: TotpEnrollment? = null, val generatedRecoveryCodes: List<String>? = null,
    val publicStatus: ProductPublicStatus? = null, val publicStatusSerial: String = "",
    val activationChallenge: ActivationChallenge? = null, val activeTransfer: TransferOffer? = null, val activeTransferProductId: String? = null,
    val ownershipRecoveries: List<OwnershipRecovery> = emptyList(), val recoveriesLoaded: Boolean = false,
    val rewardCases: List<RewardCase> = emptyList(), val energyEvidence: EnergyEvidence? = null,
    val pendingCare: PendingCare? = null, val pendingCareSending: Boolean = false,
    val carePlants: List<CarePlant> = emptyList(), val cachedAt: Instant? = null,
    val wateringOutlook: WateringOutlook? = null, val wateringRises: List<WateringRise> = emptyList(),
    val unitHealth: UnitHealth? = null, val careDetailsUnit: String? = null,
    val alertPreferences: AlertPreferences? = null, val alertsUnavailable: Boolean = false,
) {
    val historyHasMore: Boolean get() = historyWindow != null
    fun plantCode(unit: PlantUnit): String = garden?.plants?.firstOrNull { it.unitId==unit.id && it.endedOn==null }?.tag ?: unitCode(unit,units)
    val weatherSite: GardenSite? get() {
        val plant=if(screen==Screen.Garden) gardenPlant else garden?.plants?.firstOrNull { it.unitId==selectedUnit?.id && it.endedOn==null && it.unitId!=null }
        return garden?.sites?.find { it.id==plant?.siteId }
    }
}
class AgroViewModel(application: Application) : AndroidViewModel(application) {
    val config = BackendConfig(BuildConfig.SUPABASE_URL, BuildConfig.SUPABASE_ANON_KEY, allowEmulatorHost = BuildConfig.DEBUG)
    private var pendingCsv: Pair<String, String>? = null
    private val api = AgroApi(config, SessionStore(application, config.url))
    private val accountFlows = AccountWorkflows(api)
    private val overviewCache = OverviewCache(java.io.File(application.filesDir, "care-cache"))
    private fun clearCareData(forgetSession: Boolean = false) = synchronized(SessionStore.lock) {
        pendingJob?.cancel(); pendingJob = null
        state = state.copy(pendingCare = null, pendingCareSending = false)
        if (forgetSession) SessionStore(getApplication(), config.url).clear()
        overviewCache.clear()
        CareNotifications.setEnabled(getApplication(), false)
        CareWidget.refresh(getApplication())
    }
    private fun restoreOverview() {
        if (state.email.isBlank() || state.demo) return
        val cached = overviewCache.load(config.url + ":" + state.email) ?: return
        runCatching {
            val data = JSONObject(cached.json)
            val owned = parseOwnedUnitsWorkspace(data.getJSONObject("units"))
            state = state.copy(products = parseProducts(data.getJSONObject("products")), units = owned.active,
                archivedUnits = owned.archived, devices = owned.devices, overviews = parseOverviews(data.getJSONObject("readings")),
                garden = data.optJSONObject("garden")?.let(::parseGarden), carePlants = data.optJSONObject("care")?.let(::parseCarePlants).orEmpty(),
                cachedAt = cached.at, catalogLoaded = true)
        }
    }
    var state by mutableStateOf(AppState())
        private set
    private val operations = kotlinx.coroutines.sync.Mutex()
    private var weatherJob: kotlinx.coroutines.Job? = null
    private var weatherGeneration = 0
    private var historyGeneration = 0
    init { if (config.valid) run { if (api.resume()) { state = state.copy(screen = Screen.Products, email = api.session!!.email, displayName = api.session!!.displayName); load() } } }

    private fun run(action: suspend () -> Unit) {
        val account=state.email;val demo=state.demo
        viewModelScope.launch {
          operations.withLock {
            if(state.email!=account || state.demo!=demo) return@withLock
            state = state.copy(busy = true, message = null, messageIsError = false)
            try { action() }
            catch (error: CancellationException) { throw error }
            catch (error: Exception) {
                if (error is ApiFailure && error.expired) { clearCareData(true); api.clear(); state = AppState(message = error.message, messageIsError = true) }
                else state = state.copy(messageIsError = true, message = when (error) {
                    is ApiFailure, is IllegalArgumentException -> error.message
                    else -> "Koneksi terputus atau data tidak dapat dimuat. Coba lagi."
                })
            } finally { state = state.copy(busy = false) }
          }
        }
    }
    private val prefs get() = getApplication<Application>().getSharedPreferences("smart-agro", 0)
    private val autoPlayIntro get() = !android.os.Build.FINGERPRINT.equals("robolectric", ignoreCase = true)
    /** A complete sign-in, however it happened; the short welcome shows once per install. */
    private suspend fun signedIn(complete: Boolean) {
        if (!complete) { state = state.copy(screen = Screen.Mfa); return }
        accountFlows.cancelPasswordReset()
        val session = api.session!!
        state = state.copy(screen = Screen.Products, email = session.email, displayName = session.displayName, auth = AuthStep.Welcome,
            welcome = !prefs.getBoolean("welcome-seen", false), introPlaying = autoPlayIntro)
        load()
    }
    fun replayIntro() { state = state.copy(introPlaying = true) }
    fun finishIntro() { if (state.introPlaying) state = state.copy(introPlaying = false) }
    fun selectHistorySensor(sensor: Sensor) { state = state.copy(historySensor = sensor) }
    fun selectHistoryRange(range: HistoryRange) {
        if (range == state.historyRange) return
        historyGeneration++
        state = state.copy(historyRange = range, historyLoaded = state.demo, historyChartWindow = null, message = null,
            history = if (state.demo) state.history else emptyList(), historySnapshot = null, historyCursor = null, historyWindow = null)
    }
    fun login(email: String, password: String) = run { signedIn(api.login(email.trim(), password)) }
    fun googleLogin(context: android.content.Context) = run {
        val credential = googleCredential(context, BuildConfig.GOOGLE_WEB_CLIENT_ID)
        signedIn(api.loginIdToken(credential.first,credential.second))
    }
    fun verify(code: String) = run { api.verifyMfa(code); signedIn(true) }
    /** A lost authenticator: one recovery code removes it, as on the web (APP-01). */
    fun recoverMfa(code: String) = run {
        signedIn(accountFlows.recoverMfa(code))
        if (state.screen == Screen.Mfa) state = state.copy(message = "Kode pemulihan diterima. Masukkan kode dari autentikator Anda yang lain.")
    }
    fun dismissWelcome() { prefs.edit().putBoolean("welcome-seen", true).apply(); state = state.copy(welcome = false) }
    /** Moves between the sign-in steps; leaving the reset steps forgets the reset. */
    fun authStep(step: AuthStep, email: String = state.authEmail) {
        if (state.busy) return
        val keepReset = step == AuthStep.ResetCode || step == AuthStep.ResetEmail
        if (!keepReset) accountFlows.cancelPasswordReset()
        state = state.copy(auth = step, authEmail = email.trim(), message = null, resetCodeRequested = keepReset && state.resetCodeRequested)
    }
    fun signup(name: String, email: String, password: String) = run {
        try {
            when (accountFlows.signup(email, password, name)) {
                SignupResult.ConfirmEmail -> state = state.copy(auth = AuthStep.SignupCode, authEmail = email.trim())
                SignupResult.SignedIn -> signedIn(true)
                SignupResult.MfaRequired -> signedIn(false)
            }
        } catch (error: ApiFailure) {
            if (error.code !in listOf("email_exists", "user_already_exists")) throw error
            state = state.copy(auth = AuthStep.SignIn, authEmail = email.trim(), message = "Email ini sudah terdaftar. Silakan masuk.")
        }
    }
    fun verifySignup(code: String) = run { signedIn(accountFlows.verifySignupCode(state.authEmail, code)) }
    fun resendSignup() = run {
        accountFlows.resendSignupCode(state.authEmail)
        state = state.copy(message = "Kode baru dikirim ke ${state.authEmail}.")
    }
    fun requestReset(email: String) = run {
        val sameEmail = email.trim().equals(state.authEmail, ignoreCase = true)
        if (!sameEmail) state = state.copy(authEmail = email.trim(), resetCodeRequested = false)
        accountFlows.requestPasswordReset(email)
        state = state.copy(auth = AuthStep.ResetCode, resetCodeRequested = true)
    }
    /** The code is spent on the first try; a retry after a failed password write reuses the accepted code. */
    fun finishReset(code: String, password: String) = run {
        if (!accountFlows.recovered) accountFlows.beginPasswordReset(code)
        val result = accountFlows.setRecoveredPassword(password)
        state = state.copy(auth = AuthStep.SignIn, resetCodeRequested = false, message = if (result == PasswordResetResult.PasswordChanged) "Kata sandi diganti. Masuk dengan sandi baru."
            else "Kata sandi diganti. Sesi reset di server akan berakhir sendiri. Masuk dengan sandi baru.")
    }
    private suspend fun load(successMessage: String? = null) {
        restoreOverview()
        // Asked first: an account waiting to be deleted is refused everywhere else, which would read as an expired session.
        // A backend without the deletion migration (404) has nothing pending; only an expired session stops loading.
        val pendingDeletion = try { parseDeletion(api.rpc("my_account_deletion")) } catch (error: ApiFailure) { if (error.expired) throw error; null }
        pendingDeletion?.let { waiting ->
            clearCareData()
            state = state.copy(deletion = waiting, screen = Screen.DeletionPending, catalogLoaded = true, message = null)
            return
        }
        api.rpc("ensure_my_account")
        val avatar = try { parseAvatar(api.rpc("my_avatar")) } catch (error: ApiFailure) { if (error.expired) throw error; state.avatar }
        val productsJson = api.rpc("my_products")
        val products = parseProducts(productsJson)
        // Core product data is committed together.
        val unitsJson = api.rpc("my_units")
        val owned = parseOwnedUnitsWorkspace(unitsJson)
        val units = owned.active
        val readingsJson = api.rpc("my_unit_overview")
        val overviews = parseOverviews(readingsJson)
        // Supplementary like the garden: a server without my_overview (cloud before the A-F release) still loads the account.
        val careJson = fetchOptional { api.rpc("my_overview").also { parseCarePlants(it) } }.getOrNull()
        val carePlants = careJson?.let(::parseCarePlants) ?: state.carePlants
        var gardenJson: JSONObject? = null
        val gardenResult = fetchOptional { parseGarden(api.rpc("my_garden").also { gardenJson = it }) }
        val garden = gardenResult.getOrElse { state.garden }
        val gardenWarning = if (gardenResult.isFailure) {
            if (garden == null) "Data kebun belum dapat dimuat. Coba segarkan."
            else "Data kebun belum dapat diperbarui. Menampilkan data sebelumnya."
        } else null
        val selected = products.find { it.id == state.selectedProduct?.id }
        val unit = units.find { it.id == state.selectedUnit?.id && it.productId == selected?.id }
        val nextScreen = if ((state.screen == Screen.Dashboard && selected == null) || (state.screen == Screen.Garden && garden?.plants?.none { it.id==state.gardenPlant?.id } != false)) Screen.Products else state.screen
        val activeUnit = unit ?: units.firstOrNull()
        val activeProduct = selected ?: activeUnit?.let { u -> products.find { it.id == u.productId } }
        historyGeneration++
        state = state.copy(catalogLoaded = true, deletion = null, avatar = avatar, garden = garden, gardenPlant = garden?.plants?.find { it.id==state.gardenPlant?.id }, products = products, units = units,
            archivedUnits = owned.archived, devices = owned.devices, overviews = overviews, carePlants = carePlants, cachedAt = null,
            deviceSetupReadings = state.deviceSetupReadings?.takeIf { it.device in owned.devices },
            selectedProduct = activeProduct, selectedUnit = activeUnit, history = emptyList(), historyLoaded = false,
            historyWindow = null, historySnapshot = null, historyCursor = null, historyChartWindow = null,
            careJournal = if (activeUnit?.id == state.careUnitId) state.careJournal else emptyList(), careLoaded = activeUnit?.id == state.careUnitId && state.careLoaded,
            careSnapshot = state.careSnapshot.takeIf { activeUnit?.id == state.careUnitId },
            careNext = state.careNext.takeIf { activeUnit?.id == state.careUnitId },
            historyComparison = if (activeUnit?.id == state.comparisonUnitId) state.historyComparison else null,
            screen = nextScreen, message = listOfNotNull(successMessage, gardenWarning).joinToString(" ").ifEmpty { null },
            messageIsError = gardenWarning != null)
        overviewCache.save(config.url + ":" + state.email, JSONObject().put("products", productsJson).put("units", unitsJson)
            .put("readings", readingsJson).put("care", careJson).put("garden", gardenJson).toString(), Instant.now())
        CareWidget.refresh(getApplication())
    }
    fun demo() {
        if (state.busy) return
        try {
            val base = readDemo(getApplication())
            val firstUnit = base.units.firstOrNull()
            val firstProduct = firstUnit?.let { u -> base.products.find { it.id == u.productId } } ?: base.products.firstOrNull()
            state = base.copy(
                selectedProduct = firstProduct,
                selectedUnit = firstUnit,
                history = firstUnit?.let { demoHistory(getApplication(), it.id) }.orEmpty(),
                historyLoaded = true,
                careUnitId = firstUnit?.id,
                careLoaded = true,
                introPlaying = autoPlayIntro,
            )
        }
        catch (_: Exception) { state = state.copy(messageIsError = true, message = "Skenario latihan tidak dapat dibaca.") }
    }
    fun refreshCurrent() {
        when(state.screen) {
            Screen.History -> { loadHistory(); loadCareJournal() }
            Screen.Account -> loadRewards()
            Screen.Rewards -> loadRewards()
            Screen.Proofs -> loadProofs()
            Screen.Security -> loadSecurity()
            Screen.ManageProducts -> { refresh(); loadRecoveries() }
            else -> refresh()
        }
    }
    fun refresh() { if (!state.demo) run {
        load()
        loadWeather()
    } }
    fun select(product: Product) {
        val unit = state.units.firstOrNull { it.productId == product.id }
        historyGeneration++
        state = state.copy(screen = Screen.Dashboard, dashboardFromGarden = state.screen == Screen.Garden, selectedProduct = product, selectedUnit = unit,
            history = if (state.demo && unit != null) demoHistory(getApplication(), unit.id) else emptyList(),
            historyLoaded = state.demo, historyWindow = null, historySnapshot = null, historyCursor = null, historyChartWindow = null,
            careJournal = emptyList(), careUnitId = unit?.id, careLoaded = state.demo, careSnapshot = null, careNext = null,
            historyComparison = null, comparisonUnitId = null, message = null)
    }
    fun selectUnit(unit: PlantUnit) {
        val product = state.products.find { it.id == unit.productId } ?: return
        historyGeneration++
        state = state.copy(selectedProduct = product, selectedUnit = unit, history = if (state.demo) demoHistory(getApplication(), unit.id) else emptyList(),
            historyLoaded = state.demo, historyWindow = null, historySnapshot = null, historyCursor = null, historyChartWindow = null,
            careJournal = emptyList(), careUnitId = unit.id, careLoaded = state.demo, careSnapshot = null, careNext = null,
            historyComparison = null, comparisonUnitId = null, message = null)
    }
    fun openHistoryFor(unit: PlantUnit, sensor: Sensor) {
        if (state.units.none { it.id == unit.id }) return
        if (state.selectedUnit?.id != unit.id) selectUnit(unit)
        state = state.copy(screen = Screen.History, historySensor = sensor, message = null)
    }
    fun loadHistory() = loadHistoryPage(false)
    fun loadOlderHistory() = loadHistoryPage(true)
    private fun loadHistoryPage(older: Boolean) {
        val unit = state.selectedUnit ?: return
        if (state.demo) return
        val generation = if (older) historyGeneration else ++historyGeneration
        val pendingWindow = state.historyWindow
        val pendingCursor = state.historyCursor
        fun current() = generation == historyGeneration && state.selectedUnit?.id == unit.id &&
            (!older || pendingWindow == state.historyWindow && pendingCursor == state.historyCursor)
        run {
            if (!current()) return@run
            val ownershipStart = state.products.find { it.id == unit.productId }?.ownershipStart
            try {
                if (!older) {
                    val window = state.historyRange.window(Instant.now())
                    val (readings, snapshot) = collectHistoryReadings { snapshot, cursor ->
                        if (!current()) throw CancellationException()
                        api.readMeasurementHistory(unit.id, window, snapshot, cursor, limit = 500)
                    }
                    if (!current()) return@run
                    state = state.copy(history = readings, historyLoaded = true, historyChartWindow = window,
                        historySnapshot = snapshot, historyCursor = null,
                        historyWindow = historyWindowEndingAt(window.from, ownershipStart))
                } else {
                    val window = pendingWindow ?: return@run
                    val page = api.readMeasurementHistory(unit.id, window, state.historySnapshot, pendingCursor, limit = 120)
                    if (!current()) return@run
                    state = state.copy(history = state.history + page.readings.map { it.reading },
                        historySnapshot = page.snapshot, historyCursor = page.next,
                        historyWindow = if (page.next != null) window else historyWindowEndingAt(window.from, ownershipStart))
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                if (current() || error is ApiFailure && error.expired) throw error
            }
        }
    }
    fun openGarden(plant: GardenPlant) {
        if(state.garden?.plants?.none { it.id==plant.id }!=false) return
        state=state.copy(screen=Screen.Garden,gardenPlant=plant,community=null,communitySpeciesId=null,communityError=null,message=null)
    }
    /** Detail and auth routes require the typed open/sign-in methods that initialize their data. */
    fun navigate(screen: Screen) {
        require(screen in listOf(Screen.Products,Screen.History,Screen.Account,Screen.Rewards,Screen.Proofs,Screen.Security,Screen.ManageProducts,Screen.Profile,Screen.DeleteAccount) || screen==Screen.Gallery && BuildConfig.DEBUG)
        state=state.copy(screen=screen,message=null)
    }
    fun openUnit(unit: PlantUnit) {
        if (state.units.none { it.id==unit.id }) return
        val product=state.products.find { it.id==unit.productId } ?: return
        select(product); selectUnit(unit)
    }
    fun renameUnit(label: String) {
      val unit=state.selectedUnit ?: return
      run {
        val name=label.trim()
        require(name.isNotEmpty() && name.length<=120 && name.none(Char::isISOControl)) { "Isi nama tanaman, maksimal 120 karakter." }
        if (!state.demo) api.rpc("rename_my_unit",JSONObject().put("p_unit_id",unit.id).put("p_label",name))
        val renamed=unit.copy(name=name)
        state=state.copy(units=state.units.map { if(it.id==unit.id) renamed else it },selectedUnit=if(state.selectedUnit?.id==unit.id) renamed else state.selectedUnit,message="Nama tanaman disimpan${if(state.demo) " selama latihan" else ""}.")
      }
    }
    fun loadRewards() = run {
        if (state.demo) return@run
        val rewards = parseRewards(api.rpc("reward_workspace"))
        val cases = api.rewardCases()
        val energy = api.energyEvidence()
        state = state.copy(rewardBalance = rewards.balance, rewards = rewards, rewardCases = cases, energyEvidence = energy, rewardLoaded = true)
    }
    /** The photo is already cropped and encoded on the phone ([avatarBytes]); the server checks type and size again. */
    fun setAvatar(bytes: ByteArray, mime: String) = run {
        require(!state.demo) { "Masuk ke akun untuk mengubah profil." }
        api.rpc("set_my_avatar", JSONObject().put("p_mime", mime).put("p_data", java.util.Base64.getEncoder().encodeToString(bytes)))
        state = state.copy(avatar = bytes, message = "Foto profil disimpan.")
    }
    fun clearAvatar() = run {
        api.rpc("clear_my_avatar")
        state = state.copy(avatar = null, message = "Foto dihapus. Inisial dipakai lagi.")
    }
    /** Re-verification for deleting the account: a fresh authenticator code with 2FA, otherwise signing in again. */
    fun reverifyForDeletion(password: String?, code: String?, onDone: () -> Unit) = run {
        when {
            code != null -> api.verifyMfa(code)
            password != null -> require(api.login(state.email, password)) { "Akun ini memakai autentikator: masukkan kodenya." }
            else -> error("Verifikasi belum diisi.")
        }
        onDone()
    }
    fun reverifyGoogleForDeletion(context: android.content.Context, onDone: () -> Unit) = run {
        val credential = googleCredential(context, BuildConfig.GOOGLE_WEB_CLIENT_ID)
        require(api.loginIdToken(credential.first, credential.second)) { "Akun ini memakai autentikator: masukkan kodenya." }
        onDone()
    }
    /** Every session ends on the server when it accepts; this phone forgets its copy and shows when the purge is due. */
    fun requestDeletion() = run {
        val scheduled = parseDeletion(api.rpc("request_account_deletion").optJSONObject("deletion")) ?: throw IllegalArgumentException("Status penghapusan akun tidak valid.")
        clearCareData(true)
        api.clear()
        state = state.copy(deletionScheduled = scheduled)
    }
    fun finishDeletion() { state = AppState() }
    fun cancelDeletion() = run {
        val back = api.rpc("cancel_account_deletion").optJSONArray("restored")?.let { a -> (0 until a.length()).map { a.getString(it) } }.orEmpty()
        state = state.copy(deletion = null, screen = Screen.Products)
        load(if (back.isEmpty()) "Penghapusan dibatalkan." else "Penghapusan dibatalkan. ${back.joinToString()} kembali ke akun Anda.")
    }
    fun updateName(raw: String) = run {
        require(!state.demo) { "Masuk ke akun untuk mengubah profil." }
        val name=api.updateName(raw)
        state=state.copy(displayName=name,message="Nama profil disimpan.")
    }
    fun reserveReward(item: RewardItem, otp: String) = run {
        require(!state.demo && state.rewardLoaded && state.rewards?.catalog?.any { it.id==item.id && it.canReserve(state.rewards!!.balance) }==true) { "Muat ulang katalog dan saldo terlebih dahulu." }
        val status=api.reserveReward(item.id,otp)
        state=state.copy(message=if(status=="reserved") "Stok dan poin direservasi. Poin didebit saat operator mencatat realisasi." else "Permintaan sebelumnya: ${redemptionLabels[status]}. Muat ulang untuk melihat status terbaru.",rewardLoaded=false)
        val rewards=parseRewards(api.rpc("reward_workspace"))
        state=state.copy(rewards=rewards,rewardBalance=rewards.balance,rewardLoaded=true)
    }
    fun cancelReward(id: String) = run {
        require(!state.demo && state.rewardLoaded && state.rewards?.redemptions?.any { it.id==id && it.status=="reserved" }==true) { "Reservasi tidak tersedia." }
        api.cancelReward(id)
        state=state.copy(message="Reservasi dibatalkan. Stok dan poin yang ditahan dilepas.",rewardLoaded=false)
        val rewards=parseRewards(api.rpc("reward_workspace"))
        state=state.copy(rewards=rewards,rewardBalance=rewards.balance,rewardLoaded=true)
    }
    fun restartRewardRequest(itemId: String) = run {
        require(!state.demo && state.rewards?.redemptions?.none { it.status=="reserved" && it.catalogItemId==itemId }==true) {
            "Masih ada reservasi item ini. Selesaikan atau batalkan reservasi sebelumnya terlebih dahulu."
        }
        api.resetRewardRequest(itemId)
        state=state.copy(message="Identitas lokal disisihkan. Periksa penukaran sebelumnya di website; permintaan berikutnya adalah reservasi baru.")
    }
    fun loadWeather() {
        weatherJob?.cancel()
        val generation=++weatherGeneration
        val account=state.email
        val site=state.weatherSite
        state=state.copy(weather=null,weatherSiteId=site?.id,weatherBusy=false,weatherMessage=null)
        if(state.demo || site==null) return
        if(site.placement=="indoor" || site.latitude==null || site.longitude==null) {
            state=state.copy(weatherMessage=if(site.placement=="indoor") "Tanaman dalam ruangan tidak memakai cuaca luar." else "Koordinat lokasi belum diatur. Atur di website untuk melihat prakiraan.")
            return
        }
        state=state.copy(weatherBusy=true)
        weatherJob=viewModelScope.launch {
            try {
                val weather=api.weather(site.latitude,site.longitude)
                if(generation==weatherGeneration && state.email==account) state=state.copy(weather=weather)
            } catch(error: CancellationException) { throw error }
            catch(error: Exception) {
                if(generation==weatherGeneration && state.email==account) {
                    if(error is ApiFailure && error.expired) { api.clear();state=AppState(message=error.message,messageIsError=true) }
                    else state=state.copy(weatherMessage="Prakiraan belum dapat dimuat. Coba lagi; bacaan sensor tetap tersedia.")
                }
            } finally { if(generation==weatherGeneration && state.email==account) state=state.copy(weatherBusy=false) }
        }
    }
    fun loadExplanation() {
        val unitId=state.selectedUnit?.id ?: return
        if(state.demo) return
        run {
            if(state.selectedUnit?.id!=unitId) return@run
            val sameUnit = state.explanationUnitId == unitId
            state=state.copy(explanation=state.explanation.takeIf { sameUnit }, explanationUnitId=unitId,
                explanationDeviceId=state.explanationDeviceId.takeIf { sameUnit }, explanationBusy=true, explanationMessage=null)
            try {
                val devices=api.rpc("my_device_units").array("units").objects(300)
                val candidates=devices.filter { it.id("unit_id")==unitId && it.optString("device_status")=="active" }
                val placed=candidates.filter { it.optBoolean("placed") }
                val device=(placed.ifEmpty { candidates }).singleOrNull()
                if(device==null) {
                    if(state.selectedUnit?.id==unitId) state=state.copy(explanationDeviceId=null, explanationMessage=if(candidates.isEmpty()) "Belum ada perangkat aktif pada unit ini." else "Ada beberapa perangkat pada unit ini. Atur penempatannya di website sebelum meminta penjelasan.")
                    return@run
                }
                val deviceId=device.id("device_id")
                val snapshots=parseUnitExplanations(api.rpc("unit_explanations",JSONObject().put("p_unit_id",unitId).put("p_device_id",deviceId)))
                require(snapshots.all { it.unitId==unitId && it.deviceId==deviceId }) { "Bukti penjelasan tidak sesuai dengan unit." }
                if(state.selectedUnit?.id==unitId) state=state.copy(explanation=snapshots.firstOrNull(),explanationDeviceId=deviceId)
            } catch(error: CancellationException) { throw error }
            catch(error: Exception) {
                if(error is ApiFailure && error.expired) throw error
                if(state.selectedUnit?.id==unitId) state=state.copy(explanationMessage="Penjelasan belum dapat dimuat. Coba lagi; bacaan sensor tetap tersedia.")
            } finally { state=state.copy(explanationBusy=false) }
        }
    }
    fun explain(question: String) {
        val unitId=state.selectedUnit?.id ?: return
        val deviceId=state.explanationDeviceId ?: return
        val text=question.trim()
        run {
            if(state.selectedUnit?.id!=unitId || state.explanationDeviceId!=deviceId || state.demo) return@run
            require(text.length<=500) { "Pertanyaan maksimal 500 karakter." }
            state=state.copy(explanationBusy=true,explanationMessage=null)
            try {
                val result=api.explain(unitId,deviceId,text)
                if(state.selectedUnit?.id==unitId) state=state.copy(explanation=result)
            } catch(error: CancellationException) { throw error }
            catch(error: Exception) {
                if(error is ApiFailure && error.expired) throw error
                if(state.selectedUnit?.id==unitId) state=state.copy(explanationMessage="Penjelasan belum dapat disimpan. Coba lagi dengan pertanyaan yang sama untuk melanjutkan permintaan.")
            } finally { state=state.copy(explanationBusy=false) }
        }
    }
    fun loadProofs() = run {
        if (state.demo) return@run
        val proofs=parseProofs(api.rpc("my_chain_proofs"))
        state=state.copy(proofs=proofs,proofsLoaded=true)
    }
    fun back() {
        if (state.busy && state.screen==Screen.Mfa) return
        when (state.screen) {
            Screen.Login -> when (state.auth) {
                AuthStep.SignIn, AuthStep.SignUp -> authStep(AuthStep.Welcome)
                AuthStep.SignupCode -> authStep(AuthStep.SignUp)
                AuthStep.ResetEmail -> authStep(AuthStep.SignIn)
                AuthStep.ResetCode -> authStep(AuthStep.ResetEmail)
                AuthStep.Welcome -> Unit
            }
            Screen.Mfa -> { api.cancelMfa(); state = AppState() }
            Screen.DeletionPending -> Unit
            Screen.Rewards, Screen.Proofs, Screen.Security, Screen.ManageProducts, Screen.Gallery, Screen.Profile, Screen.DeleteAccount -> state = state.copy(screen = Screen.Account,
                totpEnrollment = null, generatedRecoveryCodes = null, activeTransfer = null, activationChallenge = null, message = null)
            Screen.Dashboard -> state = state.copy(
                screen = if (state.dashboardFromGarden && state.gardenPlant != null) Screen.Garden else Screen.Products,
                dashboardFromGarden = false, message = null,
            )
            Screen.History, Screen.Account, Screen.Garden -> state = state.copy(screen = Screen.Products, message = null)
            else -> Unit
        }
    }

    // -------------------------------------------------------- Kebun, siklus, mode belajar & komunitas

    fun createGardenWithOptionalPlant(
        name: String, kind: String, placement: String, zones: List<String>,
        lat: Double?, lon: Double?, speciesId: Int?, nickname: String?, plantedOn: LocalDate, onDone: () -> Unit,
    ) = run {
        require(!state.demo) { "Masuk ke akun untuk menambah pot atau kebun." }
        val site = NewGardenSite(name, kind, placement, zones, lat, lon)
        val siteHash = payloadHash(name, kind, placement, zones.joinToString("|"), lat, lon)
        val created = api.withIdempotentRequest("garden-site", "new-site", siteHash) { reqId -> api.createGardenSite(reqId, site) }
        state = state.copy(garden = parseGarden(api.rpc("my_garden")))
        if (speciesId != null) {
            val slotId = created.slotIds.first()
            val plantHash = payloadHash(slotId, speciesId, plantedOn, nickname)
            api.withIdempotentRequest("plant-slot", slotId, plantHash) { reqId ->
                api.plantGardenSlot(reqId, slotId, speciesId, plantedOn, nickname)
            }
            state = state.copy(garden = parseGarden(api.rpc("my_garden")), message = "${name.trim()} dibuat dan mulai ditanami.")
        } else {
            state = state.copy(message = "${name.trim()} ditambahkan ke kebun Anda.")
        }
        onDone()
    }

    fun plantInSlot(slotId: String, speciesId: Int, on: LocalDate, nickname: String?, onDone: () -> Unit = {}) = run {
        require(!state.demo) { "Masuk ke akun untuk menanam zona." }
        val hash = payloadHash(slotId, speciesId, on, nickname)
        val change = api.withIdempotentRequest("plant-slot", slotId, hash) { reqId ->
            api.plantGardenSlot(reqId, slotId, speciesId, on, nickname)
        }
        val garden = parseGarden(api.rpc("my_garden"))
        val nextPlant = garden.plants.find { it.id == change.cycle.id }
        state = state.copy(garden = garden, gardenPlant = nextPlant ?: state.gardenPlant,
            screen = if (nextPlant != null) Screen.Garden else state.screen,
            message = if (change.idempotent) "Tanaman sudah tercatat di zona ini." else "Mulai menanam ${SpeciesCatalog.byCode(speciesId)?.name ?: "tanaman"} (${change.cycle.code}).")
        onDone()
    }

    fun switchGardenPlant(slotId: String, speciesId: Int, on: LocalDate, outcome: String, nickname: String?, onDone: () -> Unit = {}) = run {
        require(!state.demo) { "Masuk ke akun untuk mengganti tanaman." }
        val hash = payloadHash(slotId, speciesId, on, outcome, nickname)
        val change = api.withIdempotentRequest("switch-plant", slotId, hash) { reqId ->
            api.switchGardenPlant(reqId, slotId, speciesId, on, outcome, nickname)
        }
        val garden = parseGarden(api.rpc("my_garden"))
        val nextPlant = garden.plants.find { it.id == change.cycle.id }
        state = state.copy(garden = garden, gardenPlant = nextPlant, community = null,
            message = "Siklus lama ditutup ($outcome); tanaman baru dimulai.")
        onDone()
    }

    fun setSlotSharing(slotId: String, share: Boolean) = run {
        require(!state.demo) { "Masuk ke akun untuk mengatur berbagi komunitas." }
        val withdrawn = api.setSlotSharing(slotId, share)
        state = state.copy(garden = parseGarden(api.rpc("my_garden")),
            message = if (share) "Berbagi siklus diaktifkan untuk zona ini."
            else if (withdrawn > 0) "Berbagi dimatikan; $withdrawn data siklus ditarik dari komunitas."
            else "Berbagi siklus dimatikan.")
    }

    fun shareGardenCycle(cycleId: String, intervalDays: Double, moistureLow: Double, moistureHigh: Double, onDone: () -> Unit = {}) = run {
        require(!state.demo) { "Masuk ke akun untuk berbagi pola siklus." }
        val hash = payloadHash(cycleId, intervalDays, moistureLow, moistureHigh)
        api.withIdempotentRequest("share-cycle", cycleId, hash) { reqId ->
            api.shareCycle(reqId, cycleId, intervalDays, moistureLow, moistureHigh)
        }
        state = state.copy(garden = parseGarden(api.rpc("my_garden")), message = "Pola perawatan dibagikan ke pengetahuan komunitas (anonim).")
        onDone()
    }

    fun unshareGardenCycle(cycleId: String) = run {
        require(!state.demo) { "Masuk ke akun untuk menarik data." }
        api.unshareCycle(cycleId)
        state = state.copy(garden = parseGarden(api.rpc("my_garden")), message = "Pola siklus ini ditarik dari pengetahuan komunitas.")
    }

    fun loadCommunityKnowledge(speciesId: Int) = run {
        require(!state.demo) { "Pengetahuan komunitas tersedia setelah masuk." }
        state = state.copy(communityError = null)
        try {
            val knowledge = api.communityKnowledge(speciesId)
            state = state.copy(community = knowledge, communitySpeciesId = speciesId)
        } catch (error: CancellationException) { throw error }
        catch (error: Exception) {
            if (error is ApiFailure && error.expired) throw error
            state = state.copy(communityError = "Data komunitas belum dapat dimuat.")
        }
    }

    // -------------------------------------------------------- Jurnal, histori, perbandingan & CSV

    fun loadOlderCareJournal() = loadCareJournal(older = true)
    fun loadCareJournal(unitId: String? = state.selectedUnit?.id, older: Boolean = false) {
        val target = unitId ?: return
        if (state.demo) {
            state = state.copy(careUnitId = target, careLoaded = true)
            return
        }
        run {
            if (state.selectedUnit?.id != target) return@run
            val cursor = if (older) state.careNext.takeIf { state.careUnitId == target } ?: return@run else null
            val page = api.readCareJournal(target, snapshot = state.careSnapshot.takeIf { older }, cursor = cursor)
            if (state.selectedUnit?.id == target) {
                val entries = if (older) (state.careJournal + page.entries).distinctBy { it.id } else page.entries
                state = state.copy(careJournal = entries, careUnitId = target, careLoaded = true,
                    careSnapshot = page.snapshot, careNext = page.next)
            }
        }
    }

    fun recordCare(unitId: String, kind: String, observedAt: Instant, amountMl: Double?, notes: String, onDone: () -> Unit = {}) {
        if (state.demo) {
            val synthetic = CareEntry(java.util.UUID.randomUUID().toString(), unitId, kind, observedAt, observedAt, amountMl, notes.trim())
            state = state.copy(careJournal = listOf(synthetic) + state.careJournal, careUnitId = unitId, careLoaded = true,
                message = "Catatan perawatan disimpan selama latihan.")
            onDone()
            return
        }
        run {
            val hash = payloadHash(unitId, kind, observedAt, amountMl, notes.trim())
            val entry = api.withIdempotentRequest("care-journal", unitId, hash) { reqId ->
                api.appendCareJournal(unitId, reqId, kind, observedAt, amountMl, notes)
            }
            val list = (listOf(entry) + state.careJournal.filter { it.unitId == unitId && it.id != entry.id })
                .sortedByDescending { it.observedAt }
            if (state.selectedUnit?.id == unitId) {
                state = state.copy(careJournal = list, careUnitId = unitId, wateringRises = state.wateringRises.filter { it.to != observedAt }, message = "Catatan perawatan disimpan.")
            }
            onDone()
        }
    }

    // ponytail: the pending note lives in memory only; if the process dies inside the 5-second undo window it is not sent.
    private var pendingJob: kotlinx.coroutines.Job? = null
    /** Care recorded with one tap, sent after five seconds in which [undoCare] can take it back (the journal has no delete). */
    fun recordCareWithUndo(unitId: String, kind: String, amountMl: Double?, observedAt: Instant = Instant.now()) {
        if (state.pendingCare != null) return
        state = state.copy(pendingCare = PendingCare(unitId, kind, observedAt, amountMl), pendingCareSending = false)
        pendingJob = viewModelScope.launch { kotlinx.coroutines.delay(5_000); pendingJob = null; commitPendingCare() }
    }
    fun undoCare() { if (state.pendingCareSending) return; pendingJob?.cancel(); pendingJob = null; state = state.copy(pendingCare = null) }
    fun retryPendingCare() { if (!state.busy) commitPendingCare() }
    private fun commitPendingCare() {
        pendingJob?.cancel(); pendingJob = null
        val pending = state.pendingCare ?: return
        state = state.copy(pendingCareSending = true)
        recordCare(pending.unitId, pending.kind, pending.at, pending.amountMl, "") {
            state = state.copy(pendingCare = null, pendingCareSending = false)
        }
    }

    /** Practice only: the next synthetic reading after a watering, so the stage can show the water arriving. */
    fun simulateDemoReading(unitId: String) {
        if (!state.demo) return
        val now = Instant.now()
        state = state.copy(overviews = state.overviews.map { o ->
            if (o.id != unitId) o else o.copy(at = now, readings = o.readings.map { r ->
                if (r.sensor == Sensor.Moisture && r.value != null) r.copy(value = minOf(92.0, r.value + 24.0), at = now) else r.copy(at = now)
            })
        })
    }

    fun compareMeasurements(unitId: String, first: HistoryWindow, second: HistoryWindow) = run {
        require(!state.demo) { "Perbandingan rentang membutuhkan akun aktif." }
        val cmp = api.compareMeasurementHistory(unitId, first, second)
        state = state.copy(historyComparison = cmp, comparisonUnitId = unitId)
    }

    fun exportMeasurementsCsv(unitId: String, window: HistoryWindow, onCsv: (HistoryCsv) -> Unit) = run {
        require(!state.demo) { "Ekspor CSV membutuhkan akun aktif." }
        val csv = api.exportMeasurementHistoryCsv(unitId, window)
        state = state.copy(message = "CSV siap: ${csv.rows} baris bacaan.")
        onCsv(csv)
    }

    fun prepareCsvDocument(csv: HistoryCsv) { pendingCsv = state.email to csv.content }
    fun finishCsvDocument(uri: android.net.Uri?) {
        val content = pendingCsv?.takeIf { it.first == state.email }?.second
        pendingCsv = null
        if (uri != null && content != null) writeDocument(uri, content)
        else if (uri != null) reportDocumentError("Ekspor sudah tidak tersedia. Buat CSV kembali.")
    }
    fun reportDocumentError(message: String) {
        state = state.copy(message = message, messageIsError = true)
    }
    fun writeDocument(uri: android.net.Uri, text: String) = run {
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            val stream = getApplication<Application>().contentResolver.openOutputStream(uri)
                ?: throw IllegalArgumentException("File tidak dapat dibuka untuk ditulis.")
            stream.bufferedWriter(Charsets.UTF_8).use { it.write(text) }
        }
        state = state.copy(message = "File tersimpan.")
    }

    // -------------------------------------------------------- Keamanan akun

    fun loadSecurity() = run {
        require(!state.demo) { "Keamanan akun tersedia setelah masuk." }
        val sec = accountFlows.security()
        val rec = accountFlows.recoveryCodeStatus()
        state = state.copy(security = sec, recoveryStatus = rec, securityLoaded = true)
    }

    fun beginTotpSetup() = run {
        require(!state.demo)
        val factor = accountFlows.enrollMfa()
        state = state.copy(totpEnrollment = factor)
    }

    fun dismissTotpSetup() { state = state.copy(totpEnrollment = null) }

    fun confirmTotpSetup(factorId: String, code: String) = run {
        accountFlows.confirmMfa(factorId, code)
        val sec = accountFlows.security()
        val rec = accountFlows.recoveryCodeStatus()
        state = state.copy(totpEnrollment = null, security = sec, recoveryStatus = rec, message = "Verifikasi dua langkah diaktifkan.")
    }

    fun disableMfa(code: String, onDone: () -> Unit = {}) = run {
        accountFlows.removeMfa(code)
        val sec = accountFlows.security()
        val rec = accountFlows.recoveryCodeStatus()
        state = state.copy(security = sec, recoveryStatus = rec, message = "Verifikasi dua langkah dinonaktifkan.")
        onDone()
    }

    fun generateRecoveryCodes(code: String) = run {
        val codes = accountFlows.createRecoveryCodes(code)
        val rec = accountFlows.recoveryCodeStatus()
        state = state.copy(generatedRecoveryCodes = codes, recoveryStatus = rec, message = "Simpan ${codes.size} kode pemulihan sekarang. Kode hanya tampil sekali.")
    }

    fun clearGeneratedRecoveryCodes() { state = state.copy(generatedRecoveryCodes = null) }

    fun updateAccountPassword(password: String, onDone: () -> Unit = {}) = run {
        accountFlows.setPassword(password)
        val sec = accountFlows.security()
        state = state.copy(security = sec, message = "Kata sandi akun diperbarui.")
        onDone()
    }

    fun signOutOtherSessions() = run {
        accountFlows.signOutOthers()
        val sec = accountFlows.security()
        state = state.copy(security = sec, message = "Sesi di perangkat lain telah dikeluarkan.")
    }

    // -------------------------------------------------------- Produk, QR, unit & pemulihan

    fun checkPublicProduct(serial: String) = run {
        require(!state.demo) { "Pemeriksaan registri membutuhkan akun aktif." }
        val clean = serial.trim().uppercase()
        val status = api.productPublicStatus(clean)
        state = state.copy(publicStatus = status, publicStatusSerial = status.serial, activationChallenge = null)
    }

    fun requestProductChallenge(serial: String) = run {
        require(!state.demo)
        val clean = serial.trim().uppercase()
        val challenge = api.activationChallenge(clean)
        state = state.copy(activationChallenge = challenge, publicStatusSerial = clean)
    }

    fun clearActivationChallenge() { state = state.copy(activationChallenge = null) }

    fun claimScannedProduct(nonceId: String, sealedCode: String, signature: String, onDone: () -> Unit = {}) = run {
        api.claimProduct(nonceId, sealedCode, signature.trim())
        state = state.copy(activationChallenge = null, publicStatus = null)
        load("Produk berhasil diklaim ke akun Anda.")
        onDone()
    }

    fun archiveUnit(unitId: String) = run {
        require(!state.demo)
        api.archiveUnit(unitId)
        load("Unit diarsipkan. Riwayat bacaan tetap tersimpan.")
    }

    fun restoreUnit(unitId: String) = run {
        require(!state.demo)
        api.restoreUnit(unitId)
        load("Unit dipulihkan ke daftar aktif.")
    }

    fun placeDevice(deviceId: String, unitId: String) = run {
        require(!state.demo)
        require(state.devices.any { it.id == deviceId && it.status == "active" }) { "Pemasangan hanya tersedia untuk perangkat aktif." }
        load(if (api.placeDevice(deviceId, unitId)) "Perangkat terpasang. Bacaan berikutnya tercatat di unit ini."
            else "Perangkat terpasang, tetapi belum ada bacaan terbaru darinya. Nyalakan perangkat dan pastikan tersambung ke Wi-Fi; data masuk pada kiriman berikutnya.")
    }

    fun checkDeviceSetup(device: OwnedDevice) = run {
        val unitId = device.unitId ?: return@run
        require(!state.demo && device.status == "active" && device in state.devices)
        val now = Instant.now()
        val from = maxOf(device.placedAt ?: now, now.minusSeconds(86_400))
        val to = now.plusSeconds(60)
        val rows = if (from < to) api.readMeasurementHistory(unitId, HistoryWindow(from, to), limit = 500).readings else emptyList()
        if (device in state.devices) {
            val readings = rows.filter { it.deviceId == device.id }.map { it.reading }
            state = state.copy(deviceSetupReadings = DeviceSetupReadings(device, readings.distinctBy { it.sensor }))
        }
    }

    fun loadUnitLifecycleEvents(unitId: String) = run {
        require(!state.demo)
        val events = api.unitHistory(unitId)
        state = state.copy(unitEvents = state.unitEvents + (unitId to events))
    }

    fun createProductTransfer(productId: String) = run {
        require(!state.demo)
        val offer = api.createTransferOffer(productId)
        state = state.copy(activeTransfer = offer, activeTransferProductId = productId)
    }

    fun cancelProductTransfer(productId: String) = run {
        require(!state.demo)
        val ok = api.cancelTransferOffer(productId)
        state = state.copy(activeTransfer = null, activeTransferProductId = null,
            message = if (ok) "Penawaran transfer dibatalkan." else "Tidak ada penawaran transfer aktif.")
    }

    fun dismissTransferDisplay() { state = state.copy(activeTransfer = null, activeTransferProductId = null) }

    fun acceptProductTransfer(serial: String, code: String, onDone: () -> Unit = {}) = run {
        require(!state.demo)
        api.acceptTransfer(serial, code)
        load("Produk ${serial.trim().uppercase()} berhasil dipindahkan ke akun Anda.")
        onDone()
    }

    fun loadRecoveries() = run {
        if (state.demo) return@run
        val list = api.ownershipRecoveries()
        state = state.copy(ownershipRecoveries = list, recoveriesLoaded = true)
    }

    fun submitOwnershipRecovery(serial: String, statement: String, evidence: List<RecoveryEvidence>, onDone: () -> Unit = {}) = run {
        require(!state.demo)
        val cleanSerial = serial.trim().uppercase()
        val hash = payloadHash(cleanSerial, statement.trim(), evidence.joinToString("|") { it.toJson().toString() })
        api.withIdempotentRequest("ownership-recovery", cleanSerial, hash) { reqId ->
            api.openOwnershipRecovery(reqId, cleanSerial, statement, evidence)
        }
        val list = api.ownershipRecoveries()
        state = state.copy(ownershipRecoveries = list, recoveriesLoaded = true, message = "Permohonan pemulihan kepemilikan dikirim.")
        onDone()
    }

    fun withdrawOwnershipRecovery(caseId: String) = run {
        require(!state.demo)
        api.withdrawOwnershipRecovery(caseId)
        val list = api.ownershipRecoveries()
        state = state.copy(ownershipRecoveries = list, message = "Permohonan pemulihan ditarik.")
    }

    // -------------------------------------------------------- Banding reward

    fun submitRewardAppeal(statement: String, energyWindowId: String? = null, redemptionId: String? = null, onDone: () -> Unit = {}) = run {
        require(!state.demo)
        val key = energyWindowId ?: redemptionId ?: "appeal"
        val hash = payloadHash(statement.trim(), energyWindowId, redemptionId)
        api.withIdempotentRequest("reward-appeal", key, hash) { reqId ->
            api.openRewardAppeal(reqId, statement, energyWindowId, redemptionId)
        }
        val cases = api.rewardCases()
        state = state.copy(rewardCases = cases, message = "Permohonan peninjauan reward dikirim.")
        onDone()
    }


    fun loadCareDetails(unitId: String) = run {
        val body = JSONObject().put("p_unit_id", unitId).put("p_timezone", careZone())
        val outlook = missingRpcAsNull { parseOutlook(api.rpc("my_watering_outlook", body)) }
        val rises = missingRpcAsNull { parseRises(api.rpc("my_unlogged_rises", JSONObject().put("p_unit_id", unitId))) }.orEmpty()
        val health = missingRpcAsNull { parseUnitHealth(api.rpc("my_unit_health", body)) }
        state = state.copy(careDetailsUnit = unitId, wateringOutlook = outlook, wateringRises = rises, unitHealth = health)
    }
    fun dismissRise(unitId: String, rise: WateringRise) = run {
        careOk(api.rpc("dismiss_my_rise", JSONObject().put("p_unit_id", unitId).put("p_at", rise.to.toString())))
        state = state.copy(wateringRises = state.wateringRises.filter { it != rise })
    }
    fun loadAlertPreferences() = run {
        val saved = missingRpcAsNull { parseAlertPreferences(api.rpc("my_alert_preferences")) }
        // Remembered for the session, so the Akun screen does not ask (and announce it) again on every visit.
        state = if (saved != null) state.copy(alertPreferences = saved, alertsUnavailable = false)
            else state.copy(alertsUnavailable = true, message = "Pengaturan peringatan belum tersedia di server ini.")
    }
    fun setAlertPreferences(email: Boolean, kinds: Set<String>) = run {
        require(kinds.all { it in careKinds })
        val saved = parseAlertPreferences(api.rpc("set_my_alert_preferences", JSONObject().put("p_email_enabled", email).put("p_kinds", org.json.JSONArray(kinds.toList()))))
        state = state.copy(alertPreferences = saved)
    }
    fun assignSlotUnit(slotId: String, unitId: String?) = run {
        careOk(api.rpc("set_my_slot_unit", JSONObject().put("p_slot_id", slotId).put("p_unit_id", unitId ?: JSONObject.NULL)))
        load("Perangkat tanaman diperbarui.")
    }

    fun logout() = run {
        undoCare()
        clearCareData(true)
        pendingCsv = null
        weatherJob?.cancel(); weatherGeneration++
        getApplication<Application>().getSharedPreferences("weather-cities", 0).edit().clear().apply()
        // The hourly check belongs to this account; the next one turns it on again for theirs.
        if (CareNotifications.enabled(getApplication())) CareNotifications.setEnabled(getApplication(), false)
        if (state.demo) { state = AppState(); return@run }
        try { androidx.credentials.CredentialManager.create(getApplication()).clearCredentialState(androidx.credentials.ClearCredentialStateRequest()) }
        catch (error: CancellationException) { throw error }
        catch (_: androidx.credentials.exceptions.ClearCredentialException) { /* Local and server logout must still run. */ }

        try { if (!state.demo) api.logout(); state = AppState() }
        catch (error: CancellationException) { throw error }
        catch (_: Exception) { state = AppState(messageIsError = true, message = "Sesi di HP sudah dihapus. Server tidak terhubung; sesi server akan kedaluwarsa sesuai waktunya.") }
    }
}

internal suspend fun <T> fetchOptional(fetch: suspend () -> T): Result<T> = try {
    Result.success(fetch())
} catch (error: CancellationException) {
    throw error
} catch (error: Exception) {
    if (error is ApiFailure && error.expired) throw error
    Result.failure(error)
}
