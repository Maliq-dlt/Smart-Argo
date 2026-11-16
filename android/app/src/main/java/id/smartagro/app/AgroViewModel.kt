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

enum class Screen { Login, Mfa, Products, Dashboard, History, Account, Rewards, Proofs, Garden, Gallery }
data class AppState(
    val screen: Screen = Screen.Login, val busy: Boolean = false, val message: String? = null, val messageIsError: Boolean = false,
    val products: List<Product> = emptyList(), val units: List<PlantUnit> = emptyList(),
    val overviews: List<Overview> = emptyList(), val selectedProduct: Product? = null,
    val selectedUnit: PlantUnit? = null, val history: List<Reading> = emptyList(), val historyLoaded: Boolean = false, val historyBefore: java.time.Instant? = null, val historyHasMore: Boolean = false,
    val displayName: String = "", val rewardBalance: RewardBalance? = null, val rewardLoaded: Boolean = false,
    val rewards: RewardWorkspace? = null, val proofs: List<ChainProof> = emptyList(), val proofsLoaded: Boolean = false,
    val weather: WeatherSnapshot? = null, val weatherSiteId: String? = null, val weatherBusy: Boolean = false, val weatherMessage: String? = null,
    val explanation: UnitExplanation? = null, val explanationUnitId: String? = null, val explanationDeviceId: String? = null,
    val explanationBusy: Boolean = false, val explanationMessage: String? = null,
    val garden: Garden? = null, val gardenPlant: GardenPlant? = null, val catalogLoaded: Boolean = false, val email: String = "", val demo: Boolean = false, val demoAdvice: Map<String, Pair<String, String>> = emptyMap(),
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
    fun login(email: String, password: String) = run {
        val complete = api.login(email.trim(), password)
        if (complete) {
            state = state.copy(screen = Screen.Products, email = api.session!!.email, displayName = api.session!!.displayName)
            load()
        } else state = state.copy(screen = Screen.Mfa)
    }
    fun googleLogin(context: android.content.Context) = run {
        val credential = googleCredential(context, BuildConfig.GOOGLE_WEB_CLIENT_ID)
        val complete = api.loginIdToken(credential.first,credential.second)
        if (complete) {
            state=state.copy(screen=Screen.Products,email=api.session!!.email,displayName=api.session!!.displayName)
            load()
        } else state=state.copy(screen=Screen.Mfa)
    }
    fun verify(code: String) = run {
        api.verifyMfa(code)
        state = state.copy(screen = Screen.Products, email = api.session!!.email, displayName = api.session!!.displayName)
        load()
    }
    private suspend fun load() {
        api.rpc("ensure_my_account")
        val products = parseProducts(api.rpc("my_products"))
        // Commit all related data together; a failed load cannot mix users or product snapshots.
        val units = parseUnits(api.rpc("my_units"))
        val overviews = parseOverviews(api.rpc("my_unit_overview"))
        val garden = parseGarden(api.rpc("my_garden"))
        val selected = products.find { it.id == state.selectedProduct?.id }
        val unit = units.find { it.id == state.selectedUnit?.id && it.productId == selected?.id }
        state = state.copy(catalogLoaded = true, garden = garden, gardenPlant = garden.plants.find { it.id==state.gardenPlant?.id }, products = products, units = units, overviews = overviews,
            selectedProduct = selected, selectedUnit = unit, history = emptyList(), historyLoaded = false,
            screen = if ((state.screen == Screen.Dashboard && selected == null) || (state.screen == Screen.Garden && garden.plants.none { it.id==state.gardenPlant?.id })) Screen.Products else state.screen)
    }
    fun demo() {
        if (state.busy) return
        try { state = readDemo(getApplication()) }
        catch (_: Exception) { state = state.copy(messageIsError = true, message = "Skenario latihan tidak dapat dibaca.") }
    }
    fun refreshCurrent() {
        when(state.screen) {
            Screen.History -> loadHistory()
            Screen.Account, Screen.Rewards -> loadRewards()
            Screen.Proofs -> loadProofs()
            else -> refresh()
        }
    }
    fun refresh() { if (!state.demo) run {
        load()
        loadWeather()
    } }
    fun select(product: Product) {
        state = state.copy(screen = Screen.Dashboard, selectedProduct = product,
            selectedUnit = state.units.firstOrNull { it.productId == product.id },
            history = if (state.demo) demoHistory(getApplication(), state.units.first { it.productId == product.id }.id) else emptyList(),
            historyLoaded = state.demo, historyBefore = null, historyHasMore = false, message = null)
    }
    fun selectUnit(unit: PlantUnit) {
        if (unit.productId != state.selectedProduct?.id) return
        state = state.copy(selectedUnit = unit, history = if (state.demo) demoHistory(getApplication(), unit.id) else emptyList(), historyLoaded = state.demo, historyBefore = null, historyHasMore = false, message = null)
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
        state=state.copy(screen=Screen.Garden,gardenPlant=plant,message=null)
    }
    fun navigate(screen: Screen) {
        if (screen in listOf(Screen.Products,Screen.History,Screen.Account,Screen.Rewards,Screen.Proofs) || screen==Screen.Gallery && BuildConfig.DEBUG) state=state.copy(screen=screen,message=null)
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
        val rewards=parseRewards(api.rpc("reward_workspace"))
        state=state.copy(rewardBalance=rewards.balance,rewards=rewards,rewardLoaded=true)
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
            Screen.Mfa -> { api.cancelMfa(); state = AppState() }
            Screen.Rewards, Screen.Proofs, Screen.Gallery -> state = state.copy(screen = Screen.Account, message = null)
            Screen.Dashboard, Screen.History, Screen.Account, Screen.Garden -> state = state.copy(screen = Screen.Products, message = null)
            else -> Unit
        }
    }
    fun logout() = run {
        weatherJob?.cancel();weatherGeneration++
        getApplication<Application>().getSharedPreferences("weather-cities",0).edit().clear().apply()
        if(state.demo) { state=AppState();return@run }
        try { androidx.credentials.CredentialManager.create(getApplication()).clearCredentialState(androidx.credentials.ClearCredentialStateRequest()) }
        catch (error: CancellationException) { throw error }
        catch (_: androidx.credentials.exceptions.ClearCredentialException) { /* Local and server logout must still run. */ }

        try { if (!state.demo) api.logout(); state = AppState() }
        catch (error: CancellationException) { throw error }
        catch (_: Exception) { state = AppState(messageIsError = true, message = "Sesi di HP sudah dihapus. Server tidak terhubung; sesi server akan kedaluwarsa sesuai waktunya.") }
    }
}
