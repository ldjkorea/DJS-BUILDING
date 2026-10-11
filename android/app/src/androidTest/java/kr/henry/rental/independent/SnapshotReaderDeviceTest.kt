package kr.henry.rental.independent

import android.content.Intent
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

class SnapshotReaderDeviceTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private fun snapshot(month: String = "2026-09") = NativeDemo.snapshot(month)
        .put("status", "ok").put("protocol", "rental-native-v1")
        .put("revision", "sha256-" + "a".repeat(64)).put("today", "2026-10-11")
    private fun state(value: JSONObject = snapshot(), token: String = "synthetic-device") = JSONObject()
        .put("token", token).put("snapshot", value).put("pending", false)
    private fun unchanged(req: JSONObject) = JSONObject().put("status", "ok")
        .put("protocol", "rental-native-v1").put("unchanged", true)
        .put("revision", req.getString("knownRevision")).put("today", req.getString("knownToday"))
        .put("month", req.getString("month"))

    @Test fun diskAloneNeverAuthorizesAndFreshProofExpiresOrChanges() {
        var time = 1000L; var day = "2026-10-11"
        val reader = SnapshotReader({ time }, { day }) { error("Unexpected request") }
        val s = state()
        assertFalse(reader.fresh(s, "2026-09"))
        reader.remember(s.getString("token"), s.getJSONObject("snapshot"))
        assertTrue(reader.fresh(s, "2026-09"))
        time += 29_999; assertTrue(reader.fresh(s, "2026-09"))
        time++; assertFalse(reader.fresh(s, "2026-09"))
        time = 1000; s.put("pending", true); assertFalse(reader.fresh(s, "2026-09"))
        s.put("pending", false); assertFalse(reader.fresh(s, "2026-10"))
        s.put("token", "another-device"); assertFalse(reader.fresh(s, "2026-09"))
        s.put("token", "synthetic-device"); day = "2026-10-12"; assertFalse(reader.fresh(s, "2026-09"))
        day = "2026-10-11"; s.getJSONObject("snapshot").getJSONObject("summary").put("total", 1)
        assertFalse(reader.fresh(s, "2026-09"))
    }
    @Test fun warmNavigationReusesReadButExplicitRefreshAndPendingAlwaysCallServer() {
        val calls = AtomicInteger()
        val reader = SnapshotReader({ 1000 }, { "2026-10-11" }) { calls.incrementAndGet(); unchanged(it) }
        val s = state()
        assertEquals(s.getJSONObject("snapshot").toString(), reader.load(s, "2026-09", false).toString())
        assertEquals(1, calls.get())
        reader.load(s, "2026-09", false); assertEquals(1, calls.get())
        reader.load(s, "2026-09", true); assertEquals(2, calls.get())
        s.put("pending", true); reader.load(s, "2026-09", false); assertEquals(3, calls.get())
        reader.invalidate(); s.put("pending", false); assertFalse(reader.fresh(s, "2026-09"))
    }
    @Test fun unchangedRepliesMustMatchCachedRevisionMonthDayAndProtocol() {
        for ((field, wrong) in listOf("revision" to "sha256-" + "b".repeat(64),
            "month" to "2026-10", "today" to "2026-10-12", "protocol" to "other")) {
            val reader = SnapshotReader({ 1000 }, { "2026-10-11" }) { unchanged(it).put(field, wrong) }
            try { reader.load(state(), "2026-09", false); fail("Accepted wrong $field") } catch (_: Exception) {}
            assertFalse(reader.fresh(state(), "2026-09"))
        }
        val reader = SnapshotReader({ 1000 }, { "2026-10-11" }) { snapshot("2026-10") }
        try { reader.load(state(), "2026-09", false); fail("Accepted wrong full month") } catch (_: Exception) {}
    }
    @Test fun concurrentSameDeviceMonthReadsShareOneRequestAndReturnIndependentObjects() {
        val calls = AtomicInteger(); val started = CountDownLatch(1); val release = CountDownLatch(1)
        val reader = SnapshotReader({ 1000 }, { "2026-10-11" }) {
            calls.incrementAndGet(); started.countDown(); check(release.await(5, TimeUnit.SECONDS)); snapshot()
        }
        val pool = Executors.newFixedThreadPool(2)
        try {
            val first = pool.submit<JSONObject> { reader.load(state(), "2026-09", true) }
            assertTrue(started.await(5, TimeUnit.SECONDS))
            val second = pool.submit<JSONObject> { reader.load(state(), "2026-09", true) }
            Thread.sleep(150); release.countDown()
            val a = first.get(5, TimeUnit.SECONDS); val b = second.get(5, TimeUnit.SECONDS)
            assertEquals(1, calls.get()); a.put("localOnly", true); assertFalse(b.has("localOnly"))
        } finally { release.countDown(); pool.shutdownNow() }
    }
    @Test fun saveInvalidationBlocksAnOldInFlightReadFromReauthorizing() {
        val started = CountDownLatch(1); val release = CountDownLatch(1)
        val reader = SnapshotReader({ 1000 }, { "2026-10-11" }) {
            started.countDown(); check(release.await(5, TimeUnit.SECONDS)); snapshot()
        }
        val pool = Executors.newSingleThreadExecutor()
        try {
            val result = pool.submit<JSONObject> { reader.load(state(), "2026-09", true) }
            assertTrue(started.await(5, TimeUnit.SECONDS)); reader.invalidate(); release.countDown()
            try { result.get(5, TimeUnit.SECONDS); fail("Stale read survived invalidation") } catch (_: java.util.concurrent.ExecutionException) {}
            assertFalse(reader.fresh(state(), "2026-09"))
        } finally { release.countDown(); pool.shutdownNow() }
    }
    @Test fun failedReadRevokesWarmProofAndDoesNotWriteEncryptedSession() {
        val store = SecureSession(context); store.clear(); store.update { it.put("marker", "synthetic") }
        val before = java.io.File(context.filesDir, "native-session.enc").readBytes()
        val reader = SnapshotReader({ 1000 }, { "2026-10-11" }) { JSONObject().put("status", "unauthorized") }
        reader.remember("synthetic-device", snapshot()); assertTrue(reader.fresh(state(), "2026-09"))
        assertEquals("unauthorized", reader.load(state(), "2026-09", true).getString("status"))
        assertFalse(reader.fresh(state(), "2026-09")); assertArrayEquals(before, java.io.File(context.filesDir, "native-session.enc").readBytes())
        store.clear()
    }
    private fun warmSession(): JSONObject {
        NativeSnapshots.reader.invalidate()
        val s = state().also { it.getJSONObject("snapshot").put("today", java.text.SimpleDateFormat("yyyy-MM-dd", java.util.Locale.KOREA)
            .apply { timeZone = java.util.TimeZone.getTimeZone("Asia/Seoul") }.format(java.util.Date())) }
        SecureSession(context).clear(); SecureSession(context).update { s.keys().forEach { key -> it.put(key, s.get(key)) } }
        NativeSnapshots.reader.remember(s.getString("token"), s.getJSONObject("snapshot"))
        return s
    }
    @Test fun bundledSaveSkipsExtraCallAndFailedReadDoesNotEraseAcknowledgedSave() {
        val calls = AtomicInteger()
        val reader = SnapshotReader({ 1000 }, { "2026-10-11" }) { calls.incrementAndGet(); snapshot() }
        val ack = JSONObject().put("status", "ok").put("latest", snapshot())
        assertEquals("rental-native-v1", reader.afterSave(ack, state(), "2026-09").getString("protocol"))
        assertEquals(0, calls.get())
        reader.afterSave(JSONObject().put("status", "ok"), state(), "2026-09")
        assertEquals(1, calls.get())
        ack.put("latest", JSONObject().put("status", "error"))
        try { reader.afterSave(ack, state(), "2026-09"); fail("Bad post-save read accepted") }
        catch (e: IllegalStateException) { assertTrue(e.message!!.contains("저장 요청은 처리됐지만")); assertTrue(e.message!!.contains("다시 보내지 않습니다")) }
        assertEquals("ok", ack.getString("status")); assertEquals(1, calls.get())
    }
    @Test fun freshHomeAndOperationsOpenWithoutAnotherConnectionWait() {
        warmSession()
        ActivityScenario.launch<MainActivity>(Intent(context, MainActivity::class.java)).use { scenario ->
            scenario.onActivity { activity ->
                val busy = MainActivity::class.java.getDeclaredField("busy").apply { isAccessible = true }
                val online = MainActivity::class.java.getDeclaredField("online").apply { isAccessible = true }
                assertFalse(busy.getBoolean(activity)); assertTrue(online.getBoolean(activity))
            }
        }
        ActivityScenario.launch<OperationsActivity>(Intent(context, OperationsActivity::class.java)
            .putExtra("mode", "contract").putExtra("month", "2026-09").putExtra("tenantId", "demo-0")).use { scenario ->
            scenario.onActivity { activity ->
                val busy = OperationsActivity::class.java.getDeclaredField("busy").apply { isAccessible = true }
                val online = OperationsActivity::class.java.getDeclaredField("online").apply { isAccessible = true }
                assertFalse(busy.getBoolean(activity)); assertTrue(online.getBoolean(activity))
            }
        }
        NativeSnapshots.reader.invalidate(); SecureSession(context).clear()
    }
    @Test fun tabsAndReadOnlyDetailsWorkDuringSlowRefreshButWritesRemainDisabled() {
        warmSession(); val release = CountDownLatch(1)
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        ActivityScenario.launch<MainActivity>(Intent(context, MainActivity::class.java)).use { scenario ->
            scenario.onActivity { activity ->
                MainActivity::class.java.getDeclaredField("refreshing").apply { isAccessible = true }.setBoolean(activity, true)
                MainActivity::class.java.getDeclaredField("online").apply { isAccessible = true }.setBoolean(activity, false)
                val task = MainActivity::class.java.declaredMethods.single { it.name == "runTask" }.apply { isAccessible = true }
                task.invoke(activity, "접속 지연 테스트", { check(release.await(20, TimeUnit.SECONDS)); JSONObject() }, { _: JSONObject -> })
            }
            try {
                device.wait(Until.findObject(By.desc("세입자 메뉴")), 3000).click()
                assertNotNull(device.wait(Until.findObject(By.text("스튜디오 여백")), 3000))
                device.wait(Until.findObject(By.desc("고지서 메뉴")), 3000).click()
                assertNotNull(device.wait(Until.findObject(By.text("고지서 · 수납")), 3000))
                device.findObjects(By.text("내역 · 입금 처리"))[1].click()
                assertNotNull(device.wait(Until.findObject(By.text("고지서 내역")), 3000))
                val save = device.wait(Until.findObject(By.textContains("월세 완납 날짜 저장")), 3000)
                assertNotNull(save); assertFalse(save.isEnabled)
                device.pressBack()
                device.wait(Until.findObject(By.desc("설정 메뉴")), 3000).click()
                assertNotNull(device.wait(Until.findObject(By.text("Android ${BuildConfig.VERSION_NAME}")), 3000))
            } finally { release.countDown() }
        }
        NativeSnapshots.reader.invalidate(); SecureSession(context).clear()
    }
}
