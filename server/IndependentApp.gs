/* Called through google.script.run inside the owner-only web app. */
function getAppUpdateInfo() {
  // Release metadata only: do not open the spreadsheet, document or calendar.
  return {appVersion:'2.3.0',androidVersion:'3.0.0',androidVersionCode:3,
    androidReleaseUrl:'https://github.com/ldjkorea/NEW-RENT-STORE/releases/latest'};
}

function independentRequest(request) {
  if (!request || ['GET','POST'].indexOf(request.method) < 0) throw new Error('지원하지 않는 요청입니다.');
  var output = request.method === 'POST'
    ? doPost({postData:{contents:String(request.body || '')}})
    : doGet({parameter:{api:'1',receiptLedgerProtocol:request.receiptLedgerProtocol,operationsHistoryProtocol:request.operationsHistoryProtocol}});
  // Apps Script's object transport can omit null properties in nested objects.
  // Keep the complete JSON, including historical audit values, as a string.
  return output.getContent();
}

/* Run once in this copied project's editor to grant Google permissions. */
function initializeIndependentApp() {
  return locked_(function() {
    var target=source_(), state=read_(target.sheet);
    var props=PropertiesService.getScriptProperties();
    var document=statusDocument_(props);
    var calendar=contractCalendarTarget_();
    return {status:'ok',spreadsheetId:target.book.getId(),documentId:document.getId(),
      calendarId:calendar.getId(),revision:state.revision,tenants:state.data.tenants.length};
  });
}

/* Native Android access is issued by this owner-only web app. No API secrets
 * are embedded in the APK or URLs. The JSON gateway cannot serve HTML. */
