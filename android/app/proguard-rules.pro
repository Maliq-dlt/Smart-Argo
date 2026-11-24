# R8 rules for the release build. Classes below are created by reflection, which R8 cannot see.

# WorkManager opens its Room database through the generated WorkDatabase_Impl's no-argument constructor. Without this
# rule R8 removed it and the release app crashed at start (NoSuchMethodException, 2026-11-24).
-keep class * extends androidx.room.RoomDatabase { <init>(); }

# Credential Manager finds the Play services provider (Google sign-in) by reflection; the Android docs ask for this rule
# in release builds, otherwise sign-in fails with "no provider dependencies found".
-if class androidx.credentials.CredentialManager
-keep class androidx.credentials.playservices.** { *; }
