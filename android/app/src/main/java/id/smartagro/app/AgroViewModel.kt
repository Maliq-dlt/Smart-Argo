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

enum class Screen { Login, Mfa, Products, Dashboard, History, Account, Rewards, Proofs, Garden, Security, ManageProducts, Gallery }
/** Where the signed-out owner is: the Masuk/Daftar form, the emailed signup code, or the two reset steps. */
enum class AuthStep { SignIn, SignUp, SignupCode, ResetEmail, ResetCode }
data class AppState(
    val screen: Screen = Screen.Login, val busy: Boolean = false, val message: String? = null, val messageIsError: Boolean = false,
    val auth: AuthStep = AuthStep.SignIn, val authEmail: String = "", val welcome: Boolean = false,
    val products: List<Product> = emptyList(), val units: List<PlantUnit> = emptyList(),
    val overviews: List<Overview> = emptyList(), val selectedProduct: Product? = null,
    val selectedUnit: PlantUnit? = null, val history: List<Reading> = emptyList(), val historyLoaded: Boolean = false, val historyBefore: java.time.Instant? = null, val historyHasMore: Boolean = false,
    val displayName: String = "", val rewardBalance: RewardBalance? = null, val rewardLoaded: Boolean = false,
    val rewards: RewardWorkspace? = null, val proofs: List<ChainProof> = emptyList(), val proofsLoaded: Boolean = false,
    val weather: WeatherSnapshot? = null, val weatherSiteId: String? = null, val weatherBusy: Boolean = false, val weatherMessage: String? = null,
    val explanation: UnitExplanation? = null, val explanationUnitId: String? = null, val explanationDeviceId: String? = null,
    val explanationBusy: Boolean = false, val explanationMessage: String? = null,
    val garden: Garden? = null, val gardenPlant: GardenPlant? = null, val catalogLoaded: Boolean = false, val email: String = "", val demo: Boolean = false, val demoAdvice: Map<String, Pair<String, String>> = emptyMap(),
    val archivedUnits: List<PlantUnit> = emptyList(), val devices: List<OwnedDevice> = emptyList(), val unitEvents: Map<String, List<UnitLifecycleEvent>> = emptyMap(),
    val careJournal: List<CareEntry> = emptyList(), val careUnitId: String? = null, val careLoaded: Boolean = false,
    val historyComparison: MeasurementComparison? = null, val comparisonUnitId: String? = null,
    val community: CommunityKnowledge? = null, val communitySpeciesId: Int? = null,
    val security: AccountSecurity? = null, val securityLoaded: Boolean = false, val recoveryStatus: RecoveryCodeStatus? = null,
    val totpEnrollment: TotpEnrollment? = null, val generatedRecoveryCodes: List<String>? = null,
    val publicStatus: ProductPublicStatus? = null, val publicStatusSerial: String = "",
    val activationChallenge: ActivationChallenge? = null, val activeTransfer: TransferOffer? = null, val activeTransferProductId: String? = null,
    val ownershipRecoveries: List<OwnershipRecovery> = emptyList(), val recoveriesLoaded: Boolean = false,
    val rewardCases: List<RewardCase> = emptyList(), val energyEvidence: EnergyEvidence? = null,
) {
    fun plantCode(unit: PlantUnit): String = garden?.plants?.firstOrNull { it.unitId==unit.id && it.endedOn==null }?.tag ?: unitCode(unit,units)
    val weatherSite: GardenSite? get() {
        val plant=if(screen==Screen.Garden) gardenPlant else garden?.plants?.firstOrNull { it.unitId==selectedUnit?.id && it.endedOn==null && it.unitId!=null }
        return garden?.sites?.find { it.id==plant?.siteId }
    }
}
class AgroViewModel(application: Application) : AndroidViewModel(application) {
    val config = BackendConfig(BuildConfig.SUPABASE_URL, BuildConfig.SUPABASE_ANON_KEY, allowEmulatorHost = BuildConfig.DEBUG)
    private val api = AgroApi(config, SessionStore(application, config.url))
    private val accountFlows = AccountWorkflows(api)
    var state by mutableStateOf(AppState())
        private set
    private val operations = kotlinx.coroutines.sync.Mutex()
    private var weatherJob: kotlinx.coroutines.Job? = null
    private var weatherGeneration = 0
    init { if (config.valid) run { if (api.restore()) { state = state.copy(screen = Screen.Products, email = api.session!!.email, displayName = api.session!!.displayName); load() } } }

