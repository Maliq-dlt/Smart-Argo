package id.smartagro.app

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import java.time.temporal.ChronoUnit

@Composable internal fun GardenPlantScreen(state: AppState, openUnit: (PlantUnit)->Unit) {
    val plant=state.gardenPlant ?: return
    val site=state.garden?.sites?.find { it.id==plant.siteId }
    val unit=state.units.find { it.id==plant.unitId }
    val uri=rememberSafeUriHandler()
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
        Text(plant.name,style=MaterialTheme.typography.headlineLarge)
        Text("${plant.tag} \u00b7 ${plant.crop}",style=MaterialTheme.typography.titleMedium)
        Text("${site?.name.orEmpty()} \u00b7 ${plant.zone}")
        PlantScene(Modifier.fillMaxWidth().height(240.dp),onion=plant.species==2,speciesId=plant.species,
            day=ChronoUnit.DAYS.between(plant.plantedOn,LocalDate.now()).coerceIn(0,180).toInt(),interactive=true)
        Text("Ditanam ${plant.plantedOn} \u00b7 Kode ${plant.code}",style=MaterialTheme.typography.bodySmall)
        if(plant.species !in 1..2) Text("Mengamati \u00b7 profil perawatan spesies ini belum dikurasi.")
        Text("Ilustrasi tanaman; bukan pengukuran bentuk atau diagnosis.",style=MaterialTheme.typography.bodySmall)
        if(unit!=null) Button(onClick={openUnit(unit)}) { Text("Lihat sensor perangkat") }
        else Text("Belum ada unit sensor terhubung ke zona ini. Aplikasi tidak menampilkan bacaan atau saran perangkat tanpa data.")
        TextButton(onClick={uri.openUri("https://smart-agro-demo.pages.dev/#simulasi")}) { Text("Kelola pot dan kebun di website") }
    }
}
