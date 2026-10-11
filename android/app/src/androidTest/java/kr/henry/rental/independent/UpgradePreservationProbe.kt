package kr.henry.rental.independent

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

/** Explicit synthetic-emulator probe. The normal suite skips it.
 * Run with mode=seed on code 7, then mode=check after adb install -r. */
class UpgradePreservationProbe {
    @Test fun preservesExactEncryptedBytesTokenSnapshotAndPackageInstallation(){
        val args=InstrumentationRegistry.getArguments()
        val mode=args.getString("mode")
        assumeTrue(mode=="seed"||mode=="check")
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val info=context.packageManager.getPackageInfo(context.packageName,0)
        val store=SecureSession(context)
        if(mode=="seed"){
            check(ApkUpdate.code(info)==7L){"Expected synthetic baseline code 7"}
            store.update{it.put("upgradeProbeMarker","synthetic-412-to-420").put("token","synthetic-upgrade-token").put("snapshot",NativeDemo.snapshot("2026-09")).put("pending",false)}
            val hash=ApkUpdate.sha(File(context.filesDir,"native-session.enc").readBytes())
            println("UPGRADE_SEED "+JSONObject().put("seeded",true).put("cacheSha256",hash).put("firstInstallTime",info.firstInstallTime));return
        }
        val state=store.read()
        check(state.getString("upgradeProbeMarker")=="synthetic-412-to-420")
        check(state.getString("token")=="synthetic-upgrade-token")
        check(state.getJSONObject("snapshot").getJSONArray("tenants").length()==3)
        check(ApkUpdate.sha(File(context.filesDir,"native-session.enc").readBytes())==args.getString("expectedCacheHash")){"Encrypted cache changed"}
        check(ApkUpdate.code(info)==8L&&info.versionName=="4.2.0"){"Candidate version mismatch"}
        check(ApkUpdate.sha(File(context.applicationInfo.sourceDir).readBytes())==args.getString("expectedApkHash")){"Candidate APK mismatch"}
        check(info.firstInstallTime==args.getString("expectedFirstInstallTime")?.toLong()){ "Application was reinstalled instead of upgraded" }
        println("UPGRADE_PROOF "+JSONObject().put("upgradeVerified",true).put("versionCode",8).put("versionName","4.2.0").put("encryptedBytesPreserved",true).put("syntheticTokenPreserved",true).put("snapshotPreserved",true).put("sameFirstInstallTime",true).put("candidateApkHashMatches",true))
    }
}
