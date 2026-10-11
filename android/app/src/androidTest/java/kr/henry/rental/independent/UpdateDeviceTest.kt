package kr.henry.rental.independent

import android.content.Intent
import android.util.Base64
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.io.File

class UpdateDeviceTest {
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private val device get()=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
    private fun fixture(name:String)=InstrumentationRegistry.getInstrumentation().context.assets.open("update-fixtures/$name").use{it.readBytes()}
    private fun release(bytes:ByteArray):ApkUpdate.Release{val archive=File(context.cacheDir,"fixture-info.apk");archive.writeBytes(bytes);val info=context.packageManager.getPackageArchiveInfo(archive.path,0)!!;archive.delete();return ApkUpdate.parse(JSONObject().put("protocol","rental-apk-update-v1").put("packageName",AppDestination.PACKAGE).put("signerSha256",AppDestination.SIGNER_SHA256).put("versionName",info.versionName).put("versionCode",ApkUpdate.code(info)).put("size",bytes.size).put("sha256",ApkUpdate.sha(bytes)).put("chunkEncodedSize",524288).put("chunkCount",(Base64.encodeToString(bytes,Base64.NO_WRAP).length+524287)/524288))}
    private fun reject(action:()->Unit){try{action();fail("Unsafe update accepted")}catch(e:Exception){assertTrue(e.message?.isNotEmpty()==true)}}
    @Test fun manifestRejectsOtherAppsProtocolCertFractionsAndUnboundedDownloads(){
        val valid=release(fixture("valid-next.apk")).json()
        for((key,value) in listOf("packageName" to "other.app","protocol" to "html","signerSha256" to "a".repeat(64),"versionCode" to 6.1,"chunkCount" to 100,"chunkEncodedSize" to 1,"size" to ApkUpdate.MAX_BYTES+1,"sha256" to "javascript:bad"))reject{ApkUpdate.parse(JSONObject(valid.toString()).put(key,value))}
    }
    @Test fun signedArchiveRejectsTamperSizeWrongVersionNameAndWrongSigner(){
        val bytes=fixture("valid-next.apk");val next=release(bytes);val file=File(context.cacheDir,"update-verify.apk");file.writeBytes(bytes)
        ApkUpdate.verify(context,file,next)
        reject{ApkUpdate.verify(context,file,next.copy(code=5))}
        reject{ApkUpdate.verify(context,file,next.copy(name="4.1.9"))}
        reject{ApkUpdate.verify(context,file,next.copy(size=next.size+1))}
        reject{ApkUpdate.verify(context,file,next.copy(hash="a".repeat(64)))}
        val tampered=bytes.copyOf();tampered[tampered.size/2]=(tampered[tampered.size/2].toInt() xor 1).toByte();file.writeBytes(tampered);reject{ApkUpdate.verify(context,file,next)}
        val wrong=fixture("wrong-signer.apk");file.writeBytes(wrong);reject{ApkUpdate.verify(context,file,release(wrong))};file.delete()
    }
    @Test fun chunkDownloadFailureCancelAndSuccessNeverTouchRentalStore(){
        val bytes=fixture("valid-next.apk");val next=release(bytes);val encoded=Base64.encodeToString(bytes,Base64.NO_WRAP).chunked(524288)
        val store=SecureSession(context);store.update{it.put("updaterPreservationMarker","same-rental-data")};val before=File(context.filesDir,"native-session.enc").readBytes()
        fun row(index:Int)=JSONObject().put("status","ok").put("versionCode",next.code).put("sha256",next.hash).put("index",index).put("base64",encoded[index])
        reject{ApkUpdate.download(context,next,{row(it).put("index",it+1)},{},{false})}
        reject{ApkUpdate.download(context,next,{row(it).put("sha256","a".repeat(64))},{},{false})}
        reject{ApkUpdate.download(context,next,{row(it).put("base64","not-an-apk")},{},{false})}
        reject{ApkUpdate.download(context,next,{row(it)},{},{true})}
        val progress=mutableListOf<Int>();val result=ApkUpdate.download(context,next,{row(it)},{progress.add(it)},{false})
        assertArrayEquals(bytes,result.readBytes());assertEquals(100,progress.last());assertTrue(progress.zipWithNext().all{it.second>=it.first})
        assertArrayEquals(before,File(context.filesDir,"native-session.enc").readBytes());assertFalse(result.parentFile!!.listFiles()!!.any{it.extension=="part"})
        result.delete()
    }
    @Test fun updateScreenStaysNativeAndRotationShowsLatestVersion(){
        assumeTrue(ApkUpdate.code(context.packageManager.getPackageInfo(context.packageName,0))>=5L)
        ActivityScenario.launch<UpdateActivity>(Intent(context,UpdateActivity::class.java)).use{scenario->
            assertNotNull(device.wait(Until.findObject(By.textStartsWith("최신 버전입니다.")),90000));scenario.recreate()
            assertNotNull(device.wait(Until.findObject(By.text("앱 업데이트")),5000));assertEquals(AppDestination.PACKAGE,device.currentPackageName);assertNull(device.findObject(By.clazz("android.webkit.WebView")))
        }
    }
    @Test fun liveDownloadLeadsToAndroidPermissionAndInstaller(){
        assumeTrue(InstrumentationRegistry.getArguments().getString("liveUpdate")=="1"&&ApkUpdate.code(context.packageManager.getPackageInfo(context.packageName,0))<BuildConfig.VERSION_CODE)
        SecureSession(context).update{it.put("upgradePreservedMarker","native-411-upgrade").put("snapshot",NativeDemo.snapshot("2026-09"))}
        val needsPermission=android.os.Build.VERSION.SDK_INT>=26&&!context.packageManager.canRequestPackageInstalls()
        ActivityScenario.launch<UpdateActivity>(Intent(context,UpdateActivity::class.java))
        // Do not close the scenario: the installer remains for the separate test
        // driver to accept after instrumentation exits, since updates stop it.
        if(needsPermission)assertTrue(device.wait(Until.hasObject(By.textContains("Allow from this source")),180000)) else assertTrue(device.wait(Until.hasObject(By.text("Update")),180000))
        if(device.hasObject(By.textContains("Allow from this source"))){val toggle=device.findObject(By.checkable(true));assertNotNull(toggle);if(!toggle.isChecked)toggle.click();device.pressBack()}
        assertNotNull(device.wait(Until.findObject(By.text("Update")),15000))
        assertFalse(device.currentPackageName.contains("chrome"));assertFalse(device.currentPackageName==AppDestination.PACKAGE)
        val release=ApkUpdate.parse(NativeApi.updateManifest().getJSONObject("release"));assertEquals(BuildConfig.VERSION_CODE,release.code);ApkUpdate.verify(context,ApkUpdate.file(context,release),release)
    }
    @Test fun upgradePreservesEncryptedRentalCacheAndInstallsExactPublishedApk(){
        val args=InstrumentationRegistry.getArguments();assumeTrue(args.getString("upgradeProof")=="1")
        val state=SecureSession(context).read();assertEquals("native-411-upgrade",state.getString("upgradePreservedMarker"));assertTrue(state.getJSONObject("snapshot").getJSONArray("tenants").length()>0)
        val cacheHash=ApkUpdate.sha(File(context.filesDir,"native-session.enc").readBytes());assertEquals(args.getString("expectedCacheHash"),cacheHash)
        val info=context.packageManager.getPackageInfo(context.packageName,0);assertEquals(BuildConfig.VERSION_CODE.toLong(),ApkUpdate.code(info));assertEquals(BuildConfig.VERSION_NAME,info.versionName)
        val release=ApkUpdate.parse(NativeApi.updateManifest().getJSONObject("release"));val installedHash=ApkUpdate.sha(File(context.applicationInfo.sourceDir).readBytes());assertEquals(release.hash,installedHash)
        println("UPGRADE_PROOF "+JSONObject().put("versionCode",BuildConfig.VERSION_CODE).put("cacheBytesUnchanged",true).put("cachedRentalMarkerPreserved",true).put("publishedApkHashMatches",true).put("firstInstallTime",info.firstInstallTime).put("lastUpdateTime",info.lastUpdateTime))
    }
}
