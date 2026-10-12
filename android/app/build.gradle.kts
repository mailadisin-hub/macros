plugins { id("com.android.application") }

// A Trusted Web Activity: the APK opens https://mailadisin-hub.github.io/macros/
// in Chrome, full screen. All app code lives in the web app; this is only the shell.
android {
    namespace = "uk.adi.macros"
    compileSdk = 36

    defaultConfig {
        applicationId = "uk.adi.macros"
        minSdk = 24
        targetSdk = 36
        // Vellichor decides "update available" from versionCode: bump it on every shipped build.
        versionCode = 1
        versionName = "1.0.0"
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.7.4")
}