function nativeSecret_() { return (Utilities.getUuid()+Utilities.getUuid()).replace(/-/g,''); }
function nativeToday_() { return Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd'); }
function nativeDevices_() {
  return JSON.parse(PropertiesService.getScriptProperties().getProperty('NATIVE_DEVICES_V1') || '{}');
}
function createNativePairing(challenge) {
  if (typeof challenge !== 'string' || !/^[a-f0-9]{64}$/.test(challenge)) throw new Error('앱에서 다시 연결을 시작해주세요.');
  var result=locked_(function() {
    var code=nativeSecret_();
    PropertiesService.getScriptProperties().setProperty('NATIVE_PAIR_V1',JSON.stringify({hash:hash_(code),challenge:challenge,expires:Date.now()+300000}));
    return {status:'ok',code:code,expiresIn:300};
  });
  return JSON.parse(result.getContent());
}
function revokeNativeDevices() {
  var result=locked_(function() {
    var props=PropertiesService.getScriptProperties();
    props.deleteProperty('NATIVE_DEVICES_V1');props.deleteProperty('NATIVE_PAIR_V1');
    return {status:'ok'};
  });
  return JSON.parse(result.getContent());
}
function nativePairPage_(challenge) {
  if (!/^[a-f0-9]{64}$/.test(String(challenge))) throw new Error('앱에서 연결을 다시 시작해주세요.');
  var page='<!DOCTYPE html><html lang="ko"><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>NEW RENT STORE · 기기 연결</title><style>body{font-family:system-ui,sans-serif;background:#f5f7fb;color:#17233b;margin:0;padding:28px}main{max-width:440px;margin:8vh auto;background:#fff;padding:28px;border-radius:24px}small{color:#536482}h1{font-size:26px}p{line-height:1.7}button,a{display:block;box-sizing:border-box;width:100%;background:#3268c8;color:white;border:0;border-radius:14px;padding:16px;text-align:center;text-decoration:none;font-size:16px;margin:12px 0}textarea{box-sizing:border-box;width:100%;min-height:86px;border:1px solid #cbd5e1;border-radius:12px;padding:12px;word-break:break-all}#return{display:none}</style></head><body><main><small>NEW RENT STORE</small><h1>내 Android 앱 연결</h1><p>앱에서 시작한 연결을 승인합니다. 임대 자료는 기존 시트에 그대로 유지됩니다. 아래 코드는 5분 동안 한 번만 사용할 수 있습니다.</p><button id="approve" onclick="pair()">이 기기 연결 승인</button><p id="status" role="status"></p><textarea id="code" readonly hidden aria-label="연결 코드"></textarea><a id="return" target="_top">Android 앱으로 돌아가기</a><p id="hint" hidden>앱으로 돌아가지 않으면 코드를 복사한 뒤 앱의 ‘연결 코드 입력’에 붙여넣어주세요.</p><button onclick="revoke()" style="background:#edf2fa;color:#334765">연결된 모든 기기 해제</button></main><script>function pair(){document.getElementById("approve").disabled=true;google.script.run.withSuccessHandler(function(r){if(r.status!=="ok"){fail();return;}document.getElementById("status").textContent="승인했습니다. 아래 버튼으로 앱에 돌아가세요.";var c=document.getElementById("code");c.hidden=false;c.value=r.code;document.getElementById("hint").hidden=false;var a=document.getElementById("return");a.style.display="block";a.href="intent://pair?code="+encodeURIComponent(r.code)+"#Intent;scheme=rentstore;package=kr.henry.rental.independent;end";}).withFailureHandler(fail).createNativePairing("'+challenge+'");}function fail(){document.getElementById("status").textContent="연결하지 못했습니다. 앱에서 다시 시작해주세요.";document.getElementById("approve").disabled=false;}function revoke(){if(!confirm("연결된 모든 Android 기기를 해제할까요?"))return;google.script.run.withSuccessHandler(function(){document.getElementById("status").textContent="모든 기기를 해제했습니다.";}).withFailureHandler(fail).revokeNativeDevices();}</script></body></html>';
  return HtmlService.createHtmlOutput(page).setTitle('NEW RENT STORE · 기기 연결');
}
function nativeAuthorize_(req) {
  return JSON.parse(locked_(function() {
    if (!req || typeof req.token !== 'string' || !/^[a-f0-9]{64}$/.test(req.token)) return {status:'unauthorized',message:'먼저 내 Google 계정으로 기기를 연결해주세요.'};
    var devices=nativeDevices_(),key=hash_(req.token),device=devices[key];
    if (!device || device.expires<Date.now()) return {status:'unauthorized',message:'기기 연결이 만료되거나 해제되었습니다. 다시 연결해주세요.'};
    if(req.action==='disconnect') {
      delete devices[key];PropertiesService.getScriptProperties().setProperty('NATIVE_DEVICES_V1',JSON.stringify(devices));
    }
    return {status:'ok'};
  }).getContent());
}
/** Authenticated JSON API for the Android gateway. All data operations reuse
 * the owner project's lock, revision, recovery and conditional-write code. */
function nativeAppRequest(raw) {
  try {
    if (typeof raw!=='string'||raw.length>20000) throw new Error('요청 크기를 확인해주세요.');
    var req=JSON.parse(raw);
    if(req.action==='pair') return locked_(function() {
      var props=PropertiesService.getScriptProperties(),pair=JSON.parse(props.getProperty('NATIVE_PAIR_V1')||'null');
      if(!pair||pair.expires<Date.now()||typeof req.code!=='string'||typeof req.verifier!=='string'||!/^[a-f0-9]{64}$/.test(req.code)||!/^[a-f0-9]{64}$/.test(req.verifier)||hash_(req.code)!==pair.hash||hash_(req.verifier)!==pair.challenge)
        return {status:'unauthorized',message:'앱에서 연결을 시작한 뒤 새 코드를 사용해주세요. 코드는 5분 뒤 만료됩니다.'};
      var token=nativeSecret_(),devices=nativeDevices_();
      Object.keys(devices).forEach(function(key){if(devices[key].expires<Date.now())delete devices[key];});
      if(Object.keys(devices).length>=8)throw new Error('연결된 기기가 많습니다. 웹에서 모든 기기를 해제한 뒤 다시 연결해주세요.');
      devices[hash_(token)]={created:new Date().toISOString(),expires:Date.now()+180*86400000};
      props.setProperty('NATIVE_DEVICES_V1',JSON.stringify(devices));props.deleteProperty('NATIVE_PAIR_V1');
      return {status:'ok',token:token};
    }).getContent();
    var auth=nativeAuthorize_(req);if(auth.status!=='ok')return JSON.stringify(auth);
    if(req.action==='disconnect')return JSON.stringify({status:'ok'});
    var actions=['read','payment','receipt','expense','regenerateCurrentStatus','syncContractCalendar'];
    if(actions.indexOf(req.action)<0)return JSON.stringify({status:'unsupported',message:'지원하지 않는 작업입니다.'});
    var month=req.month||nativeToday_().slice(0,7);
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new Error('조회 월을 확인해주세요.');
    if(req.action==='read')return locked_(function(){return nativeView_(read_(source_().sheet),month);}).getContent();
    // Serialize the prepared command before invoking the existing transaction.
    // A concurrent web save is caught by doPost's expectedRevision comparison.
    var preparation=JSON.parse(locked_(function(){
      var state=read_(source_().sheet);
      if(req.expectedRevision!==state.revision)return {status:'conflict',message:'웹 또는 다른 기기에서 변경했습니다. 새로고침한 뒤 다시 저장해주세요.'};
      if(typeof req.requestId!=='string'||!/^[a-zA-Z0-9_-]{16,100}$/.test(req.requestId))throw new Error('저장 요청 ID를 확인해주세요.');
      var command={protocol:'rental-sync-v2',expectedRevision:state.revision,requestId:req.requestId,receiptLedgerProtocol:RentalBilling.RECEIPT_FORMAT,operationsHistoryProtocol:RentalBilling.OPERATIONS_FORMAT};
      if(req.action==='regenerateCurrentStatus'||req.action==='syncContractCalendar'){command.action=req.action;return {status:'ok',command:command};}
      var data=JSON.parse(JSON.stringify(state.data));
      if(req.action==='expense'){
        var n=Number(req.amount),day=RentalBilling.dateISO(req.date),label=String(req.label||'').trim();
        if(!Number.isSafeInteger(n)||n<=0||n>1e12||!day||day>nativeToday_()||day.slice(0,7)!==month||!label||label.length>100)throw new Error('지출 이름·금액·날짜를 확인해주세요.');
        data.expenses=data.expenses||{};data.expenses[month]=data.expenses[month]||[];
        data.expenses[month].push({id:req.requestId,name:label,amount:n,date:day.replace(/-/g,'.'),memo:String(req.note||'').slice(0,1000)});
      }else{
        var bill=data.bills[month]&&data.bills[month][req.tenantId],tenant=data.tenants.filter(function(t){return t.id===req.tenantId;})[0];
        if(!bill||!Object.keys(bill).length)throw new Error('저장된 고지서만 처리할 수 있습니다.');
        if(!tenant)tenant={id:req.tenantId,name:bill.tenantSnapshot&&bill.tenantSnapshot.name||'',unit:bill.unitSnapshot||'',rent:0,mgmt:0,elevator:0};
        var date=RentalBilling.dateISO(req.date);if(!date||date>nativeToday_())throw new Error('실제 입금 날짜를 확인해주세요.');
        if(req.action==='receipt'){
          if(!bill.receiptLedger)throw new Error('입금 원장을 먼저 웹에서 검토·개시해주세요.');
          var now=new Date().toISOString();if(now<bill.receiptLedger.events.slice(-1)[0]?.recordedAt)throw new Error('기록 시각을 확인해주세요.');
          bill.receiptLedger=RentalBilling.appendReceiptEvent(bill.receiptLedger,{kind:'receipt',id:req.requestId,billId:month+':'+req.tenantId,recordedAt:now,item:req.item,amount:Number(req.amount),receivedOn:date,note:String(req.note||'').slice(0,1000)});
        }else{
          if(bill.receiptLedger)throw new Error('입금 원장 고지서는 항목별 입금 추가를 사용해주세요.');
          if(['rent','mgmt'].indexOf(req.group)<0||typeof req.remove!=='boolean')throw new Error('완납 항목을 확인해주세요.');
          RentalBilling.freezeBill(tenant,bill,month,true);
          var flag=req.group==='rent'?'stampedRent':'stampedMgmt',keys=RentalBilling.itemKeys.filter(function(k){return (k==='pay_rent')===(req.group==='rent');});
          bill[flag]=!req.remove;bill.paid=bill.paid||{};
          if(req.remove){delete bill[flag+'Date'];keys.forEach(function(k){if(bill.paid[k])delete bill.paid[k].date;});}
          else {bill[flag+'Date']=date.replace(/-/g,'.');keys.forEach(function(k){bill.paid[k]=Object.assign({},bill.paid[k],{date:date.replace(/-/g,'.')});});}
        }
        bill.audit=(bill.audit||[]).concat([{at:new Date().toISOString(),action:req.action==='receipt'?'입금 기록 추가':(req.group==='rent'?'월세':'관리비 전체(일괄)')+(req.remove?' 완납 취소':' 완납 날짜 저장'),detail:'Android · '+date}]).slice(-100);
      }
      command.data=data;return {status:'ok',command:command};
    }).getContent());
    if(preparation.status!=='ok')return JSON.stringify(preparation);
    var saved=JSON.parse(doPost({postData:{contents:JSON.stringify(preparation.command)}}).getContent());
    // No blind write retry: the Android client reloads after uncertain outcomes.
    return JSON.stringify(saved);
  }catch(err){return JSON.stringify({status:'error',message:String(err.message||err)});}
}
function nativeView_(state,month) {
  var data=state.data,today=nativeToday_(),months=Object.keys(data.bills).sort().reverse(),rows=[];
  var tenants=data.tenants.map(function(t){
    var collection=RentalBilling.collectionStatus(t,data.bills,today);
    return {id:t.id,name:t.name||'',biz:t.biz||'',unit:t.unit||'',phone:t.phone||t.tel||'',contract:t.contract||'',deposit:Number(t.deposit)||0,rent:Number(t.rent)||0,mgmt:Number(t.mgmt)||0,leaseStatus:t.leaseStatus||'임대중',archived:t.archived===true,collection:collection,deadline:RentalBilling.contractDeadline(t.contract,today),audit:(t.audit||[]).slice(-12).reverse()};
  });
  var total=0,received=0,unpaid=0;
  Object.keys(data.bills[month]||{}).forEach(function(id){
    var b=data.bills[month][id];if(!b||!Object.keys(b).length)return;
    var t=data.tenants.filter(function(t){return t.id===id;})[0]||{id:id,name:'미등록 임차인',unit:'',rent:0,mgmt:0,elevator:0},saved=RentalBilling.effectiveTenant(t,b);
    var p=RentalBilling.historicalPayment(t,b,Number(month.slice(0,4)),Number(month.slice(5)),today);
    rows.push({tenantId:id,name:saved.biz||saved.name||'',unit:saved.unit||'',total:p.total,received:p.received,unpaid:p.unpaid,overdue:p.overdue,groups:p.groups,items:p.items,ledger:!!b.receiptLedger,issued:b.invoiceIssued===true,audit:(b.audit||[]).slice(-10).reverse()});
    total+=p.total;received+=p.received;unpaid+=p.unpaid;
  });
  var arrears=RentalBilling.arrears(data.tenants,data.bills,today),expenses=data.expenses&&data.expenses[month]||[];
  return {status:'ok',revision:state.revision,protocol:'rental-native-v1',today:today,month:month,months:months,tenants:tenants,bills:rows,expenses:expenses,summary:{total:total,received:received,unpaid:unpaid,overdue:arrears.total,activeTenants:tenants.filter(function(t){return !t.archived;}).length,expense:expenses.reduce(function(s,e){return s+(Number(e.amount)||0);},0)},links:{document:currentStatusDocumentUrl_()},updates:getAppUpdateInfo()};
}
function currentStatusDocumentUrl_(){var id=PropertiesService.getScriptProperties().getProperty('RENTAL_STATUS_DOCUMENT_ID')||'';return id?'https://docs.google.com/document/d/'+encodeURIComponent(id)+'/edit':'';}
