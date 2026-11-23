pluginManagement {
    repositories { google(); mavenCentral(); gradlePluginPortal() }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        // Maven Central answers GitHub runners with 429 for the 150 MB Robolectric framework jars (main, 24 Nov), so
        // those come from Google's mirror of Maven Central first (same files); everything else stays on Maven Central.
        maven("https://maven-central.storage-download.googleapis.com/maven2/") {
            content { includeModule("org.robolectric", "android-all-instrumented") }
        }
        mavenCentral()
    }
}
rootProject.name = "SmartAgroAndroid"
include(":app")
