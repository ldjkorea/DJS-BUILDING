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
    @Test fun browserBoundaryRotationBackAndReentry() {
        val device=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        ActivityScenario.launch<MainActivity>(Intent(context,MainActivity::class.java)).use { scenario ->
            assertTrue("Custom Tabs provider must open", device.wait(Until.hasObject(By.pkg("com.android.chrome")),15000))
            device.setOrientationLeft()
            assertTrue(device.wait(Until.hasObject(By.pkg("com.android.chrome")),5000))
            device.setOrientationNatural()
            device.pressBack()
            assertTrue("Back must return to independent launcher",device.wait(Until.hasObject(By.pkg(AppDestination.PACKAGE)),10000))
            scenario.recreate()
            assertTrue("Rotation/recreation must not open a duplicate tab", device.wait(Until.hasObject(By.pkg(AppDestination.PACKAGE)),5000))
            assertNotNull(device.findObject(By.text("NEW RENT STORE 열기")))
            device.findObject(By.text("기본 브라우저로 열기")).click()
            assertTrue(device.wait(Until.hasObject(By.pkg("com.android.chrome")),10000))
            device.pressBack()
            assertTrue(device.wait(Until.hasObject(By.pkg(AppDestination.PACKAGE)),10000))
            device.findObject(By.text("설치와 업데이트 안내")).click()
            assertNotNull(device.wait(Until.findObject(By.textContains("APK 업데이트")),3000))
            device.pressBack()
        }
        device.unfreezeRotation()
    }
}
