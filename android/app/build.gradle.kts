import java.util.Properties
plugins { id("com.android.application") }
val releaseCredentials = Properties()
val credentialsFile = rootProject.file("../.private/android-signing.properties")
if (credentialsFile.exists()) credentialsFile.inputStream().use { releaseCredentials.load(it) }
android {
    namespace = "kr.henry.rental.independent"
    compileSdk = 37
    defaultConfig {
        applicationId = "kr.henry.rental.independent"
        minSdk = 23
        targetSdk = 37
        versionCode = 3
        versionName = "3.0.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
    }
    signingConfigs {
        create("personalRelease") {
            if (credentialsFile.exists()) {
                storeFile = rootProject.file(releaseCredentials.getProperty("storeFile"))
                storePassword = releaseCredentials.getProperty("storePassword")
                keyAlias = releaseCredentials.getProperty("keyAlias")
                keyPassword = releaseCredentials.getProperty("keyPassword")
            }
        }
    }
    buildTypes {
        getByName("debug") {
            if (credentialsFile.exists()) signingConfig = signingConfigs.getByName("personalRelease")
        }
        getByName("release") {
            signingConfig = signingConfigs.getByName("personalRelease")
            isMinifyEnabled = false
        }
    }
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    buildFeatures { buildConfig = true }
}
dependencies {
    implementation("androidx.browser:browser:1.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("androidx.test:core:1.7.0")
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.3.0")
}
