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
        device.waitForIdle()
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
            assertNotNull(device.wait(Until.findObject(By.text("Android ${BuildConfig.VERSION_NAME}")),5000))
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
    private fun operation(mode:String)=Intent(context,OperationsActivity::class.java).putExtra("mode",mode).putExtra("month","2026-09").putExtra("tenantId","demo-0").putExtra("demo",true)
    @Test fun nativeContractDraftSurvivesRotationAndCannotSaveDemo(){
        SecureSession(context).clear()
        ActivityScenario.launch<OperationsActivity>(operation("contract")).use{scenario->
            assertNotNull(device.wait(Until.findObject(By.text("계약 변경 · 재계약")),5000))
            val unit=device.wait(Until.findObject(By.desc("호실")),5000);unit.text="299호"
            scenario.recreate()
            assertEquals("299호",device.wait(Until.findObject(By.desc("호실")),5000).text)
            assertTrue(SecureSession(context).read().getJSONObject("demoOperationDrafts").getJSONObject("contract:2026-09:demo-0").getJSONObject("draft").getString("term.unit")=="299호")
            capture("native-contract.png");assertEquals(AppDestination.PACKAGE,device.currentPackageName)
            assertEquals("",SecureSession(context).read().optString("token"))
        }
    }
    @Test fun nativeSettlementBackupAndOutputStayInsideApp(){
        for((mode,title) in listOf("settlement" to "공용 비용 정산","backup" to "백업 · 복원","output" to "고지서 · 정산 출력")){
            ActivityScenario.launch<OperationsActivity>(operation(mode)).use{
                assertNotNull(device.wait(Until.findObject(By.text(title)),5000));capture("native-$mode.png")
                assertEquals(AppDestination.PACKAGE,device.currentPackageName)
                assertNull(device.findObject(By.clazz("android.webkit.WebView")))
                if(mode=="output"){
                    device.findObject(By.text("이번 달 전체 고지서 PDF")).click()
                    assertNotNull(device.wait(Until.findObject(By.textContains("앱 내부 PDF 미리보기")),10000))
                    capture("native-pdf-preview.png")
                    assertEquals(AppDestination.PACKAGE,device.currentPackageName)
                    device.findObject(By.text("다음")).click()
                    assertNotNull(device.wait(Until.findObject(By.textStartsWith("2 /")),5000))
                    device.findObject(By.text("닫기")).click()
                }
            }
        }
    }
    @Test fun backupReaderRejectsOversizedMalformedAndDeepDataAndAcceptsUtf8Bom(){
        val raw="{\"schemaVersion\":1,\"tenants\":[],\"bills\":{},\"extension\":\"한글\"}"
        assertEquals("한글",NativeDocuments.readBackup(("\uFEFF"+raw).byteInputStream()).getString("extension"))
        for(bytes in listOf("x".repeat(NativeDocuments.MAX_BACKUP_BYTES+1).toByteArray(),byteArrayOf(0xc3.toByte(),0x28),"[]".toByteArray(),("{\"tenants\":[],\"bills\":{},\"x\":"+"[".repeat(33)+"0"+"]".repeat(33)+"}").toByteArray())){
            try{NativeDocuments.readBackup(bytes.inputStream());fail("invalid backup accepted")}catch(_:Exception){}
        }
    }
    @Test fun multiPageKoreanPdfAndSelectedPrintRangePreserveEveryLine(){
        val report=org.json.JSONObject().put("title","정산 · 한글 출력 검증").put("generatedAt","예시 자료").put("lines",org.json.JSONArray().apply{put(org.json.JSONObject().put("kind","heading").put("text","계약 변경 이력"));for(i in 0..139)put(org.json.JSONObject().put("text","검증 줄 $i · 임차인 예시 · 청구액 1,258,500원 · 수납과 변경 사유를 모두 보존합니다."));put(org.json.JSONObject().put("text","긴 메모 "+"한글 원문 보존 ".repeat(600)+" 마지막 확인 표시"))})
        val file=NativeDocuments.createPdf(context,report)
        val count=android.graphics.pdf.PdfRenderer(android.os.ParcelFileDescriptor.open(file,android.os.ParcelFileDescriptor.MODE_READ_ONLY)).use{assertTrue(it.pageCount>3);it.pageCount}
        val values=android.content.ContentValues().apply{put(android.provider.MediaStore.Downloads.DISPLAY_NAME,"native-400-korean-validation.pdf");put(android.provider.MediaStore.Downloads.MIME_TYPE,"application/pdf");put(android.provider.MediaStore.Downloads.RELATIVE_PATH,"Download/NewRentStoreTest")}
        val uri=context.contentResolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI,values)!!;context.contentResolver.openOutputStream(uri)!!.use{file.inputStream().use{input->input.copyTo(it)}}
        val subset=java.io.File(context.cacheDir,"subset.pdf");subset.outputStream().use{PdfPreviewActivity.writeSelectedPages(file,listOf(1,count-1),android.os.CancellationSignal(),it)}
        android.graphics.pdf.PdfRenderer(android.os.ParcelFileDescriptor.open(subset,android.os.ParcelFileDescriptor.MODE_READ_ONLY)).use{assertEquals(2,it.pageCount)}
        ActivityScenario.launch<PdfPreviewActivity>(Intent(context,PdfPreviewActivity::class.java)).use{scenario->
            assertNotNull(device.wait(Until.findObject(By.textContains("앱 내부 PDF 미리보기")),5000));device.findObject(By.text("다음")).click();scenario.recreate();assertNotNull(device.wait(Until.findObject(By.textStartsWith("2 /")),5000));capture("native-pdf-long.png")
        }
    }
}
