package kr.henry.rental.independent

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.View
import android.widget.*
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.Executors

/** Native operations share the owner's conditional transaction and domain rules.
 * Drafts and imported files remain in the encrypted session, never Intent extras. */
class OperationsActivity:Activity() {
    private lateinit var store:SecureSession
    private lateinit var font:Typeface
    private lateinit var body:LinearLayout
    private lateinit var taskStatus:LinearLayout;private lateinit var backButton:Button
    private val executor=Executors.newSingleThreadExecutor()
    private var mode="contract";private var month="";private var tenantId="";private var demo=false
    private var snapshot=JSONObject();private var draft=JSONObject();private var preview:JSONObject?=null
    private var deferredResult:Triple<Int,Int,Intent?>?=null
    private var online=false;private var busy=false;private var notice="";private var draftKey=""
    private val blue=Color.rgb(50,104,200);private val ink=Color.rgb(25,38,60);private val muted=Color.rgb(102,117,139)
    override fun onCreate(saved:Bundle?){super.onCreate(saved)
        font=Typeface.createFromAsset(assets,"fonts/Pretendard-Regular.otf");store=SecureSession(this)
        mode=intent.getStringExtra("mode")?:"contract";month=intent.getStringExtra("month")?:"";tenantId=saved?.getString("tenantId")?:intent.getStringExtra("tenantId")?:"";demo=intent.getBooleanExtra("demo",false)
        try{snapshot=if(demo)NativeDemo.snapshot(month)else store.read().optJSONObject("snapshot")?:JSONObject();loadDraft();render();if(!demo)refresh(force=false)}
        catch(_:Exception){notice="기기 보관 자료를 읽지 못했습니다. 홈에서 연결을 확인해주세요.";render()}
    }
    override fun onSaveInstanceState(out:Bundle){out.putString("tenantId",tenantId);saveDraft();super.onSaveInstanceState(out)}
    override fun onDestroy(){executor.shutdown();super.onDestroy()}
    private fun dp(n:Int)=(n*resources.displayMetrics.density).toInt()
    private fun column(p:Int=0)=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;setPadding(dp(p),dp(p),dp(p),dp(p))}
    private fun text(s:String,size:Float=14f,color:Int=ink)=TextView(this).apply{text=s;textSize=size;typeface=font;setTextColor(color);setLineSpacing(dp(3).toFloat(),1f)}
    private fun add(v:View,top:Int=8){body.addView(v,LinearLayout.LayoutParams(-1,-2).apply{topMargin=dp(top)})}
    private fun button(s:String,primary:Boolean=false,click:()->Unit)=Button(this).apply{text=s;typeface=font;isAllCaps=false;minHeight=dp(48);setTextColor(if(primary)Color.WHITE else blue);background=GradientDrawable().apply{setColor(if(primary)blue else Color.rgb(237,243,253));cornerRadius=dp(14).toFloat()};isEnabled=!busy;setOnClickListener{if(!busy)click()}}
    private fun rows(a:JSONArray?)=(0 until (a?.length()?:0)).mapNotNull{a?.optJSONObject(it)}
    private fun tenant()=rows(snapshot.optJSONArray("tenants")).firstOrNull{it.optString("id")==tenantId}
    private fun bill()=rows(snapshot.optJSONArray("bills")).firstOrNull{it.optString("tenantId")==tenantId}
    private fun loadDraft(){draftKey="$mode:$month:$tenantId";val saved=store.read().optJSONObject(if(demo)"demoOperationDrafts"else"operationDrafts")?.optJSONObject(draftKey);draft=saved?.optJSONObject("draft")?:JSONObject();preview=saved?.optJSONObject("preview")}
    private fun saveDraft(){if(draftKey.isBlank())return;try{store.update{state->val key=if(demo)"demoOperationDrafts"else"operationDrafts";val drafts=state.optJSONObject(key)?:JSONObject();drafts.put(draftKey,JSONObject().put("draft",draft).put("preview",preview?:JSONObject.NULL));state.put(key,drafts)}}catch(_:Exception){online=false;notice="입력 내용을 안전하게 보관하지 못했습니다. 저장소를 확인해주세요."}}
    private fun clearDraft(){store.update{it.optJSONObject(if(demo)"demoOperationDrafts"else"operationDrafts")?.remove(draftKey)};draft=JSONObject();preview=null}
    private fun field(key:String,label:String,fallback:String="",numeric:Boolean=false,decimal:Boolean=false):EditText{
        add(text(label,12f,muted),14);val edit=EditText(this).apply{hint=label;contentDescription=label;typeface=font;textSize=16f;isSingleLine=true;inputType=if(numeric)InputType.TYPE_CLASS_NUMBER or if(decimal)InputType.TYPE_NUMBER_FLAG_DECIMAL else 0 else InputType.TYPE_CLASS_TEXT;setText(draft.optString(key,fallback));setPadding(dp(12),dp(10),dp(12),dp(10))}
        draft.put(key,edit.text.toString());edit.addTextChangedListener(object:TextWatcher{override fun beforeTextChanged(s:CharSequence?,start:Int,count:Int,after:Int){};override fun afterTextChanged(s:Editable?){};override fun onTextChanged(s:CharSequence?,start:Int,before:Int,count:Int){draft.put(key,s.toString());preview=null;saveDraft()}});add(edit,2);return edit
    }
    private fun check(key:String,label:String,fallback:Boolean=false)=CheckBox(this).apply{text=label;typeface=font;isChecked=draft.optBoolean(key,fallback);draft.put(key,isChecked);setOnCheckedChangeListener{_,value->draft.put(key,value);preview=null;saveDraft()}}.also{add(it)}
    private fun choice(key:String,label:String,options:List<Pair<String,String>>,fallback:String){add(text(label,12f,muted),14);val value=draft.optString(key,fallback);val choices=if(options.any{it.first==value})options else listOf(value to "기존 설정 ($value)")+options;val spinner=Spinner(this);spinner.contentDescription=label;spinner.adapter=ArrayAdapter(this,android.R.layout.simple_spinner_dropdown_item,choices.map{it.second});spinner.setSelection(choices.indexOfFirst{it.first==value}.coerceAtLeast(0));draft.put(key,value);spinner.onItemSelectedListener=object:AdapterView.OnItemSelectedListener{override fun onNothingSelected(parent:AdapterView<*>?){};override fun onItemSelected(parent:AdapterView<*>?,view:View?,position:Int,id:Long){(view as? TextView)?.typeface=font;val next=choices[position].first;if(draft.optString(key)!=next){draft.put(key,next);preview=null;saveDraft()}}};add(spinner,2)}
    private fun render(){val root=column();root.setBackgroundColor(Color.rgb(246,248,251));root.setOnApplyWindowInsetsListener{v,i->if(android.os.Build.VERSION.SDK_INT>=30){val bars=i.getInsets(android.view.WindowInsets.Type.systemBars() or android.view.WindowInsets.Type.ime());v.setPadding(bars.left,bars.top,bars.right,bars.bottom)}else{@Suppress("DEPRECATION") v.setPadding(i.systemWindowInsetLeft,i.systemWindowInsetTop,i.systemWindowInsetRight,i.systemWindowInsetBottom)};i}
        val top=LinearLayout(this).apply{setPadding(dp(18),dp(12),dp(18),dp(8))};backButton=button("뒤로"){finish()}.apply{setOnClickListener{finish()}};top.addView(backButton,LinearLayout.LayoutParams(0,-2,1f));top.addView(button("새로고침"){refresh()},LinearLayout.LayoutParams(0,-2,1f));root.addView(top)
        body=column(24);root.addView(ScrollView(this).apply{addView(body)},LinearLayout.LayoutParams(-1,0,1f));setContentView(root)
        add(text(when(mode){"contract"->"계약 변경 · 재계약";"settlement"->"공용 비용 정산";"output"->"고지서 · 정산 출력";"ledger"->"입금 원장 · 기록 정정";else->"백업 · 복원"},25f),4)
        add(text("$month · "+if(demo)"예시 자료 · 실제 저장 불가"else if(online)"최신 자료 확인됨"else"보관 자료 · 저장 전 새로고침",12f,muted))
        taskStatus=column();add(taskStatus,0);updateTaskStatus()
        when(mode){"contract"->contract();"settlement"->settlement();"output"->output();"ledger"->ledger();else->backup()}
    }
    private fun chooseTenant(onSelected:()->Unit){val people=if(mode in listOf("ledger","output"))rows(snapshot.optJSONArray("bills")).map{b->JSONObject().put("id",b.optString("tenantId")).put("unit",b.optString("unit")).put("name",b.optString("name"))}else rows(snapshot.optJSONArray("tenants")).filter{!it.optBoolean("archived")};add(button("세입자 선택 · "+(tenant()?.optString("unit")?:"선택 필요")){AlertDialog.Builder(this).setTitle("세입자 선택").setItems(people.map{it.optString("unit")+" · "+it.optString("name")}.toTypedArray()){_,i->saveDraft();tenantId=people[i].getString("id");loadDraft();onSelected()}.show()})}
    private val termLabels=linkedMapOf("unit" to "호실","contract" to "계약 기간 (YYYY.MM.DD ~ YYYY.MM.DD)","contract_first" to "최초 계약 기간","deposit" to "보증금 (원)","rent" to "월차임 공급가 (원)","mgmt" to "고정 관리비 공급가 (원)","elevator" to "승강기 운용비 공급가 (원)","elecType" to "전기 배분 방식 (fixed / remain / none)","elecFixed" to "전기 고정 공급가 (원)","payday" to "납입일 (예: 15일)","paytype" to "납부 방식","renew" to "재계약 단위","period_rent" to "월차임 시작일 (1~31)","period_mgmt" to "관리비 시작일 (1~31)","period_elec" to "전기 시작일 (1~31)","period_elev" to "승강기 시작일 (1~31)","period_waste" to "오물비 시작일 (1~31)","period_water_day" to "수도 계량일 (1~31)","period_water_odd" to "수도 부과월 (odd / even)")
    private fun contract(){chooseTenant{render()};val t=tenant()?:return;val terms=t.optJSONObject("terms")?:JSONObject().put("unit",t.optString("unit")).put("contract",t.optString("contract")).put("rent",t.optLong("rent")).put("mgmt",t.optLong("mgmt")).put("deposit",t.optLong("deposit"))
        if(snapshot.optJSONObject("capabilities")?.optBoolean("contractReview")==true){
            field("contractReviewOn","계약 확인 예정일 (YYYY-MM-DD, 비우면 해제)",t.optString("contractReviewOn"))
            add(button("현재 조건 유지하고 확인 일정만 저장"){confirm("계약 확인 일정","협의할 날짜만 기록합니다. 현재 계약·월세·고지서와 Calendar는 변경하지 않습니다."){write(JSONObject().put("action","contractReview").put("tenantId",tenantId).put("reviewOn",draft.optString("contractReviewOn").trim()))}},12)
        }
        add(text("기존 고지서 청구 기준을 보존하고 변경 전후 조건을 기록합니다.",13f,muted),16)
        add(button(if(draft.optBoolean("advanced"))"추가 계약 조건 접기"else"납입일 · 사용기간 등 추가 조건"){draft.put("advanced",!draft.optBoolean("advanced"));saveDraft();render()},18)
        termLabels.filter{(key,_)->key in listOf("unit","contract","deposit","rent","mgmt")||draft.optBoolean("advanced")}.forEach{(key,label)->val original=if(terms.isNull(key))""else terms.optString(key);when(key){"elecType"->choice("term.$key","전기 배분 방식",listOf("" to "미등록","none" to "해당 없음","fixed" to "고정금액","remain" to "나머지 자동"),original);"period_water_odd"->choice("term.$key","수도 부과월",listOf("" to "미등록","odd" to "홀수 달","even" to "짝수 달"),original);else->field("term.$key",label,original,key in listOf("deposit","rent","mgmt","elevator","elecFixed")||key.startsWith("period_"))}}
        add(text("관리비 세부 항목",14f,blue),20)
        val originalItems=terms.optJSONArray("mgmtItems")?:JSONArray();val items=draft.optJSONArray("mgmtItems")?:JSONArray(originalItems.toString()).also{draft.put("mgmtItems",it)}
        rows(items).forEachIndexed{i,item->field("item.$i.name","항목 ${i+1} 이름",item.optString("name",item.optString("key")));field("item.$i.amount","항목 ${i+1} 공급가 (원)",item.optString("amount","0"),true);choice("item.$i.status","항목 ${i+1} 상태",listOf("active" to "운영중 · 고정 관리비","actual" to "실비 정산","na" to "청구 제외","inactive" to "미운영"),item.optString("status","active"));add(button("항목 ${i+1} 삭제"){val next=JSONArray();for(j in 0 until items.length())if(j!=i){val copy=JSONObject(items.getJSONObject(j).toString());copy.put("name",draft.optString("item.$j.name",copy.optString("name"))).put("amount",draft.optString("item.$j.amount",copy.optString("amount"))).put("status",draft.optString("item.$j.status",copy.optString("status")));next.put(copy)};clearItemFields();draft.put("mgmtItems",next).put("mgmtEdited",true);saveDraft();render()})}
        add(button("관리비 항목 추가"){rows(items).forEachIndexed{i,item->item.put("name",draft.optString("item.$i.name",item.optString("name"))).put("amount",draft.optString("item.$i.amount",item.optString("amount"))).put("status",draft.optString("item.$i.status",item.optString("status")))};items.put(JSONObject().put("key","custom-"+UUID.randomUUID()).put("name","추가 항목").put("amount",0).put("status","active"));clearItemFields();draft.put("mgmtEdited",true);saveDraft();render()})
        field("effectiveOn","적용일 (YYYY-MM-DD)",snapshot.optString("today"));field("reason","변경 사유");check("renewal","재계약 완료로 기록")
        add(button("변경 내용 검토",true){try{val patch=JSONObject();termLabels.forEach{(key,_)->val value=draft.optString("term.$key",if(terms.isNull(key))""else terms.optString(key));val old=if(terms.isNull(key))""else terms.optString(key);if(value!=old)patch.put(key,if(key in listOf("deposit","rent","mgmt","elevator","elecFixed"))amount(value)else value)}
            val edited=JSONArray();rows(items).forEachIndexed{i,item->edited.put(JSONObject(item.toString()).put("name",draft.optString("item.$i.name",item.optString("name"))).put("amount",amount(draft.optString("item.$i.amount",item.optString("amount","0")))).put("status",draft.optString("item.$i.status",item.optString("status","active"))))}
            if(draft.optBoolean("mgmtEdited")||rows(items).withIndex().any{(i,item)->draft.optString("item.$i.name")!=item.optString("name",item.optString("key"))||draft.optString("item.$i.amount")!=item.optString("amount","0")||draft.optString("item.$i.status")!=item.optString("status","active")}){patch.put("mgmtItems",edited);val total=rows(edited).filter{it.optString("status","active")=="active"}.sumOf{it.optLong("amount")};patch.put("mgmt",total)}
            require(patch.length()>0){"변경된 계약 조건이 없습니다."};require(draft.optString("reason").isNotBlank()){ "변경 사유를 입력해주세요." }
            val changes=patch.keys().asSequence().joinToString("\n"){key->if(key=="mgmtItems")"관리비 세부 항목 변경"else"${termLabels[key]?:key}: ${terms.opt(key)?:"미등록"} → ${patch.opt(key)}"}
            confirm("계약 변경 확인",changes+"\n적용일 ${draft.optString("effectiveOn")}\n사유 ${draft.optString("reason")}"){write(JSONObject().put("action","contract").put("tenantId",tenantId).put("terms",patch).put("effectiveOn",draft.optString("effectiveOn")).put("reason",draft.optString("reason")).put("renew",draft.optBoolean("renewal")))}
        }catch(e:Exception){toast(e.message?:"입력값을 확인해주세요.")}},20)
        add(text("계약 변경 이력",18f,blue),26);rows(t.optJSONArray("contractChanges")).forEach{record->add(text(record.optString("effectiveOn")+" · "+record.optString("reason")));val before=record.optJSONObject("before")?:JSONObject();val after=record.optJSONObject("after")?:JSONObject();termLabels.keys.filter{before.opt(it)?.toString()!=after.opt(it)?.toString()}.forEach{key->add(text("${termLabels[key]}: ${before.opt(key)?:"미등록"} → ${after.opt(key)?:"미등록"}",12f,muted))}}
    }
    private fun clearItemFields(){draft.keys().asSequence().filter{it.startsWith("item.")}.toList().forEach{draft.remove(it)}}
    private fun won(n:Long)=java.text.NumberFormat.getNumberInstance(java.util.Locale.KOREA).format(n)+"원"
    private fun amount(s:String):Long{if(s.isBlank())return 0;val value=s.toLongOrNull();require(value!=null&&value>=0&&value<=1000000000000L){"0 이상 정수 금액을 입력해주세요."};return value}
    private fun settlement(){val saved=snapshot.optJSONObject("settlement")?.optJSONObject("inputs")?:JSONObject()
        add(text("전기는 공급가, 수도·오물비는 실제 총액입니다. 배분 합계가 일치해야 확정할 수 있습니다.",13f,muted),18)
        field("elec","전기 총 공급가 (원)",saved.optString("elec","0"),true);check("waterActive","이번 달 수도 청구",saved.optBoolean("waterActive"));field("waterTotal","수도 총액 (원)",saved.optString("waterTotal","0"),true);field("waterUsage","건물 전체 수도 사용량 (㎥)",saved.optString("waterUsage","0"),true,true);field("waterF1","1층 수도 사용량 (㎥)",saved.optString("waterF1","0"),true,true)
        add(button(if(draft.optBoolean("meters"))"층별 계량기 접기"else"층별 계량기 · 사용량 입력"){draft.put("meters",!draft.optBoolean("meters"));saveDraft();render()},16)
        if(draft.optBoolean("meters"))for(floor in 1..5){val row=saved.optJSONObject("waterFloors")?.optJSONObject("$floor")?:JSONObject();add(text("${floor}층 수도 계량",16f,blue),22);field("water.$floor.prevMeter","${floor}층 이전 계량기",row.optString("prevMeter",""),true,true);field("water.$floor.curMeter","${floor}층 현재 계량기",row.optString("curMeter",""),true,true);field("water.$floor.usage","${floor}층 직접 사용량 (계량기 입력 시 자동 계산)",row.optString("usage",""),true,true)}
        field("elev","승강기 총액 (원)",saved.optString("elev","0"),true);check("elevNet","승강기 입력액은 공급가",saved.optString("elevMode")=="net");field("waste","오물비 총액 (원)",saved.optString("waste","0"),true)
        val ratio=snapshot.optJSONObject("settlement")?.optJSONObject("waterRatio")?:JSONObject();add(text("수도 기본 비율 · 2층 ${ratio.optInt("r2",19)} : 3층 ${ratio.optInt("r3",10)} : 4층 ${ratio.optInt("r4",5)}",12f,muted),14)
        add(button("배분 미리보기",true){try{val request=settlementRequest();query(request){preview=it;draft.remove("adjustments");draft.keys().asSequence().filter{key->key.startsWith("adjust.")}.toList().forEach{key->draft.remove(key)};saveDraft();render()}}catch(e:Exception){toast(e.message?:"입력값을 확인해주세요.")}},18)
        val result=preview?:return;add(text("배분 검토 · 합계 "+if(result.optBoolean("balanced"))"일치"else"불일치",19f,blue),26)
        for((key,label) in listOf("elec" to "전기", "water" to "수도", "elev" to "승강기", "waste" to "오물비"))add(text("$label · 배분 ${won(result.optJSONObject("totals")?.optLong(key)?:0)} / 총액 ${won(result.optJSONObject("expected")?.optLong(key)?:0)}",13f,muted))
        rows(result.optJSONArray("ownerCandidates")).forEach{r->add(text("${r.optInt("floor")}층 공실 · 임대인 부담 후보 (미확정)\n전기 공급가 ${won(r.optLong("elec"))} · 수도 ${won(r.optLong("water"))} · 승강기 ${won(r.optLong("elev"))} · 오물비 ${won(r.optLong("waste"))}\n임차인 고지서·체납에 포함하지 않습니다.",13f,muted),16)}
        result.optJSONArray("reviewIssues")?.let{issues->for(i in 0 until issues.length())add(text("확정 차단 · "+issues.optString(i),13f,Color.rgb(135,82,26)))}
        for((key,label) in listOf("electricity" to "전기", "water" to "수도")){val period=result.optJSONObject("usagePeriods")?.optJSONObject(key);if(period!=null&&!period.optBoolean("inactive"))add(text("$label 사용기간 ${period.optString("start")} ~ ${period.optString("end")}",12f,muted))}
        rows(result.optJSONArray("rows")).forEachIndexed{i,r->add(text(r.optString("unit",r.optString("floor")+"층")+" · "+r.optString("name"),16f),20);add(text("전기 ${r.opt("elec")}원 · 승강기 청구 기준 ${r.opt("elev")}",13f,muted));for(key in listOf("water","elev","waste")){if(!r.isNull(key))field("adjust.$i.$key",when(key){"water"->"수도 배분 (원)";"elev"->"승강기 배분 (원)";else->"오물비 배분 (원)"},r.optString(key,"0"),true)}}
        add(button("수정한 배분 다시 검토"){try{val request=settlementRequest();val adjustments=JSONArray();rows(result.getJSONArray("rows")).forEachIndexed{i,r->val adjusted=JSONObject().put("id",r.getString("id"));for(key in listOf("water","elev","waste"))adjusted.put(key,if(r.isNull(key))JSONObject.NULL else amount(draft.optString("adjust.$i.$key",r.optString(key,"0"))));adjustments.put(adjusted)};request.put("adjustments",adjustments);query(request){preview=it;draft.put("adjustments",adjustments);saveDraft();render()}}catch(e:Exception){toast(e.message?:"배분 금액을 확인해주세요.")}},16)
        add(button("정산 확정",true){val current=preview;if(current==null||!current.optBoolean("canConfirm")){toast("수정한 배분을 다시 검토하고 합계를 확인해주세요.");return@button};confirm("정산 확정",if(current.optBoolean("previouslyConfirmed"))"이미 확정된 월의 배분을 변경합니다. 변경 항목의 납부 상태를 재확인하며 기존 자료는 복원 지점에 보관됩니다."else"검토한 비용을 $month 고지서에 저장합니다. 입금 원장이 시작된 고지서는 재정산할 수 없습니다."){write(settlementRequest().put("action","settlementConfirm").put("adjustments",draft.optJSONArray("adjustments")?:JSONObject.NULL).put("previewHash",current.getString("previewHash")))}}.apply{isEnabled=!busy&&result.optBoolean("canConfirm")},16)
    }
    private fun settlementRequest():JSONObject{val inputs=JSONObject();for(key in listOf("elec","waterTotal","elev","waste"))inputs.put(key,amount(draft.optString(key)));for(key in listOf("waterUsage","waterF1")){val n=draft.optString(key,"0").ifBlank{"0"}.toDoubleOrNull();require(n!=null&&n>=0&&n.isFinite()){ "수도 사용량을 확인해주세요." };inputs.put(key,n)};inputs.put("waterActive",draft.optBoolean("waterActive")).put("elevMode",if(draft.optBoolean("elevNet"))"net"else"gross");val floors=JSONObject();for(floor in 1..5){val row=JSONObject();for(key in listOf("prevMeter","curMeter","usage"))row.put(key,draft.optString("water.$floor.$key",snapshot.optJSONObject("settlement")?.optJSONObject("inputs")?.optJSONObject("waterFloors")?.optJSONObject("$floor")?.optString(key)?:""));floors.put("$floor",row)};return JSONObject().put("action","settlementPreview").put("inputs",inputs.put("waterFloors",floors))}
    private fun output(){chooseTenant{render()};add(text("PDF를 앱 안에서 미리보고 파일로 저장하거나 Android 인쇄 서비스로 전달합니다.",13f,muted),18)
        fun report(type:String,id:String?=null){val request=JSONObject().put("action","report").put("reportType",type);if(id!=null)request.put("tenantId",id);if(type=="quarter"){request.put("year",month.take(4).toInt()).put("quarter",(month.takeLast(2).toInt()-1)/3+1)}
            if(demo){makePdf(demoReport(id));return};query(request){makePdf(it)}}
        add(button("이번 달 전체 고지서 PDF",true){report("bill")},20);add(button("선택 세입자 고지서 PDF"){if(tenantId.isBlank())toast("세입자를 선택해주세요.")else report("bill",tenantId)})
        add(button("이번 달 정산표 PDF"){report("settlement")});add(button("조회 월이 속한 분기 집계 PDF"){report("quarter")})
        if(tenantId.isNotBlank()&&bill()!=null)add(button(if(bill()!!.optBoolean("issued"))"세금계산서 발급 확인됨"else"세금계산서 발급 완료 확인"){confirm("외부 세금계산서 발급 확인", "외부 전자세금계산서의 실제 발급 완료를 확인했을 때만 저장해주세요. 고지서 PDF 저장·인쇄·전달과는 별개입니다."){write(JSONObject().put("action","invoiceIssue").put("tenantId",tenantId).put("taxInvoiceVerified",true))}}.apply{isEnabled=!busy&&!bill()!!.optBoolean("issued")},18)
    }
    private fun demoReport(id:String?)=JSONObject().put("title","$month 예시 고지서").put("generatedAt","예시 자료 · 실제 청구에 사용하지 마세요").put("lines",JSONArray().apply{rows(snapshot.optJSONArray("bills")).filter{id==null||it.optString("tenantId")==id}.forEachIndexed{i,b->if(i>0)put(JSONObject().put("kind","page").put("text",""));put(JSONObject().put("kind","heading").put("text",b.optString("unit")+" · "+b.optString("name")));put(JSONObject().put("text","청구 ${b.optLong("total")}원 · 수납 ${b.optLong("received")}원 · 미수납 ${b.optLong("unpaid")}원"));rows(snapshot.optJSONArray("tenants")).firstOrNull{it.optString("id")==b.optString("tenantId")}?.let{put(JSONObject().put("text","계약 기간 "+it.optString("contract")))}}})
    private fun makePdf(report:JSONObject){task("PDF를 만들고 있어요.",{NativeDocuments.createPdf(this,report);JSONObject()}){startActivity(Intent(this,PdfPreviewActivity::class.java))}}
    private fun ledger(){chooseTenant{render()};val b=bill()?:run{add(text("저장된 고지서가 있는 세입자를 선택해주세요."));return};add(text("${b.optString("unit")} · 청구 ${b.optLong("total")}원",14f),18)
        for((key,label) in listOf("pay_rent" to "월세","pay_mgmt" to "관리비","pay_elec" to "전기","pay_water" to "수도","pay_elev" to "승강기","pay_waste" to "오물비")){val item=b.optJSONObject("items")?.optJSONObject(key);if(item!=null)add(text("$label · 청구 ${won(item.optLong("amount"))} / 수납 ${won(item.optLong("received"))}",13f))}
        if(b.optBoolean("ledger")){receiptCorrection(b);return}
        add(text("원장 개시 후에는 완납 날짜 방식 대신 입금·정정 기록으로 관리합니다. 과거 추정 항목은 직접 확인해주세요: ${b.optJSONArray("estimatedFields")?:JSONArray()}",13f,muted),18);check("reviewEstimated","청구 기준과 과거 추정 상태를 검토했습니다")
        add(button(if(b.optBoolean("ledger"))"입금 원장 이미 시작됨"else"입금 원장 시작",true){if(!draft.optBoolean("reviewEstimated")){toast("청구 기준을 검토하고 확인해주세요.");return@button};confirm("입금 원장 시작","기존 수납 기록과 청구액을 보존하여 항목별 입금 원장을 시작합니다."){write(JSONObject().put("action","ledgerOpen").put("tenantId",tenantId).put("reviewEstimated",true))}}.apply{isEnabled=!busy&&!b.optBoolean("ledger")},18)
    }
    private fun receiptCorrection(b:JSONObject){
        if(snapshot.optJSONObject("capabilities")?.optBoolean("receiptVoid")!=true){add(text("이 서버에는 앱 내부 입금 정정이 아직 배포되지 않았습니다. 기존 원장은 유지됩니다. 운영 서버 업데이트 후 새로고침해주세요.",13f,muted),18);return}
        val references=rows(b.optJSONArray("receiptReferences"))
        add(text("입금 원문은 남겨 두고 사유 있는 취소 기록을 추가합니다. 실제 환급을 뜻하지 않습니다.",13f,muted),18)
        references.asReversed().forEach{r->add(text("${r.optString("receivedOn").ifBlank{"날짜 없는 과거 확인"}} · ${receiptItemLabel(r.optString("item"))} · ${won(r.optLong("amount"))}\n${r.optString("note")} · "+if(r.optBoolean("cancelled"))"정정됨"else"원본 입금",13f),12)}
        val available=references.filter{!it.optBoolean("cancelled")};if(available.isEmpty()){add(text("정정할 입금 기록이 없습니다.",13f,muted));return}
        choice("voidReference","정정할 원본 입금",available.map{it.optString("id") to "${it.optString("receivedOn").ifBlank{"과거 확인"}} · ${receiptItemLabel(it.optString("item"))} ${won(it.optLong("amount"))}"},available.first().getString("id"))
        field("voidReason","정정 사유 (필수)")
        add(button("정정 후 잔액 검토",true){try{draft.put("voidRequestId",UUID.randomUUID().toString());val command=voidRequest();query(command.put("action","receiptVoidPreview")){preview=it;saveDraft();render()}}catch(e:Exception){toast(e.message?:"정정 사유를 확인해주세요.")}},18)
        val reviewed=preview?:return;val original=reviewed.optJSONObject("target")?:return
        add(text("원본 입금 ${original.optString("receivedOn")} · ${won(original.optLong("amount"))}\n정정 전 수납 ${won(reviewed.getJSONObject("before").getLong("received"))} / 잔액 ${won(reviewed.getJSONObject("before").getLong("unpaid"))}\n정정 후 수납 ${won(reviewed.getJSONObject("after").getLong("received"))} / 잔액 ${won(reviewed.getJSONObject("after").getLong("unpaid"))}\n사유: ${draft.optString("voidReason")}",14f),20)
        add(button("원본 보존하고 정정 기록 저장",true){val current=preview;if(current==null||current.optString("revision")!=snapshot.optString("revision")){toast("최신 원본과 잔액을 다시 검토해주세요.");return@button};confirm("입금 기록 정정 확인","위 원본 입금을 보존하고 사유 있는 취소 기록을 한 번 추가합니다. 실제 환급 처리는 하지 않습니다."){write(voidRequest().put("action","receiptVoid").put("previewHash",current.getString("previewHash")))}}.apply{isEnabled=!busy&&online},18)
    }
    private fun receiptItemLabel(key:String)=mapOf("pay_rent" to "월세","pay_mgmt" to "관리비","pay_elec" to "전기","pay_water" to "수도","pay_elev" to "승강기","pay_waste" to "오물비")[key]?:key
    private fun voidRequest():JSONObject{
        val reason=draft.optString("voidReason").trim();require(reason.isNotBlank()&&reason.length<=1000){"정정 사유를 1~1000자로 입력해주세요."}
        if(!draft.has("voidRequestId"))draft.put("voidRequestId",UUID.randomUUID().toString());saveDraft()
        return JSONObject().put("tenantId",tenantId).put("reference",draft.getString("voidReference")).put("reason",reason).put("requestId",draft.getString("voidRequestId"))
    }
    private fun backup(){add(text("백업은 기존 웹과 호환되는 JSON 파일입니다. 파일에는 임대 자료가 포함되므로 보관할 위치를 직접 선택해주세요.",13f,muted),18)
        add(button("JSON 백업 파일 저장",true){if(demo){toast("예시 화면에는 운영 백업이 없습니다.");return@button};query(JSONObject().put("action","backup")){result->store.update{it.put("operationExport",result.getJSONObject("backup"))};startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/json").putExtra(Intent.EXTRA_TITLE,"NEW-RENT-STORE-backup-${snapshot.optString("today")}.json"),101)}},20)
        add(button("JSON 백업 불러와 검토"){startActivityForResult(Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*").putExtra(Intent.EXTRA_MIME_TYPES,arrayOf("application/json","text/plain","application/octet-stream")),102)},12)
        val result=preview?:return;add(text("복원 전 검토",20f,blue),24);val current=result.optJSONObject("current")?:JSONObject();val restored=result.optJSONObject("restored")?:JSONObject();add(text("현재 세입자 ${current.optInt("tenants")}명 · ${current.optInt("months")}개월\n복원 세입자 ${restored.optInt("tenants")}명 · 고지서 ${restored.optInt("bills")}건 · 계약 변경 이력 ${restored.optInt("contractRecords")}건\n파일 무결성: "+if(result.optBoolean("integrityVerified"))"확인됨"else"과거 호환 백업 · 검증 값 없음",14f))
        add(text("서버 전체 자료를 교체합니다. 기존 입금·계약 이력을 삭제하거나 바꾸는 백업은 차단됩니다. 저장 전 현재 자료를 서버 복원 지점에 보관합니다.",13f,muted),18)
        add(button("검토한 백업으로 복원",true){confirm("전체 자료 복원 확인","위에서 검토한 백업으로 현재 자료를 교체합니다. 이 기기의 최신 자료와 비교하여 충돌 시 저장하지 않습니다."){val candidate=store.read().optJSONObject("operationImport")?:return@confirm;write(JSONObject().put("action","restore").put("backup",candidate).put("previewHash",result.optString("previewHash")))}})
    }
    @Deprecated("Activity result compatibility") override fun onActivityResult(request:Int,result:Int,data:Intent?){super.onActivityResult(request,result,data);if(result!=RESULT_OK)return;if(busy){deferredResult=Triple(request,result,data);return}
        val uri=data?.data?:return
        if(request==101)task("백업 파일을 저장하고 있어요.",{val payload=store.read().getJSONObject("operationExport").toString().toByteArray(Charsets.UTF_8);require(payload.size<=NativeDocuments.MAX_BACKUP_BYTES){"백업 파일이 앱 복원 한도인 1.5MB를 초과합니다. 기존 웹에서 백업해주세요."};contentResolver.openOutputStream(uri,"wt")!!.use{it.write(payload)};store.update{it.remove("operationExport")};JSONObject()}){notice="백업 파일을 저장했습니다.";render()}
        if(request==102)task("백업 파일을 검토하고 있어요.",{val parsed=contentResolver.openInputStream(uri)!!.use{NativeDocuments.readBackup(it)};require(!demo&&online){"예시·오프라인에서는 복원 검토와 저장을 할 수 없습니다."};store.update{it.put("operationImport",parsed)};request(JSONObject().put("action","restorePreview").put("backup",parsed))}){preview=it;saveDraft();notice="아직 저장하지 않았습니다. 복원 내용을 확인해주세요.";render()}
    }
    private fun confirm(title:String,message:String,yes:()->Unit){if(demo){toast("예시 자료는 실제로 저장하지 않습니다.");return};AlertDialog.Builder(this).setTitle(title).setMessage(message).setNegativeButton("돌아가기",null).setPositiveButton("확인하고 저장"){_,_->yes()}.show()}
    private fun refresh(force:Boolean=true){if(demo){notice="예시 자료입니다. 실제 저장과 서버 계산은 연결 후 사용할 수 있어요.";render();return};val state=try{store.read()}catch(_:Exception){NativeSnapshots.reader.invalidate();online=false;notice="기기 보관 자료를 읽지 못했습니다. 홈에서 연결을 확인해주세요.";render();return};if(!force&&NativeSnapshots.reader.fresh(state,month)){online=true;notice="";render();return};online=false;task("최신 자료를 확인하고 있어요.",{val state=store.read();val token=state.optString("token");require(token.isNotEmpty()){ "홈에서 Google 기기를 연결해주세요." };val result=NativeSnapshots.reader.load(state,month,force);ensureOk(result);require(result.optString("revision").matches(Regex("sha256-[a-f0-9]{64}"))){"서버 자료를 확인해주세요."};store.update{it.put("snapshot",result).put("pending",false)};result}){snapshot=it;online=true;preview=null;saveDraft();notice="";render()}}
    private fun request(req:JSONObject):JSONObject{require(online&&!demo){"최신 자료를 새로고침한 뒤 처리해주세요."};val token=store.read().getString("token");req.put("token",token).put("month",month).put("expectedRevision",snapshot.getString("revision"));val result=NativeOperationsTransport.request(req);ensureOk(result);return result}
    private fun query(req:JSONObject,done:(JSONObject)->Unit){if(demo){toast("예시 자료는 서버 계산·저장을 실행하지 않습니다.");return};task("검토 자료를 불러오고 있어요.",{request(req)},done)}
    private fun write(req:JSONObject){if(!online||demo){toast("최신 자료를 새로고침한 뒤 저장해주세요.");return};if(!req.has("requestId"))req.put("requestId",UUID.randomUUID().toString());req.put("confirm",true).put("includeSnapshot",true)
        task("저장 결과를 확인하고 있어요. 요청을 자동으로 다시 보내지 않습니다.",{require(!store.read().optBoolean("pending")){ "이전 저장 결과를 새로고침으로 확인해주세요." };NativeSnapshots.reader.invalidate();store.update{it.put("pending",true)};val result=request(req);val latest=NativeSnapshots.reader.afterSave(result,store.read(),month);ensureOk(latest);NativeSnapshots.reader.validate(latest,month);store.update{it.put("snapshot",latest).put("pending",false);if(req.optString("action")=="restore")it.remove("operationImport")};NativeSnapshots.reader.remember(store.read().getString("token"),latest);JSONObject().put("latest",latest).put("result",result)}){snapshot=it.getJSONObject("latest");online=true;clearDraft();val external=it.getJSONObject("result").optJSONObject("docs");notice=if(external?.optString("status")=="error")"자료 저장은 완료됐습니다. 현재현황 문서는 설정에서 다시 생성해주세요."else"저장하고 최신 자료를 확인했습니다.";render()}}
    private fun ensureOk(result:JSONObject){if(result.optString("status")=="unauthorized"){NativeSnapshots.reader.invalidate();store.clear();throw IllegalStateException("기기 연결이 만료됐습니다. 홈에서 다시 연결해주세요.")};require(result.optString("status")=="ok"){result.optString("message","처리 결과를 확인하지 못했습니다. 새로고침해주세요.")}}
    private fun updateTaskStatus(){if(!::taskStatus.isInitialized)return;taskStatus.removeAllViews();if(notice.isNotBlank())taskStatus.addView(text(notice,14f,Color.rgb(135,82,26)));if(busy)taskStatus.addView(ProgressBar(this))}
    private fun task(message:String,work:()->JSONObject,done:(JSONObject)->Unit){if(busy)return;busy=true;notice=message;updateTaskStatus();window.decorView.findViewById<View>(android.R.id.content)?.let{setEnabled(it,false)};if(::backButton.isInitialized)backButton.isEnabled=true;executor.execute{try{val result=work();runOnUiThread{if(!isDestroyed){busy=false;setEnabled(window.decorView,true);try{done(result)}catch(_:Exception){online=false;notice="응답을 확인하지 못했습니다. 새로고침해주세요.";render()};drainResult()}}}catch(e:Exception){NativeSnapshots.reader.invalidate();runOnUiThread{if(!isDestroyed){busy=false;online=false;notice=e.message?:"연결을 확인하고 새로고침해주세요.";render();drainResult()}}}}}
    private fun drainResult(){if(busy)return;val pending=deferredResult?:return;deferredResult=null;onActivityResult(pending.first,pending.second,pending.third)}
    private fun setEnabled(view:View,value:Boolean){view.isEnabled=value;if(view is android.view.ViewGroup)for(i in 0 until view.childCount)setEnabled(view.getChildAt(i),value)}
    private fun toast(message:String){Toast.makeText(this,message,Toast.LENGTH_LONG).show()}
}
