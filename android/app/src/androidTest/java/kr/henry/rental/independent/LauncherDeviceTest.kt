package kr.henry.rental.independent

import android.content.Intent
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.junit.Assert.*
import org.junit.Test

class LauncherDeviceTest {
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private val device get()=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
    private fun capture(name:String) {
        val bitmap=InstrumentationRegistry.getInstrumentation().uiAutomation.takeScreenshot()
        val values=android.content.ContentValues().apply {
            put(android.provider.MediaStore.Images.Media.DISPLAY_NAME,name)
            put(android.provider.MediaStore.Images.Media.MIME_TYPE,"image/png")
            put(android.provider.MediaStore.Images.Media.RELATIVE_PATH,"Pictures/NewRentStoreTest")
        }
        val uri=context.contentResolver.insert(android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI,values)!!
        context.contentResolver.openOutputStream(uri)!!.use { assertTrue(bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,it)) }
        bitmap.recycle()
    }
    @Test fun nativeLaunchPreviewTabsSearchAndRotation() {
        SecureSession(context).clear()
        ActivityScenario.launch<MainActivity>(Intent(context,MainActivity::class.java)).use { scenario ->
            assertTrue(device.wait(Until.hasObject(By.pkg(AppDestination.PACKAGE)),5000))
            assertNotNull(device.wait(Until.findObject(By.text("Google 계정으로 연결")),5000))
            device.findObject(By.text("예시 화면 둘러보기")).click()
            assertNotNull(device.wait(Until.findObject(By.text("1,258,500원")),5000))
            capture("native-home.png")
            device.findObject(By.desc("세입자 메뉴")).click()
            assertNotNull(device.wait(Until.findObject(By.text("스튜디오 여백")),5000))
            device.findObject(By.clazz("android.widget.EditText")).text="모던"
            assertNotNull(device.wait(Until.findObject(By.text("모던 오피스")),5000))
            assertNull(device.findObject(By.text("스튜디오 여백")))
            scenario.recreate()
            assertEquals("모던",device.wait(Until.findObject(By.clazz("android.widget.EditText")),5000).text)
            capture("native-tenants.png")
            device.findObject(By.desc("고지서 메뉴")).click()
            assertNotNull(device.wait(Until.findObject(By.text("고지서 · 수납")),5000))
            capture("native-bills.png")
            device.findObjects(By.text("내역 · 입금 처리"))[0].click()
            assertNotNull(device.wait(Until.findObject(By.text("고지서 내역")),5000))
            device.findObject(By.text("닫기")).click()
            device.wait(Until.findObject(By.desc("설정 메뉴")),5000).click()
            assertNotNull(device.wait(Until.findObject(By.text("Android 3.0.0")),5000))
            capture("native-settings.png")
            assertEquals(AppDestination.PACKAGE,device.currentPackageName)
        }
    }
    @Test fun encryptedSessionAndOfflineCacheNeverLaunchBrowserOrSave() {
        val store=SecureSession(context);store.clear()
        store.update { it.put("snapshot",NativeDemo.snapshot("2026-09")).put("privateMarker","native-secret-fixture") }
        val raw=java.io.File(context.filesDir,"native-session.enc").readBytes().toString(Charsets.UTF_8)
        assertFalse(raw.contains("native-secret-fixture"));assertFalse(raw.contains("스튜디오"))
        assertEquals("native-secret-fixture",store.read().getString("privateMarker"))
        ActivityScenario.launch<MainActivity>(Intent(context,MainActivity::class.java)).use {
            assertNotNull(device.wait(Until.findObject(By.text("오늘도, 한눈에")),5000))
            assertEquals(AppDestination.PACKAGE,device.currentPackageName)
        }
        store.clear()
    }
    @Test fun interceptedCodeCannotConnectWithoutLocalVerifier() {
        SecureSession(context).clear()
        ActivityScenario.launch<MainActivity>(Intent(context,MainActivity::class.java).setData(android.net.Uri.parse("rentstore://pair?code="+"a".repeat(64)))).use {
            assertNotNull(device.wait(Until.findObject(By.textContains("앱에서 Google 연결을 먼저")),5000))
            assertEquals("",SecureSession(context).read().optString("token"))
        }
    }
}
