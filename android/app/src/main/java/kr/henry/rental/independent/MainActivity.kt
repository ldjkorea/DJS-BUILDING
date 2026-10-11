package kr.henry.rental.independent

import android.app.Activity
import android.app.AlertDialog
import android.app.DatePickerDialog
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Bundle
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.widget.*
import androidx.browser.customtabs.CustomTabsIntent
import org.json.JSONArray
import org.json.JSONObject
import java.text.NumberFormat
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.Executors

/** Android Views render rental work. Browser use is explicit: owner approval,
 * external Google documents and APK downloads. Business work stays native. */
class MainActivity : Activity() {
    private val ink=Color.rgb(25,38,60); private val muted=Color.rgb(102,117,139)
    private val blue=Color.rgb(50,104,200); private val pale=Color.rgb(237,243,253)
    private val bg=Color.rgb(246,248,251); private val red=Color.rgb(178,59,73); private val green=Color.rgb(28,122,92)
    private lateinit var store: SecureSession; private lateinit var font: Typeface; private lateinit var content: LinearLayout
    private val executor=Executors.newSingleThreadExecutor()
    private var snapshot: JSONObject?=null; private var tab=0
    private var month=SimpleDateFormat("yyyy-MM",Locale.KOREA).format(Date())
    private var demo=false; private var busy=false; private var online=false; private var storageFault=false
    private var notice=""; private var query=""; private var updateText="새 버전을 확인할 수 있어요."
    private var formDraft: JSONObject?=null; private var activeDialog: AlertDialog?=null
    private var consumedPair=false
    private var refreshing=false; private var hasToken=false
    override fun onCreate(saved: Bundle?) {
        super.onCreate(saved); font=Typeface.createFromAsset(assets,"fonts/Pretendard-Regular.otf"); store=SecureSession(this)
        tab=saved?.getInt("tab")?:0; month=saved?.getString("month")?:month; query=saved?.getString("query")?:""; demo=saved?.getBoolean("demo")?:false
        formDraft=saved?.getString("form")?.let { JSONObject(it) }
        consumedPair=saved?.getBoolean("consumedPair")?:false
        try { val state=store.read(); snapshot=state.optJSONObject("snapshot"); hasToken=state.optString("token").isNotEmpty(); if(snapshot!=null&&saved==null)month=snapshot!!.optString("month",month); if(state.optBoolean("pending")) notice="이전 저장 결과를 새로고침으로 확인해주세요." }
        catch(_:Exception){storageFault=true;notice="기기 보관 자료를 읽지 못했습니다. 설정에서 기기 연결을 다시 시작해주세요."}
        if(demo) snapshot=NativeDemo.snapshot(month)
        render(); if(!consumePair(intent)&&!demo&&connected()) refresh(force=false)
        formDraft?.let { if(!busy) showForm(it, restoring=true) }
    }
    override fun onNewIntent(intent:Intent){super.onNewIntent(intent);setIntent(intent);consumedPair=false;consumePair(intent)}
    override fun onResume(){super.onResume();if(::store.isInitialized&&!demo&&!busy){try{val state=store.read();hasToken=state.optString("token").isNotEmpty();val latest=state.optJSONObject("snapshot");if(latest!=null&&latest.optString("revision")!=snapshot?.optString("revision")){snapshot=latest;online=false;render();if(connected())refresh(force=false)}}catch(_:Exception){online=false}}}
    override fun onSaveInstanceState(out:Bundle){out.putBoolean("consumedPair",consumedPair);out.putInt("tab",tab);out.putString("month",month);out.putString("query",query);out.putBoolean("demo",demo);out.putString("form",formDraft?.toString());super.onSaveInstanceState(out)}
    override fun onDestroy(){executor.shutdown();super.onDestroy()}
    private fun connected()= !storageFault && hasToken
    private fun dp(n:Int)=(n*resources.displayMetrics.density).toInt()
    private fun rounded(color:Int,radius:Int=20)=GradientDrawable().apply{setColor(color);cornerRadius=dp(radius).toFloat()}
    private fun column(p:Int=0)=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;setPadding(dp(p),dp(p),dp(p),dp(p))}
    private fun text(value:String,size:Float=14f,color:Int=ink,bold:Boolean=false)=TextView(this).apply{text=value;textSize=size;setTextColor(color);typeface=if(bold)Typeface.create(font,Typeface.BOLD)else font;setSingleLine(false);setHorizontallyScrolling(false);setLineSpacing(dp(4).toFloat(),1f);includeFontPadding=false}
    private fun add(parent:LinearLayout,view:View,top:Int=0,bottom:Int=0){parent.addView(view,LinearLayout.LayoutParams(-1,-2).apply{topMargin=dp(top);bottomMargin=dp(bottom)})}
    private fun button(label:String,primary:Boolean=false,readOnly:Boolean=false,action:()->Unit)=Button(this).apply{text=label;textSize=14f;typeface=font;isAllCaps=false;minHeight=dp(48);setTextColor(if(primary)Color.WHITE else blue);background=rounded(if(primary)blue else pale,14);setPadding(dp(14),dp(10),dp(14),dp(10));setOnClickListener{if(!busy||(refreshing&&readOnly))action()};isEnabled= !busy||(refreshing&&readOnly)}
    private fun card(parent:LinearLayout,color:Int=Color.WHITE,build:(LinearLayout)->Unit):LinearLayout {val box=column(20);box.background=rounded(color);add(parent,box,0,14);build(box);return box}
    private fun money(n:Long)=NumberFormat.getNumberInstance(Locale.KOREA).format(n)+"원"
    private fun row(parent:LinearLayout,label:String,value:String,color:Int=ink){val line=LinearLayout(this).apply{gravity=Gravity.CENTER_VERTICAL;setPadding(0,dp(7),0,dp(7))};line.addView(text(label,13f,muted),LinearLayout.LayoutParams(0,-2,1f));line.addView(text(value,14f,color,true).apply{gravity=Gravity.END},LinearLayout.LayoutParams(0,-2,1.2f));add(parent,line)}
    private fun objects(a:JSONArray?)=(0 until (a?.length()?:0)).mapNotNull{a?.optJSONObject(it)}
    private fun array(key:String)=objects(snapshot?.optJSONArray(key))
    private fun heading(title:String,sub:String){add(content,text(title,28f,ink,true),4,8);add(content,text(sub,14f,muted),0,24)}
    private fun render(){
        val root=column();root.setBackgroundColor(bg)
        root.setOnApplyWindowInsetsListener{v,i->if(android.os.Build.VERSION.SDK_INT>=30){val bars=i.getInsets(android.view.WindowInsets.Type.systemBars() or android.view.WindowInsets.Type.ime());v.setPadding(bars.left,bars.top,bars.right,bars.bottom)}else{@Suppress("DEPRECATION") v.setPadding(i.systemWindowInsetLeft,i.systemWindowInsetTop,i.systemWindowInsetRight,i.systemWindowInsetBottom)};i}
        val brand=LinearLayout(this).apply{gravity=Gravity.CENTER_VERTICAL;setPadding(dp(24),dp(18),dp(20),dp(8))}
        brand.addView(text("NEW RENT STORE",13f,blue,true),LinearLayout.LayoutParams(0,-2,1f))
        brand.addView(text(if(demo)"예시 모드" else if(busy)"연결 중…" else if(online)"● 연결됨" else if(connected())"● 보관 자료" else "● 연결 전",11f,if(online)green else muted));root.addView(brand)
        val scroll=ScrollView(this).apply{isFillViewport=true;clipToPadding=false};content=column(24);scroll.addView(content,FrameLayout.LayoutParams(-1,-2));root.addView(scroll,LinearLayout.LayoutParams(-1,0,1f))
        if(demo)add(content,text("예시 자료입니다 · 실제 자료에 저장하지 않습니다.",12f,blue),0,16)
        if(notice.isNotBlank())card(content,Color.rgb(255,245,232)){add(it,text(notice,13f,Color.rgb(135,82,26)))}
        if(busy)add(content,ProgressBar(this),0,12)
        when(tab){0->home();1->tenants();2->bills();else->settings()}
        val nav=LinearLayout(this).apply{setPadding(dp(12),dp(10),dp(12),dp(10));setBackgroundColor(Color.WHITE)}
        listOf("홈","세입자","고지서","설정").forEachIndexed{index,label->val item=text(label,13f,if(tab==index)blue else muted,tab==index).apply{gravity=Gravity.CENTER;minHeight=dp(52);background=rounded(if(tab==index)pale else Color.WHITE,14);contentDescription="$label 메뉴";isFocusable=true;setOnClickListener{if(!busy||refreshing){activeDialog?.dismiss();tab=index;render()}}};nav.addView(item,LinearLayout.LayoutParams(0,-2,1f).apply{leftMargin=dp(3);rightMargin=dp(3)})}
        root.addView(nav);setContentView(root)
    }
    private fun welcome(){card(content){add(it,text("내 자료와 연결하세요",21f,ink,true),0,12);add(it,text("처음 한 번 Google 소유자 계정으로 기기를 승인하면, 다음부터는 이 앱에서 바로 관리할 수 있어요.",15f,muted),0,20);add(it,button("Google 계정으로 연결",true){startPair()},0,10);add(it,button("연결 코드 입력"){manualPair()})};add(content,button("예시 화면 둘러보기"){demo=true;snapshot=NativeDemo.snapshot(month);notice="";render()})}
    private fun home(){
        heading("오늘도, 한눈에","수납과 계약을 한눈에 확인하세요.");if(snapshot==null){welcome();return};monthPicker()
        val s=snapshot!!.getJSONObject("summary")
        card(content,blue){add(it,text("이번 달 수납",13f,Color.rgb(214,230,255)),0,10);add(it,text(money(s.optLong("received")),30f,Color.WHITE,true),0,18)
            val ratio=if(s.optLong("total")>0)(100*s.optLong("received")/s.optLong("total")).toInt()else 0
            add(it,ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal).apply{max=100;progress=ratio;progressTintList=android.content.res.ColorStateList.valueOf(Color.WHITE);progressBackgroundTintList=android.content.res.ColorStateList.valueOf(Color.rgb(89,137,219))},0,10);add(it,text("청구 ${money(s.optLong("total"))}  ·  수납 $ratio%",12f,Color.rgb(225,237,255)))}
        card(content){row(it,"이번 달 미수납",money(s.optLong("unpaid")),red);row(it,"전체 기간 연체",money(s.optLong("overdue")),red);row(it,"등록 세입자","${s.optInt("activeTenants")}명");row(it,"이번 달 지출",money(s.optLong("expense")))}
        snapshot!!.optJSONObject("building")?.let{building->card(content){row(it,"층별 운영","입주 ${building.optInt("occupied")}층 · 공실 ${building.optInt("vacant")}층");val floors=building.optJSONArray("floors");for(i in 0 until (floors?.length()?:0)){val f=floors!!.getJSONObject(i);row(it,"${f.optInt("floor")}층",f.optJSONArray("statuses")?.let{a->(0 until a.length()).joinToString(" · "){a.getString(it)}}?:"확인 필요");if(f.optInt("repairCount")>0)row(it,"수리 ${f.optInt("repairCount")}건",f.optString("lastRepairOn"))}}}
        array("tenants").filter{!it.optBoolean("archived")&&it.optString("contractReviewOn").isNotBlank()}.forEach{t->card(content){row(it,"${t.optString("unit")} 계약 확인",t.optString("contractReviewOn"));add(it,button("확인 일정 보기",readOnly=true){openOperations("contract",t.optString("id"))})}}
        add(content,text("다가오는 계약",18f,ink,true),10,14)
        val deadlines=array("tenants").filter{ !it.optBoolean("archived")&&it.optJSONObject("deadline")!=null&&it.getJSONObject("deadline").optInt("days")<=45 }
        if(deadlines.isEmpty())card(content){add(it,text("45일 안에 만료되는 계약이 없어요.",14f,muted))}
        deadlines.forEach{t->card(content){add(it,text(t.optString("unit")+" · "+t.optString("biz").ifBlank{t.optString("name")},16f,ink,true));row(it,t.getJSONObject("deadline").optString("endDate"),t.getJSONObject("deadline").optString("label"),blue);add(it,button("계약 정보 보기",readOnly=true){tenantDetail(t)},8)}}
        add(content,button("공용 비용 정산"){openOperations("settlement")},4,12);add(content,button("이번 달 지출 내역",readOnly=true){expenseList()},4,12);add(content,button("새로고침",true){refresh()});add(content,text("기준일 ${snapshot!!.optString("today")} · 저장된 고지서 기준",11f,muted),16)
    }
    private fun monthPicker(){val line=LinearLayout(this).apply{gravity=Gravity.CENTER_VERTICAL};line.addView(button("‹"){moveMonth(-1)}.apply{contentDescription="이전 달"},LinearLayout.LayoutParams(dp(48),dp(48)));line.addView(text(month.replace("-","."),18f,ink,true).apply{gravity=Gravity.CENTER;contentDescription="조회 월 선택";isFocusable=true;setOnClickListener{selectMonth()}},LinearLayout.LayoutParams(0,dp(48),1f));line.addView(button("›"){moveMonth(1)}.apply{contentDescription="다음 달"},LinearLayout.LayoutParams(dp(48),dp(48)));add(content,line,0,18)}
    private fun moveMonth(offset:Int){val c=Calendar.getInstance();c.set(month.substring(0,4).toInt(),month.substring(5).toInt()-1,1);c.add(Calendar.MONTH,offset);month=SimpleDateFormat("yyyy-MM",Locale.KOREA).format(c.time);refresh()}
    private fun selectMonth(){val a=snapshot?.optJSONArray("months")?:JSONArray();val choices=(0 until a.length()).map{a.getString(it)}.distinct();if(choices.isEmpty())return;AlertDialog.Builder(this).setTitle("고지서 월 선택").setItems(choices.toTypedArray()){_,i->month=choices[i];refresh()}.show()}
    private fun tenants(){
        heading("세입자","계약과 수납 상태를 함께 확인하세요.");if(snapshot==null){welcome();return}
        val search=EditText(this).apply{hint="이름 · 상호 · 호실 검색";textSize=14f;typeface=font;background=rounded(Color.WHITE,14);setPadding(dp(16),dp(14),dp(16),dp(14));setText(query);isSingleLine=true};add(content,search,0,18);val list=column();add(content,list)
        fun populate(){list.removeAllViews();val found=array("tenants").filter{ !it.optBoolean("archived")&&listOf(it.optString("name"),it.optString("biz"),it.optString("unit")).joinToString(" ").contains(query,true)}
            if(found.isEmpty())card(list){add(it,text("검색 결과가 없어요.",14f,muted))}
            found.forEach{t->card(list){add(it,text(t.optString("biz").ifBlank{t.optString("name")},18f,ink,true),0,6);add(it,text(t.optString("unit")+" · "+t.optString("name")+" · "+t.optString("leaseStatus"),12f,muted),0,10);val c=t.optJSONObject("collection")?:JSONObject();row(it,"수납 상태",c.optString("status","정상"),if(c.optLong("totalOverdue")>0)red else green);row(it,"월차임 공급가",money(t.optLong("rent")));add(it,button("세입자 정보",readOnly=true){tenantDetail(t)},10)}}}
        search.addTextChangedListener(watcher{query=it;populate()});populate()
    }
    private fun watcher(change:(String)->Unit)=object:TextWatcher{override fun beforeTextChanged(s:CharSequence?,st:Int,c:Int,a:Int){};override fun onTextChanged(s:CharSequence?,st:Int,b:Int,c:Int){change(s.toString())};override fun afterTextChanged(s:Editable?) {}}
    private fun tenantDetail(t:JSONObject){val box=column(24);add(box,text(t.optString("unit")+" · "+t.optString("name"),21f,ink,true),0,18);row(box,"상호",t.optString("biz").ifBlank{"미등록"});row(box,"보증금",money(t.optLong("deposit")));row(box,"월차임 공급가",money(t.optLong("rent")));row(box,"관리비 공급가",money(t.optLong("mgmt")));add(box,text("계약 기간",12f,muted),16,8);add(box,text(t.optString("contract").ifBlank{"계약 기간 미등록"},15f));row(box,"전체 연체",money(t.optJSONObject("collection")?.optLong("totalOverdue")?:0),red);add(box,text("변경 이력",15f,ink,true),20,8);audit(box,t.optJSONArray("audit"));if(t.optString("phone").isNotBlank())add(box,button("전화 걸기"){openExternal("tel:"+Uri.encode(t.optString("phone")))},12);add(box,button("계약 변경 · 재계약"){activeDialog?.dismiss();openOperations("contract",t.getString("id"))},16);showDetail("세입자 정보",box)}
    private fun bills(){
        heading("고지서 · 수납","저장된 청구액과 실제 입금 날짜를 확인하세요.");if(snapshot==null){welcome();return};monthPicker();val rows=array("bills")
        if(rows.isEmpty())card(content){add(it,text("이 달에는 저장된 고지서가 없어요.",16f,ink,true),0,8);add(it,button("정산하고 고지서 생성"){openOperations("settlement")})}
        rows.forEach{b->card(content){add(it,text(b.optString("unit")+" · "+b.optString("name"),18f,ink,true),0,8);row(it,"청구 합계",money(b.optLong("total")));row(it,"수납",money(b.optLong("received")),green);row(it,"미수납",money(b.optLong("unpaid")),if(b.optLong("unpaid")>0)red else ink);add(it,button("내역 · 입금 처리",b.optLong("unpaid")>0,readOnly=true){billDetail(b)},12)}};add(content,button("새로고침"){refresh()},4)
    }
    private val itemNames=linkedMapOf("pay_rent" to "월세","pay_mgmt" to "관리비","pay_elec" to "전기","pay_water" to "수도","pay_elev" to "승강기","pay_waste" to "오물비")
    private fun billDetail(b:JSONObject){
        val box=column(24);add(box,text(month+" · "+b.optString("unit"),13f,muted),0,8);add(box,text(b.optString("name"),23f,ink,true),0,16);val items=b.optJSONObject("items")?:JSONObject()
        itemNames.forEach{(key,label)->val i=items.optJSONObject(key)?:JSONObject();if(i.optLong("amount")>0){row(box,label,money(i.optLong("amount")));add(box,text(if(i.optBoolean("na"))"청구 제외" else "수납 ${money(i.optLong("received"))} · 잔액 ${money(i.optLong("unpaid"))}"+i.optString("date").let{if(it.isBlank())"" else " · $it"},12f,muted),0,8)}}
        if(b.optBoolean("ledger")){add(box,text("입금 원장 · 항목별 기록",14f,blue,true),12,8);itemNames.forEach{(key,label)->if((items.optJSONObject(key)?.optLong("unpaid")?:0)>0)add(box,button("$label 입금 추가"){activeDialog?.dismiss();showForm(JSONObject().put("kind","receipt").put("tenantId",b.getString("tenantId")).put("item",key).put("max",items.getJSONObject(key).optLong("unpaid")))},8)}}
        else listOf("rent" to "월세","mgmt" to "관리비 전체").forEach{(group,label)->val g=b.getJSONObject("groups").getJSONObject(group);if(g.optLong("total")>0){add(box,button("$label 완납 날짜 저장",!g.optBoolean("complete")){activeDialog?.dismiss();showForm(JSONObject().put("kind","payment").put("tenantId",b.getString("tenantId")).put("group",group).put("remove",false))},10);if(g.optLong("received")>0)add(box,button("$label 완납 취소"){activeDialog?.dismiss();showForm(JSONObject().put("kind","payment").put("tenantId",b.getString("tenantId")).put("group",group).put("remove",true))},8)}}
        add(box,text("변경 이력",15f,ink,true),20,8);audit(box,b.optJSONArray("audit"));add(box,button("고지서 PDF · 세금계산서"){activeDialog?.dismiss();openOperations("output",b.getString("tenantId"))},16);add(box,button(if(b.optBoolean("ledger"))"입금 기록 · 정정"else"입금 원장 시작"){activeDialog?.dismiss();openOperations("ledger",b.getString("tenantId"))},10);showDetail("고지서 내역",box)
    }
    private fun audit(box:LinearLayout,rows:JSONArray?){if((rows?.length()?:0)==0){add(box,text("기록된 변경이 없어요.",12f,muted));return};objects(rows).forEach{add(box,text(it.optString("action")+"\n"+it.optString("at").take(10)+" · "+it.optString("detail"),12f,muted),4,8)}}
    private fun showDetail(title:String,box:LinearLayout){activeDialog=AlertDialog.Builder(this).setTitle(title).setView(ScrollView(this).apply{addView(box)}).setPositiveButton("닫기",null).show()}
    private fun expenseList(){val box=column(24);add(box,text("$month 지출",22f,ink,true),0,16);val expenses=array("expenses");if(expenses.isEmpty())add(box,text("기록된 지출이 없어요.",14f,muted),0,12);expenses.forEach{row(box,it.optString("name"),money(it.optLong("amount")));add(box,text(it.optString("date")+" · "+it.optString("memo"),12f,muted),0,10)};add(box,button("지출 추가",true){activeDialog?.dismiss();showForm(JSONObject().put("kind","expense"))},16);showDetail("지출 내역",box)}
    private fun settings(){
        heading("설정","내 연결과 앱 버전을 관리하세요.")
        card(content){add(it,text("앱 업데이트",18f,ink,true),0,8);add(it,text("Android ${BuildConfig.VERSION_NAME}",14f,muted),0,8);add(it,text("새 버전이 있으면 앱에서 내려받아 설치 화면으로 이어집니다.",13f,muted),0,14);add(it,button("앱 업데이트",true,readOnly=true){startActivity(Intent(this,UpdateActivity::class.java))})}
        card(content){add(it,text("Google 연결",18f,ink,true),0,8);add(it,text(if(connected())"승인한 기기로 기존 GAS 자료에 연결합니다."else"소유자 계정으로 기기를 승인해주세요.",13f,muted),0,14);add(it,button(if(connected())"기기 다시 연결"else"Google 계정으로 연결",true){startPair()},0,10);add(it,button("연결 코드 입력"){manualPair()},0,10);if(connected())add(it,button("이 기기 연결 해제"){disconnect()});if(storageFault)add(it,button("기기 보관 자료 초기화"){AlertDialog.Builder(this).setMessage("이 기기의 연결과 보관 자료만 지웁니다. Google 시트 자료는 유지됩니다.").setNegativeButton("취소",null).setPositiveButton("기기 자료 초기화"){_,_->NativeSnapshots.reader.invalidate();store.clear();hasToken=false;storageFault=false;snapshot=null;notice="";render()}.show()})}
        if(snapshot!=null&&!demo)card(content){add(it,text("연동 작업",18f,ink,true),0,14);add(it,button("현재현황 문서 다시 생성"){confirmService("regenerateCurrentStatus","현재현황 문서")},0,10);add(it,button("계약 일정 Calendar 동기화"){confirmService("syncContractCalendar","계약 일정")},0,10);val doc=snapshot?.optJSONObject("links")?.optString("document")?:"";if(doc.startsWith("https://docs.google.com/document/d/"))add(it,button("Google 문서 열기"){openExternal(doc)})}
        card(content){add(it,text("앱에서 관리",18f,ink,true),0,8);add(it,button("계약 변경 · 재계약"){openOperations("contract")},0,10);add(it,button("공용 비용 정산"){openOperations("settlement")},0,10);add(it,button("고지서 · 정산 출력"){openOperations("output")},0,10);add(it,button("백업 · 복원"){openOperations("backup")})}
        add(content,button(if(demo)"예시 모드 종료"else"예시 화면 둘러보기"){demo= !demo;snapshot=if(demo)NativeDemo.snapshot(month)else try{store.read().optJSONObject("snapshot")}catch(_:Exception){null};online=false;notice="";render();if(!demo&&connected())refresh()});add(content,text("Pretendard · SIL Open Font License\n자료는 기기에 암호화하여 보관합니다. 오프라인에서는 조회만 가능합니다.",11f,muted),18)
    }
    private fun showForm(draft:JSONObject,restoring:Boolean=false){
        if(demo){toast("예시 모드에서는 실제 자료를 저장하지 않습니다.");return}
        if((!online&&!restoring)||busy||storageFault){toast("새로고침으로 최신 자료를 확인한 뒤 저장해주세요.");return};formDraft=draft
        val kind=draft.getString("kind");val title=when(kind){"expense"->"지출 추가";"receipt"->"입금 추가";else->if(draft.optBoolean("remove"))"완납 취소"else"완납 날짜 저장"};val box=column(24)
        add(box,text("조회 월 $month · 기존 자료와 비교해 저장합니다.",12f,muted),0,18)
        fun field(key:String,label:String,numeric:Boolean=false,fallback:String=""):EditText{add(box,text(label,12f,muted),8,6);val edit=EditText(this).apply{hint=label;textSize=16f;typeface=font;setText(draft.optString(key,fallback));setPadding(dp(14),dp(12),dp(14),dp(12));background=rounded(bg,10);isSingleLine=true;inputType=if(numeric)InputType.TYPE_CLASS_NUMBER else InputType.TYPE_CLASS_TEXT;addTextChangedListener(watcher{draft.put(key,it)})};draft.put(key,edit.text.toString());add(box,edit);return edit}
        if(kind=="expense")field("label","지출 이름");if(kind!="payment")field("amount","금액 (원)",true)
        val today=snapshot?.optString("today")?:SimpleDateFormat("yyyy-MM-dd",Locale.KOREA).format(Date());val date=field("date","날짜",false,today)
        date.isFocusable=false;date.setOnClickListener{val p=date.text.toString().split("-").mapNotNull{it.toIntOrNull()};val c=Calendar.getInstance();DatePickerDialog(this,{_,y,m,d->date.setText("%04d-%02d-%02d".format(y,m+1,d))},p.getOrNull(0)?:c.get(Calendar.YEAR),(p.getOrNull(1)?:c.get(Calendar.MONTH)+1)-1,p.getOrNull(2)?:c.get(Calendar.DAY_OF_MONTH)).show()}
        if(kind!="payment")field("note","메모 (선택)")
        val dialog=AlertDialog.Builder(this).setTitle(title).setView(ScrollView(this).apply{addView(box)}).setNegativeButton("취소"){_,_->formDraft=null}.setPositiveButton("저장",null).create();activeDialog=dialog;dialog.setOnCancelListener{formDraft=null}
        dialog.setOnShowListener{dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener{
            val n=draft.optString("amount").toLongOrNull()
            if(kind!="payment"&&(n==null||n<=0||n>1000000000000L||kind=="receipt"&&n>draft.optLong("max"))){toast("유효한 금액을 입력해주세요.");return@setOnClickListener}
            if(kind=="expense"&&draft.optString("label").isBlank()){toast("지출 이름을 입력해주세요.");return@setOnClickListener}
            if(draft.optString("date")>today||kind=="expense"&&!draft.optString("date").startsWith(month)){toast("조회 월과 실제 날짜를 확인해주세요.");return@setOnClickListener}
            val request=JSONObject(draft.toString()).put("action",kind)
            AlertDialog.Builder(this).setTitle("$title 확인").setMessage(if(kind=="payment")"${draft.optString("date")} 날짜로 ${if(draft.optBoolean("remove"))"완납 기록을 취소"else"완납을 기록"}할까요?"else"${money(n!!)}을 ${draft.optString("date")} 날짜로 저장할까요?").setNegativeButton("돌아가기",null).setPositiveButton("확인하고 저장"){_,_->if(online&&!busy){dialog.dismiss();formDraft=null;mutate(request)}else toast("최신 자료를 새로고침한 뒤 저장해주세요.")}.show()
        }};dialog.show()
    }
    private fun confirmService(action:String,label:String){AlertDialog.Builder(this).setMessage("저장된 최신 자료로 $label 연동을 실행할까요?").setNegativeButton("취소",null).setPositiveButton("실행"){_,_->mutate(JSONObject().put("action",action))}.show()}
    private fun refresh(force:Boolean=true){
        if(busy)return;if(demo){snapshot=NativeDemo.snapshot(month);online=false;render();return};if(!connected()){render();return}
        val state=try{store.read()}catch(_:Exception){NativeSnapshots.reader.invalidate();storageFault=true;online=false;notice="기기 보관 자료를 읽지 못했습니다. 설정에서 연결을 확인해주세요.";render();return}
        if(!force&&NativeSnapshots.reader.fresh(state,month)){online=true;notice="";render();return}
        online=false;refreshing=true
        runTask(if(snapshot!=null)"보관 자료를 먼저 표시합니다. 최신 자료를 확인하는 동안 메뉴를 둘러볼 수 있어요."else"최신 자료를 불러오고 있어요.",{
            val state=store.read();val response=NativeSnapshots.reader.load(state,month,force);ensureOk(response)
            require(response.optString("revision").matches(Regex("sha256-[a-f0-9]{64}"))&&response.optString("protocol")=="rental-native-v1"){"서버 자료를 확인하지 못했습니다."}
            store.update{it.put("snapshot",response).put("pending",false)};response
        }){snapshot=it;month=it.getString("month");online=true;notice="";formDraft?.let{draft->window.decorView.post{showForm(draft,restoring=true)}}}
    }
    private fun mutate(request:JSONObject){
        if(demo||!online||busy||!connected()){toast("최신 자료를 불러온 뒤 저장해주세요.");return};val revision=snapshot?.optString("revision")?:return
        request.put("expectedRevision",revision).put("requestId",UUID.randomUUID().toString()).put("month",month).put("includeSnapshot",true)
        runTask("저장 결과를 확인하고 있어요. 요청을 자동으로 다시 보내지 않습니다.",{
            val state=store.read();require(!state.optBoolean("pending")){"이전 저장 결과부터 새로고침으로 확인해주세요."};request.put("token",state.getString("token"));NativeSnapshots.reader.invalidate();store.update{it.put("pending",true)}
            val result=NativeApi.request(request);ensureOk(result);val latest=NativeSnapshots.reader.afterSave(result,state,month);ensureOk(latest);NativeSnapshots.reader.validate(latest,month)
            store.update{it.put("snapshot",latest).put("pending",false)};NativeSnapshots.reader.remember(state.getString("token"),latest);JSONObject().put("latest",latest).put("result",result)
        }){snapshot=it.getJSONObject("latest");online=true;val result=it.getJSONObject("result");val ext=result.optJSONObject("docs")?:result.optJSONObject("calendar");notice=if(ext?.optString("status")=="error")"자료 저장은 완료됐습니다. 문서·일정 연동은 설정에서 다시 시도해주세요."else"저장하고 최신 자료를 확인했습니다."}
    }
    private class Unauthorized(message:String):Exception(message)
    private fun ensureOk(r:JSONObject){if(r.optString("status")=="unauthorized")throw Unauthorized(r.optString("message","기기를 다시 연결해주세요."));require(r.optString("status")=="ok"){r.optString("message","처리 결과를 확인하지 못했습니다. 새로고침해주세요.")}}
    private fun runTask(message:String,work:()->JSONObject,success:(JSONObject)->Unit){
        if(busy)return;busy=true;notice=message;render();executor.execute{
            try{val result=work();runOnUiThread{if(!isDestroyed){busy=false;refreshing=false;try{success(result)}catch(_:Exception){online=false;notice="서버 응답을 확인하지 못했습니다. 새로고침해주세요."};render()}}}
            catch(e:Exception){NativeSnapshots.reader.invalidate();if(e is Unauthorized)try{store.clear()}catch(_:Exception){};runOnUiThread{if(!isDestroyed){busy=false;refreshing=false;online=false;if(e is Unauthorized){snapshot=null;hasToken=false};notice=(e.message?:"인터넷 연결을 확인해주세요.")+if(connected()&&snapshot!=null)"\n보관 자료를 표시합니다. 새로고침 전에는 저장할 수 없습니다."else"";render()}}}
        }
    }
    private fun startPair(){if(storageFault||busy){toast("먼저 기기 보관 자료를 확인해주세요.");return};try{val verifier=SecureSession.verifier();store.update{it.put("verifier",verifier)};CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(this,Uri.parse(AppDestination.WEB_APP+"?nativePair="+SecureSession.challenge(verifier)))}catch(_:Exception){toast("기기 연결을 시작하지 못했습니다. 브라우저와 저장소를 확인해주세요.")}}
    private fun manualPair(){val input=EditText(this).apply{hint="승인 화면의 연결 코드";inputType=InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS};AlertDialog.Builder(this).setTitle("연결 코드 입력").setView(input).setNegativeButton("취소",null).setPositiveButton("연결"){_,_->exchange(input.text.toString().trim())}.show()}
    private fun consumePair(intent:Intent?):Boolean{if(consumedPair)return false;val uri=intent?.data?:return false;if(uri.scheme!="rentstore"||uri.host!="pair")return false;val code=uri.getQueryParameter("code")?:return false;consumedPair=true;exchange(code);return true}
    private fun exchange(code:String){if(!code.matches(Regex("[a-f0-9]{64}"))||busy||storageFault){toast("올바른 연결 코드를 확인해주세요.");return};runTask("승인한 기기를 연결하고 있어요.",{
        val verifier=store.read().optString("verifier");require(verifier.matches(Regex("[a-f0-9]{64}"))){"앱에서 Google 연결을 먼저 시작해주세요."};val r=NativeApi.request(JSONObject().put("action","pair").put("code",code).put("verifier",verifier));require(r.optString("status")=="ok"){r.optString("message","연결 코드를 다시 확인해주세요.")};require(r.optString("token").matches(Regex("[a-f0-9]{64}"))){"기기 승인 응답을 확인해주세요."};store.update{it.put("token",r.getString("token"));it.remove("verifier");it.remove("snapshot");it.put("pending",false)};r
    }){hasToken=true;NativeSnapshots.reader.invalidate();demo=false;snapshot=null;notice="연결했습니다. 새로고침으로 자료를 불러오세요.";tab=0;window.decorView.post{refresh()}}}
    private fun disconnect(){AlertDialog.Builder(this).setMessage("이 기기 연결과 보관 자료를 해제할까요? Google 시트 자료는 유지됩니다.").setNegativeButton("취소",null).setPositiveButton("연결 해제"){_,_->runTask("기기 연결을 해제하고 있어요.",{val r=NativeApi.request(JSONObject().put("action","disconnect").put("token",store.read().getString("token")));ensureOk(r);NativeSnapshots.reader.invalidate();store.clear();r}){hasToken=false;demo=false;snapshot=null;online=false;notice="기기 연결을 해제했습니다."}}.show()}
    private fun openExternal(url:String){if(!(url==AppDestination.WEB_APP||url==AppDestination.RELEASE_URL||url.startsWith("https://docs.google.com/document/d/")||url.startsWith("tel:")))return;try{startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(url)))}catch(_:Exception){toast("링크를 열 수 있는 앱을 확인해주세요.")}}
    private fun toast(message:String){Toast.makeText(this,message,Toast.LENGTH_LONG).show()}
    private fun openOperations(mode:String,id:String?=null){startActivity(Intent(this,OperationsActivity::class.java).putExtra("mode",mode).putExtra("month",month).putExtra("tenantId",id?:"").putExtra("demo",demo))}
}
