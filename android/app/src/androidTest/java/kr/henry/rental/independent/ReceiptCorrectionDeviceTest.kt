package kr.henry.rental.independent

import android.content.Intent
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.EditText
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.atomic.AtomicInteger

/** Synthetic encrypted session and debug-only transport; no Google calls. */
class ReceiptCorrectionDeviceTest {
    private val instrumentation get()=InstrumentationRegistry.getInstrumentation()
    private val context get()=instrumentation.targetContext
    private val store get()=SecureSession(context)
    private fun seed():JSONObject {
        NativeSnapshots.reader.invalidate();store.clear()
        val today=java.text.SimpleDateFormat("yyyy-MM-dd",java.util.Locale.KOREA).apply{timeZone=java.util.TimeZone.getTimeZone("Asia/Seoul")}.format(java.util.Date())
        val s=NativeDemo.snapshot("2026-09").put("status","ok").put("protocol","rental-native-v1").put("revision","sha256-"+"a".repeat(64)).put("today",today)
            .put("capabilities",JSONObject().put("receiptVoid",true))
        val bill=s.getJSONArray("bills").getJSONObject(0)
        bill.put("ledger",true).put("receiptReferences",JSONArray().put(JSONObject().put("id","synthetic-receipt").put("item","pay_rent").put("amount",30000).put("receivedOn","2026-09-01").put("note","익명 원문").put("cancelled",false)))
            .put("receiptEvents",JSONArray().put(JSONObject().put("kind","receipt").put("id","synthetic-receipt").put("amount",30000)))
        store.update{it.put("token","synthetic-instrumentation-device").put("snapshot",s).put("pending",false)}
        NativeSnapshots.reader.remember("synthetic-instrumentation-device",s)
        return s
    }
    @After fun cleanup(){NativeOperationsTransport.testRequest=null;NativeSnapshots.reader.invalidate();store.clear()}
    private fun launch()=ActivityScenario.launch<OperationsActivity>(Intent(context,OperationsActivity::class.java).putExtra("mode","ledger").putExtra("month","2026-09").putExtra("tenantId","demo-0"))
    private fun views(v:View):List<View> = listOf(v)+if(v is ViewGroup)(0 until v.childCount).flatMap{views(v.getChildAt(it))}else emptyList()
    private fun fill(s:ActivityScenario<OperationsActivity>,value:String){s.onActivity{a->views(a.window.decorView).filterIsInstance<EditText>().single{it.contentDescription=="정정 사유 (필수)"}.setText(value)}}
    private fun click(s:ActivityScenario<OperationsActivity>,label:String){s.onActivity{a->views(a.window.decorView).filterIsInstance<Button>().single{it.text.toString()==label}.performClick()}}
    private fun idle(s:ActivityScenario<OperationsActivity>){val end=System.currentTimeMillis()+7000;while(System.currentTimeMillis()<end){instrumentation.waitForIdleSync();var busy=true;s.onActivity{a->busy=OperationsActivity::class.java.getDeclaredField("busy").apply{isAccessible=true}.getBoolean(a)};if(!busy)return;Thread.sleep(50)};fail("Operation did not finish")}
    private fun preview(s:JSONObject,req:JSONObject)=JSONObject().put("status","ok").put("revision",s.getString("revision")).put("previewHash","synthetic-preview")
        .put("target",s.getJSONArray("bills").getJSONObject(0).getJSONArray("receiptReferences").getJSONObject(0))
        .put("before",JSONObject().put("received",30000).put("unpaid",70000)).put("after",JSONObject().put("received",0).put("unpaid",100000))
    @Test fun correctionRequiresReasonSurvivesRecreationReviewsThenConfirmsOneAppend(){
        val original=seed();val requests=AtomicInteger();var reviewedId="";val originalEvent=original.getJSONArray("bills").getJSONObject(0).getJSONArray("receiptEvents").getJSONObject(0).toString()
        NativeOperationsTransport.testRequest={req->requests.incrementAndGet();assertEquals("synthetic-receipt",req.getString("reference"));assertEquals("익명 사유",req.getString("reason"));when(req.getString("action")){
            "receiptVoidPreview"->{reviewedId=req.getString("requestId");preview(original,req)}
            "receiptVoid"->{assertEquals(reviewedId,req.getString("requestId"));assertTrue(req.getBoolean("confirm"));assertEquals("synthetic-preview",req.getString("previewHash"));val latest=JSONObject(original.toString()).put("revision","sha256-"+"b".repeat(64));val b=latest.getJSONArray("bills").getJSONObject(0);b.getJSONArray("receiptReferences").getJSONObject(0).put("cancelled",true);b.getJSONArray("receiptEvents").put(JSONObject().put("kind","void").put("reference","synthetic-receipt").put("reason","익명 사유"));JSONObject().put("status","ok").put("latest",latest)}
            else->error("Unexpected live/read request")}}
        launch().use{s->click(s,"정정 후 잔액 검토");assertEquals(0,requests.get());fill(s,"익명 사유");s.recreate();idle(s);click(s,"정정 후 잔액 검토");idle(s);assertEquals(1,requests.get())
            s.onActivity{a->assertTrue(views(a.window.decorView).filterIsInstance<android.widget.TextView>().any{it.text.toString().contains("정정 후 수납 0원 / 잔액 100,000원")})}
            click(s,"원본 보존하고 정정 기록 저장");val device=UiDevice.getInstance(instrumentation);assertTrue(device.wait(Until.hasObject(By.text("확인하고 저장")),3000));device.findObject(By.text("확인하고 저장")).click();idle(s);assertEquals(2,requests.get())
            val b=store.read().getJSONObject("snapshot").getJSONArray("bills").getJSONObject(0);assertEquals(2,b.getJSONArray("receiptEvents").length());assertEquals(originalEvent,b.getJSONArray("receiptEvents").getJSONObject(0).toString());assertFalse(store.read().getBoolean("pending"))
        }
    }
    @Test fun failedPreviewKeepsEncryptedReasonAndOriginalSelection(){
        seed();NativeOperationsTransport.testRequest={throw java.io.IOException("익명 연결 실패")}
        launch().use{s->fill(s,"연결 실패 보관 사유");click(s,"정정 후 잔액 검토");idle(s);val draft=store.read().getJSONObject("operationDrafts").getJSONObject("ledger:2026-09:demo-0").getJSONObject("draft");assertEquals("연결 실패 보관 사유",draft.getString("voidReason"));assertEquals("synthetic-receipt",draft.getString("voidReference"));assertEquals(1,store.read().getJSONObject("snapshot").getJSONArray("bills").getJSONObject(0).getJSONArray("receiptEvents").length());assertFalse(store.read().getBoolean("pending"))}
    }
}