    private fun run(action: suspend () -> Unit) {
        val account=state.email;val demo=state.demo
        viewModelScope.launch {
          operations.withLock {
            if(state.email!=account || state.demo!=demo) return@withLock
            state = state.copy(busy = true, message = null, messageIsError = false)
            try { action() }
            catch (error: CancellationException) { throw error }
            catch (error: Exception) {
                if (error is ApiFailure && error.expired) { api.clear(); state = AppState(message = error.message, messageIsError = true) }
                else state = state.copy(messageIsError = true, message = when (error) {
                    is ApiFailure, is IllegalArgumentException -> error.message
                    else -> "Koneksi terputus atau data tidak dapat dimuat. Coba lagi."
                })
            } finally { state = state.copy(busy = false) }
          }
        }
    }
    private val prefs get() = getApplication<Application>().getSharedPreferences("smart-agro", 0)
    /** A complete sign-in, however it happened; the short welcome shows once per install. */
    private suspend fun signedIn(complete: Boolean) {
        if (!complete) { state = state.copy(screen = Screen.Mfa); return }
        accountFlows.cancelPasswordReset()
        val session = api.session!!
        state = state.copy(screen = Screen.Products, email = session.email, displayName = session.displayName, auth = AuthStep.SignIn,
            welcome = !prefs.getBoolean("welcome-seen", false))
        load()
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
        if (step != AuthStep.ResetCode) accountFlows.cancelPasswordReset()
        state = state.copy(auth = step, authEmail = email.trim(), message = null)
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
        accountFlows.requestPasswordReset(email)
        state = state.copy(auth = AuthStep.ResetCode, authEmail = email.trim())
    }
    /** The code is spent on the first try; a retry after a failed password write reuses the accepted code. */
    fun finishReset(code: String, password: String) = run {
        if (!accountFlows.recovered) accountFlows.beginPasswordReset(code)
        val result = accountFlows.setRecoveredPassword(password)
        state = state.copy(auth = AuthStep.SignIn, message = if (result == PasswordResetResult.PasswordChanged) "Kata sandi diganti. Masuk dengan sandi baru."
            else "Kata sandi diganti. Sesi reset di server akan berakhir sendiri. Masuk dengan sandi baru.")
    }
    private suspend fun load() {
        api.rpc("ensure_my_account")
        val products = parseProducts(api.rpc("my_products"))
        // Commit all related data together; a failed load cannot mix users or product snapshots.
        val owned = parseOwnedUnitsWorkspace(api.rpc("my_units"))
        val units = owned.active
        val overviews = parseOverviews(api.rpc("my_unit_overview"))
        val garden = parseGarden(api.rpc("my_garden"))
        val selected = products.find { it.id == state.selectedProduct?.id }
        val unit = units.find { it.id == state.selectedUnit?.id && it.productId == selected?.id }
        state = state.copy(catalogLoaded = true, garden = garden, gardenPlant = garden.plants.find { it.id==state.gardenPlant?.id }, products = products, units = units,
            archivedUnits = owned.archived, devices = owned.devices, overviews = overviews,
            selectedProduct = selected, selectedUnit = unit, history = emptyList(), historyLoaded = false,
            careJournal = if (unit?.id == state.careUnitId) state.careJournal else emptyList(), careLoaded = unit?.id == state.careUnitId && state.careLoaded,
            historyComparison = if (unit?.id == state.comparisonUnitId) state.historyComparison else null,
            screen = if ((state.screen == Screen.Dashboard && selected == null) || (state.screen == Screen.Garden && garden.plants.none { it.id==state.gardenPlant?.id })) Screen.Products else state.screen)
    }
    fun demo() {
        if (state.busy) return
        try { state = readDemo(getApplication()) }
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
        state = state.copy(screen = Screen.Dashboard, selectedProduct = product, selectedUnit = unit,
            history = if (state.demo && unit != null) demoHistory(getApplication(), unit.id) else emptyList(),
            historyLoaded = state.demo, historyBefore = null, historyHasMore = false,
            careJournal = emptyList(), careUnitId = unit?.id, careLoaded = state.demo,
            historyComparison = null, comparisonUnitId = null, message = null)
    }
    fun selectUnit(unit: PlantUnit) {
        if (unit.productId != state.selectedProduct?.id) return
        state = state.copy(selectedUnit = unit, history = if (state.demo) demoHistory(getApplication(), unit.id) else emptyList(),
            historyLoaded = state.demo, historyBefore = null, historyHasMore = false,
            careJournal = emptyList(), careUnitId = unit.id, careLoaded = state.demo,
            historyComparison = null, comparisonUnitId = null, message = null)
    }
    fun loadHistory() = loadHistoryPage(false)
    fun loadOlderHistory() = loadHistoryPage(true)
    private fun loadHistoryPage(older: Boolean) {
      val selectedId=state.selectedUnit?.id ?: return
      run {
        val unit = state.selectedUnit?.takeIf { it.id==selectedId } ?: return@run
        if (state.demo) { state = state.copy(historyLoaded = true); return@run }
        if(older && !state.historyHasMore) return@run
        val before=if(older) state.historyBefore else null
        val body=JSONObject().put("p_unit_id",unit.id)
        if(before!=null) body.put("p_before",before.toString())
        val json = api.rpc("unit_measurements",body)
        val rows=json.array("readings").objects(120)
        val readings=parseHistory(json)
        val cursor=rows.minOfOrNull { it.instant("measured_at") }
        if(state.selectedUnit?.id!=unit.id) return@run
        val combined=if(older) state.history+readings else readings
        state=state.copy(history=combined.distinctBy { it.id ?: "${it.sensor}:${it.at}" }.sortedByDescending { it.at },historyLoaded=true,
            historyBefore=cursor,historyHasMore=rows.size==120 && cursor!=before)
      }
    }
    fun openGarden(plant: GardenPlant) {
        if(state.garden?.plants?.none { it.id==plant.id }!=false) return
        state=state.copy(screen=Screen.Garden,gardenPlant=plant,community=null,communitySpeciesId=null,message=null)
    }
    fun navigate(screen: Screen) {
        if (screen in listOf(Screen.Products,Screen.History,Screen.Account,Screen.Rewards,Screen.Proofs,Screen.Security,Screen.ManageProducts) || screen==Screen.Gallery && BuildConfig.DEBUG)
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
            state=state.copy(explanation=null,explanationUnitId=unitId,explanationDeviceId=null,explanationBusy=true,explanationMessage=null)
            try {
                val devices=api.rpc("my_device_units").array("units").objects(300)
                val candidates=devices.filter { it.id("unit_id")==unitId && it.optString("device_status")=="active" }
                val placed=candidates.filter { it.optBoolean("placed") }
                val device=(placed.ifEmpty { candidates }).singleOrNull()
                if(device==null) {
                    if(state.selectedUnit?.id==unitId) state=state.copy(explanationMessage=if(candidates.isEmpty()) "Belum ada perangkat aktif pada unit ini." else "Ada beberapa perangkat pada unit ini. Atur penempatannya di website sebelum meminta penjelasan.")
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
                AuthStep.SignupCode -> authStep(AuthStep.SignUp)
                AuthStep.ResetEmail -> authStep(AuthStep.SignIn)
                AuthStep.ResetCode -> authStep(AuthStep.ResetEmail)
                else -> Unit
            }
            Screen.Mfa -> { api.cancelMfa(); state = AppState() }
            Screen.Rewards, Screen.Proofs, Screen.Security, Screen.ManageProducts, Screen.Gallery -> state = state.copy(screen = Screen.Account,
                totpEnrollment = null, generatedRecoveryCodes = null, activeTransfer = null, activationChallenge = null, message = null)
            Screen.Dashboard, Screen.History, Screen.Account, Screen.Garden -> state = state.copy(screen = Screen.Products, message = null)
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
        val knowledge = api.communityKnowledge(speciesId)
        state = state.copy(community = knowledge, communitySpeciesId = speciesId)
    }

    // -------------------------------------------------------- Jurnal, histori, perbandingan & CSV

    fun loadCareJournal(unitId: String? = state.selectedUnit?.id) {
        val target = unitId ?: return
        if (state.demo) {
            state = state.copy(careUnitId = target, careLoaded = true)
            return
        }
        run {
            val page = api.readCareJournal(target, limit = 50)
            if (state.selectedUnit?.id == target) {
                state = state.copy(careJournal = page.entries, careUnitId = target, careLoaded = true)
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
            state = state.copy(careJournal = list, careUnitId = unitId, careLoaded = true, message = "Catatan perawatan disimpan.")
            onDone()
        }
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
        load()
        state = state.copy(message = "Produk berhasil diklaim ke akun Anda.")
        onDone()
    }

    fun archiveUnit(unitId: String) = run {
        require(!state.demo)
        api.archiveUnit(unitId)
        load()
        state = state.copy(message = "Unit diarsipkan. Riwayat bacaan tetap tersimpan.")
    }

    fun restoreUnit(unitId: String) = run {
        require(!state.demo)
        api.restoreUnit(unitId)
        load()
        state = state.copy(message = "Unit dipulihkan ke daftar aktif.")
    }

    fun placeDevice(deviceId: String, unitId: String?) = run {
        require(!state.demo)
        api.placeDevice(deviceId, unitId)
        load()
        state = state.copy(message = "Penempatan perangkat diperbarui.")
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
        load()
        state = state.copy(message = "Produk ${serial.trim().uppercase()} berhasil dipindahkan ke akun Anda.")
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

    fun logout() = run {
        weatherJob?.cancel(); weatherGeneration++
        getApplication<Application>().getSharedPreferences("weather-cities", 0).edit().clear().apply()
        if (state.demo) { state = AppState(); return@run }
        try { androidx.credentials.CredentialManager.create(getApplication()).clearCredentialState(androidx.credentials.ClearCredentialStateRequest()) }
        catch (error: CancellationException) { throw error }
        catch (_: androidx.credentials.exceptions.ClearCredentialException) { /* Local and server logout must still run. */ }

        try { if (!state.demo) api.logout(); state = AppState() }
        catch (error: CancellationException) { throw error }
        catch (_: Exception) { state = AppState(messageIsError = true, message = "Sesi di HP sudah dihapus. Server tidak terhubung; sesi server akan kedaluwarsa sesuai waktunya.") }
    }
}
