import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

val local = Properties().apply {
    rootProject.file("local.properties").takeIf { it.exists() }?.inputStream()?.use { load(it) }
}
val releaseProperties = Properties().apply {
    rootProject.file(".private/release.properties").takeIf { it.exists() }?.inputStream()?.use { load(it) }
}
val hasReleaseSigning = listOf("storeFile", "storePassword", "keyAlias", "keyPassword").all {
    !releaseProperties.getProperty(it).isNullOrBlank()
}
fun publicSetting(name: String) = providers.gradleProperty(name).orNull ?: local.getProperty(name, "")
fun quoted(value: String) = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "").replace("\r", "") + "\""

android {
    namespace = "id.smartagro.app"
    compileSdk = 36
    buildToolsVersion = "36.1.0"
    defaultConfig {
        applicationId = "id.smartagro.app"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", quoted(publicSetting("GOOGLE_WEB_CLIENT_ID")))
        buildConfigField("String", "SUPABASE_URL", quoted(publicSetting("SUPABASE_URL")))
        buildConfigField("String", "SUPABASE_ANON_KEY", quoted(publicSetting("SUPABASE_ANON_KEY")))
    }
    signingConfigs {
        getByName("debug") { storeFile = rootProject.file(".cache/debug.keystore") }
        if (hasReleaseSigning) create("release") {
            storeFile = rootProject.file(releaseProperties.getProperty("storeFile"))
            storePassword = releaseProperties.getProperty("storePassword")
            keyAlias = releaseProperties.getProperty("keyAlias")
            keyPassword = releaseProperties.getProperty("keyPassword")
        }
    }
    buildTypes {
        getByName("release") {
            isDebuggable = false
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
            if (hasReleaseSigning) signingConfig = signingConfigs.getByName("release")
        }
    }
    buildFeatures { compose = true; buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    lint { abortOnError = true; checkReleaseBuilds = true }
    testOptions.unitTests.isIncludeAndroidResources = true
}
kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }
dependencies {
    implementation(platform("androidx.compose:compose-bom:2026.04.01"))
    implementation("androidx.compose.material3:material3")
    implementation("dev.chrisbanes.haze:haze:1.6.10")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    // Credential Manager is required for Google's native, nonce-protected account picker.
    implementation("androidx.credentials:credentials:1.6.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.6.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.1.1")
    implementation("androidx.activity:activity-compose:1.10.1")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.9.4")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.10.2")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
    // JVM UI verification without installing Android Studio or an emulator.
    testImplementation("org.robolectric:robolectric:4.16.1")
    testImplementation("androidx.compose.ui:ui-test-junit4")
}

tasks.withType<Test>().configureEach {
    // .tmp too: it is the tests' java.io.tmpdir and is ignored by Git, so a fresh checkout (CI) does not have it.
    doFirst { rootProject.file(".cache/test-home").mkdirs(); rootProject.file(".cache/robolectric").mkdirs(); rootProject.file(".tmp").mkdirs() }
    systemProperty("user.home", rootProject.file(".cache/test-home").absolutePath)
    systemProperty("maven.repo.local", rootProject.file(".cache/robolectric").absolutePath)
    systemProperty("robolectric.dependency.repo.url", "https://repo.maven.apache.org/maven2")
    systemProperty("smartagro.screenshots", rootProject.file(".tmp/screenshots").absolutePath)
    jvmArgs("-Djava.io.tmpdir=${rootProject.file(".tmp").absolutePath}")
}

// Standard Android debug signing key, generated inside the project instead of the user profile.
val debugKey = rootProject.file(".cache/debug.keystore")
val createDebugKey = tasks.register<Exec>("createDebugKey") {
    onlyIf { !debugKey.exists() }
    doFirst { debugKey.parentFile.mkdirs() }
    val suffix = if (System.getProperty("os.name").startsWith("Windows")) ".exe" else ""
    commandLine(File(System.getProperty("java.home"), "bin/keytool$suffix"), "-genkeypair",
        "-keystore", debugKey.absolutePath, "-storepass", "android", "-keypass", "android",
        "-alias", "androiddebugkey", "-dname", "CN=Android Debug,O=Android,C=US",
        "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000")
}
tasks.matching { it.name == "validateSigningDebug" }.configureEach { dependsOn(createDebugKey) }

// AGP assigns unit-test report paths after the main DSL; override after its task configuration.
afterEvaluate {
    tasks.withType<Test>().configureEach {
        reports.html.outputLocation.set(rootProject.file(".tmp/reports/$name"))
    }
}

// Fail closed instead of silently producing an unsigned release or reusing the debug key.
val verifyReleaseSigning = tasks.register("verifyReleaseSigning") {
    doLast {
        check(hasReleaseSigning) { "Prepare release signing with ./prepare-release.ps1 first. Never commit .private/." }
        check(rootProject.file(releaseProperties.getProperty("storeFile")).isFile) { "Release keystore is missing." }
        check(releaseProperties.getProperty("keyAlias") != "androiddebugkey") { "Debug signing cannot be used for release." }
    }
}
tasks.matching { it.name == "preReleaseBuild" }.configureEach { dependsOn(verifyReleaseSigning) }
