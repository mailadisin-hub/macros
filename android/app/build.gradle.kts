plugins { id("com.android.application") }

// A standalone shell: its own WebView loads https://mailadisin-hub.github.io/macros/.
// No Chrome or Google Play needed (Adi's phone blocks Chrome web-app installs).
// All app code lives in the web app, so web changes need no new APK.
android {
    namespace = "uk.adi.macros"
    compileSdk = 36

    defaultConfig {
        applicationId = "uk.adi.macros"
        // 29: MediaStore Downloads for backup export without storage permission
        minSdk = 29
        targetSdk = 36
        // Vellichor decides "update available" from versionCode: bump it on every shipped build.
        versionCode = 2
        versionName = "2.0.0"
    }

    testOptions { unitTests { isIncludeAndroidResources = true; isReturnDefaultValues = true } }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.core:core:1.13.1")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.13")
    testImplementation("androidx.test:core:1.6.1")
}
