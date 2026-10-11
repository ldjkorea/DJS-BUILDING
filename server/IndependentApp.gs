/* Called through google.script.run inside the owner-only web app. */
function getAppUpdateInfo() {
  // Release metadata only: do not open the spreadsheet, document or calendar.
  return {appVersion:'2.3.0',androidVersion:'4.1.0',androidVersionCode:5,
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
    if (typeof raw!=='string'||raw.length>2000000) throw new Error('요청 크기를 확인해주세요.');
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
    var actions=['read','payment','receipt','expense','regenerateCurrentStatus','syncContractCalendar','contract','settlementPreview','settlementConfirm','backup','restorePreview','restore','report','ledgerOpen','invoiceIssue'];
    if(actions.indexOf(req.action)<0)return JSON.stringify({status:'unsupported',message:'지원하지 않는 작업입니다.'});
    var month=req.month||nativeToday_().slice(0,7);
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new Error('조회 월을 확인해주세요.');
    if(req.action==='read')return locked_(function(){return nativeView_(read_(source_().sheet),month);}).getContent();
    if(['settlementPreview','backup','restorePreview','report'].indexOf(req.action)>=0)return locked_(function(){
      var state=read_(source_().sheet);
      if(req.expectedRevision!==state.revision)return {status:'conflict',message:'자료가 변경됐습니다. 새로고침 후 다시 확인해주세요.'};
      return nativeAdvancedRead_(req,state,month);
    }).getContent();
    // Serialize the prepared command before invoking the existing transaction.
    // A concurrent web save is caught by doPost's expectedRevision comparison.
    var preparation=JSON.parse(locked_(function(){
      var state=read_(source_().sheet);
      if(req.expectedRevision!==state.revision)return {status:'conflict',message:'웹 또는 다른 기기에서 변경했습니다. 새로고침한 뒤 다시 저장해주세요.'};
      if(typeof req.requestId!=='string'||!/^[a-zA-Z0-9_-]{16,100}$/.test(req.requestId))throw new Error('저장 요청 ID를 확인해주세요.');
      var command={protocol:'rental-sync-v2',expectedRevision:state.revision,requestId:req.requestId,receiptLedgerProtocol:RentalBilling.RECEIPT_FORMAT,operationsHistoryProtocol:RentalBilling.OPERATIONS_FORMAT};
      if(req.action==='regenerateCurrentStatus'||req.action==='syncContractCalendar'){command.action=req.action;return {status:'ok',command:command};}
      var data=JSON.parse(JSON.stringify(state.data));
      if(['contract','settlementConfirm','restore','ledgerOpen','invoiceIssue'].indexOf(req.action)>=0) {
        command.data=nativeAdvancedWrite_(req,state,month,data);return {status:'ok',command:command};
      }else if(req.action==='expense'){
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
          if(!bill.receiptLedger)throw new Error('고지서에서 청구 기준을 검토한 뒤 입금 원장을 시작해주세요.');
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
    return {id:t.id,name:t.name||'',biz:t.biz||'',unit:t.unit||'',phone:t.phone||t.tel||'',contract:t.contract||'',deposit:Number(t.deposit)||0,rent:Number(t.rent)||0,mgmt:Number(t.mgmt)||0,terms:RentalBilling.contractTerms(t),leaseStatus:t.leaseStatus||'임대중',archived:t.archived===true,collection:collection,deadline:RentalBilling.contractDeadline(t.contract,today),audit:(t.audit||[]).slice(-12).reverse(),contractChanges:(data.contractChanges||[]).filter(function(r){return r.tenantId===t.id;}).reverse()};
  });
  var total=0,received=0,unpaid=0;
  Object.keys(data.bills[month]||{}).forEach(function(id){
    var b=data.bills[month][id];if(!b||!Object.keys(b).length)return;
    var t=data.tenants.filter(function(t){return t.id===id;})[0]||{id:id,name:'미등록 임차인',unit:'',rent:0,mgmt:0,elevator:0},saved=RentalBilling.effectiveTenant(t,b);
    var p=RentalBilling.historicalPayment(t,b,Number(month.slice(0,4)),Number(month.slice(5)),today);
    rows.push({tenantId:id,name:saved.biz||saved.name||'',unit:saved.unit||'',total:p.total,received:p.received,unpaid:p.unpaid,overdue:p.overdue,groups:p.groups,items:p.items,ledger:!!b.receiptLedger,estimatedFields:b.snapshotEstimated||[],issued:b.invoiceIssued===true,audit:(b.audit||[]).slice(-10).reverse()});
    total+=p.total;received+=p.received;unpaid+=p.unpaid;
  });
  var arrears=RentalBilling.arrears(data.tenants,data.bills,today),expenses=data.expenses&&data.expenses[month]||[];
  return {status:'ok',revision:state.revision,protocol:'rental-native-v1',today:today,month:month,months:months,tenants:tenants,bills:rows,expenses:expenses,settlement:{inputs:data.settInputs&&data.settInputs[month]||{},waterRatio:data.waterRatio||{r2:1,r3:1,r4:1}},summary:{total:total,received:received,unpaid:unpaid,overdue:arrears.total,activeTenants:tenants.filter(function(t){return !t.archived;}).length,expense:expenses.reduce(function(s,e){return s+(Number(e.amount)||0);},0)},links:{document:currentStatusDocumentUrl_()},updates:getAppUpdateInfo()};
}
function currentStatusDocumentUrl_(){var id=PropertiesService.getScriptProperties().getProperty('RENTAL_STATUS_DOCUMENT_ID')||'';return id?'https://docs.google.com/document/d/'+encodeURIComponent(id)+'/edit':'';}

/* Native advanced work uses the same domain functions as the web app. */
function nativeCanonical_(value) {
  if(Array.isArray(value))return '['+value.map(nativeCanonical_).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(function(k){return JSON.stringify(k)+':'+nativeCanonical_(value[k]);}).join(',')+'}';
  return JSON.stringify(value);
}
function nativeAudit_(row,action,detail,changes) {
  row.audit=(row.audit||[]).concat([Object.assign({at:new Date().toISOString(),action:action,detail:detail},changes?{changes:changes}:{})]).slice(-100);
}
function nativeFreeze_(tenant,bill,month,legacy) {
  if(bill.receiptLedger){RentalBilling.validateReceiptBill(tenant,bill,month+':'+tenant.id);return;}
  RentalBilling.freezeBill(tenant,bill,month,legacy);
  if(bill.mgmtItems==null&&tenant.mgmtItems&&Number(bill.mgmt)===Number(tenant.mgmt))bill.mgmtItems=JSON.parse(JSON.stringify(tenant.mgmtItems));
}
function nativeUsagePeriod_(month,people,field,span,water,saved) {
  if(saved&&RentalBilling.dateISO(saved.start)===saved.start&&RentalBilling.dateISO(saved.end)===saved.end)return saved;
  var days=people.map(function(t){return Number(t[field]);});
  if(!days.length||days.some(function(d){return !Number.isInteger(d)||d<1||d>31;})||days.some(function(d){return d!==days[0];}))
    throw new Error('층별 '+(water?'수도 계량일':'전기 시작일')+'을 같은 1~31일로 설정해주세요.');
  var y=Number(month.slice(0,4)),m=Number(month.slice(5))-1-(water?1:0),day=days[0];
  var endMonth=new Date(y,m,1),startMonth=new Date(y,m-span,1);
  var clamp=function(date){return new Date(date.getFullYear(),date.getMonth(),Math.min(day,new Date(date.getFullYear(),date.getMonth()+1,0).getDate()));};
  var start=clamp(startMonth),end=clamp(endMonth);if(water)start.setDate(start.getDate()+1);else end.setDate(end.getDate()-1);
  var iso=function(d){return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);};
  return {start:iso(start),end:iso(end),day:day,span:span};
}
function nativeSettlement_(req,state,month) {
  var raw=req.inputs||{},inputs={elec:RentalBilling.won(raw.elec||0),waterTotal:raw.waterActive===true?RentalBilling.won(raw.waterTotal||0):0,waterUsage:Number(raw.waterUsage||0),waterF1:Number(raw.waterF1||0),waterFloors:{},waterActive:raw.waterActive===true,elev:RentalBilling.won(raw.elev||0),elevMode:raw.elevMode==='net'?'net':'gross',waste:RentalBilling.won(raw.waste||0)};
  for(var floor=1;floor<=5;floor++){
    var wf=raw.waterFloors&&raw.waterFloors[floor];if(!wf)continue;
    var row={};['prevMeter','curMeter','usage'].forEach(function(k){var v=wf[k];row[k]=v==null||v===''?'':Number(v);if(row[k]!==''&&(!isFinite(row[k])||row[k]<0||row[k]>1e12))throw new Error('수도 계량기와 사용량을 확인해주세요.');});
    if(row.prevMeter!==''&&row.curMeter!==''){
      if(row.curMeter<row.prevMeter)throw new Error('현재 수도 계량기는 이전 값보다 작을 수 없습니다.');
      row.usage=Math.round((row.curMeter-row.prevMeter)*1000)/1000;
    }
    inputs.waterFloors[floor]=row;
  }
  var people=state.data.tenants.filter(function(t){return !t.archived;}),ratio=state.data.waterRatio||{r2:1,r3:1,r4:1},result=RentalBilling.calculate(people,inputs,ratio);
  if(req.adjustments){
    if(!Array.isArray(req.adjustments)||req.adjustments.length!==result.rows.length)throw new Error('배분 행을 확인해주세요.');
    result.rows.forEach(function(row,i){var adjusted=req.adjustments[i];if(!adjusted||adjusted.id!==row.id)throw new Error('배분 대상이 변경됐습니다.');['water','elev','waste'].forEach(function(k){if(row[k]===null){if(adjusted[k]!=null)throw new Error('미청구 항목은 배분할 수 없습니다.');}else row[k]=RentalBilling.won(adjusted[k]);});});
  }
  var saved=state.data.settInputs&&state.data.settInputs[month]&&state.data.settInputs[month].usagePeriods||{};
  var periods={electricity:inputs.elec?nativeUsagePeriod_(month,people,'period_elec',1,false,saved.electricity):{inactive:true},water:inputs.waterActive?nativeUsagePeriod_(month,people,'period_water_day',2,true,saved.water):{inactive:true}};
  var check=RentalBilling.reconcile(result);
  return {status:'ok',month:month,revision:state.revision,inputs:inputs,usagePeriods:periods,rows:result.rows,expected:result.expected,totals:check.totals,balanced:check.balanced,previouslyConfirmed:!!(state.data.settInputs&&state.data.settInputs[month]&&state.data.settInputs[month].confirmed),previewHash:hash_(nativeCanonical_({revision:state.revision,month:month,inputs:inputs,periods:periods,rows:result.rows}))};
}
function nativeRestore_(backup,state) {
  if(!backup||typeof backup!=='object'||Array.isArray(backup))throw new Error('JSON 백업 파일을 확인해주세요.');
  var candidate=JSON.parse(JSON.stringify(backup)),integrity=candidate.localMeta&&candidate.localMeta.nativeBackup||candidate.nativeBackup;
  if(integrity&&integrity.format==='rental-native-backup-v1'){
    if(candidate.localMeta&&candidate.localMeta.nativeBackup)delete candidate.localMeta;else delete candidate.nativeBackup;
    if(integrity.sha256!==hash_(nativeCanonical_(candidate)))throw new Error('백업 무결성 검증에 실패했습니다. 원본 파일을 보관해주세요.');
  }
  if(candidate.recoveryRaw)throw new Error('손상 원문 복구 파일은 정상 JSON 백업으로 복원할 수 없습니다. 원문을 보관해주세요.');
  if(Object.keys(candidate.localDrafts||{}).length||Object.keys(candidate.localSettlementDrafts||{}).length)throw new Error('미확정 웹 초안이 포함돼 있습니다. 웹에서 초안을 확정하거나 보관한 뒤 확정 자료 백업을 사용해주세요.');
  candidate=RentalCore.validateData(candidate);validate_(candidate);
  RentalBilling.assertReceiptDataTransition(state.data,candidate);RentalBilling.assertOperationsTransition(state.data,candidate);
  return {data:candidate,hash:hash_(nativeCanonical_({revision:state.revision,data:candidate}))};
}
function nativeAdvancedRead_(req,state,month) {
  if(req.action==='settlementPreview')return nativeSettlement_(req,state,month);
  if(req.action==='backup'){
    var backup=Object.assign({schemaVersion:1,exportedAt:new Date().toISOString()},JSON.parse(JSON.stringify(state.data)));delete backup.nativeBackup;delete backup.localMeta;
    // localMeta is already recognized export metadata by the unchanged web validator.
    // Web import/export must never persist an old checksum as rental domain data.
    backup.localMeta={nativeBackup:{format:'rental-native-backup-v1',sha256:hash_(nativeCanonical_(backup))}};
    return {status:'ok',revision:state.revision,backup:backup};
  }
  if(req.action==='restorePreview'){
    var restored=nativeRestore_(req.backup,state),before=state.data,after=restored.data;
    var integrity=req.backup.localMeta&&req.backup.localMeta.nativeBackup||req.backup.nativeBackup;
    return {status:'ok',revision:state.revision,previewHash:restored.hash,current:{tenants:before.tenants.length,months:Object.keys(before.bills).length},restored:{tenants:after.tenants.length,months:Object.keys(after.bills).length,bills:Object.keys(after.bills).reduce(function(n,m){return n+Object.keys(after.bills[m]).length;},0),contractRecords:(after.contractChanges||[]).length},integrityVerified:!!(integrity&&integrity.format==='rental-native-backup-v1'),summary:{currentTenants:before.tenants.length,restoreTenants:after.tenants.length,currentMonths:Object.keys(before.bills).length,restoreMonths:Object.keys(after.bills).length,restoreBills:Object.keys(after.bills).reduce(function(n,m){return n+Object.keys(after.bills[m]).length;},0),contractRecords:(after.contractChanges||[]).length,hasIntegrity:!!(integrity&&integrity.format==='rental-native-backup-v1')}};
  }
  return nativeReport_(req,state,month);
}
function nativeAdvancedWrite_(req,state,month,data) {
  if(req.action==='restore'){
    var restored=nativeRestore_(req.backup,state);if(req.previewHash!==restored.hash||req.confirm!==true)throw new Error('복원 내용을 다시 검토하고 확정해주세요.');return restored.data;
  }
  if(req.action==='contract'){
    var tenant=data.tenants.filter(function(t){return t.id===req.tenantId;})[0];if(!tenant||tenant.archived)throw new Error('변경할 현재 세입자를 확인해주세요.');
    var allowed=['unit','contract','contract_first','deposit','rent','mgmt','mgmtItems','elevator','elecType','elecFixed','payday','paytype','renew','period_mgmt','period_rent','period_elec','period_elev','period_waste','period_water_day','period_water_odd'],next=JSON.parse(JSON.stringify(tenant)),patch=req.terms;
    if(!patch||Object.keys(patch).some(function(k){return allowed.indexOf(k)<0;}))throw new Error('계약 조건 필드를 확인해주세요.');
    Object.keys(patch).forEach(function(k){var v=patch[k];if(['deposit','rent','mgmt','elevator','elecFixed'].indexOf(k)>=0)next[k]=RentalBilling.won(v);else if(k==='mgmtItems')next[k]=JSON.parse(JSON.stringify(v));else {if(typeof v!=='string'||v.length>2000)throw new Error('계약 문자를 확인해주세요.');next[k]=v.trim();}});
    if(Object.prototype.hasOwnProperty.call(patch,'mgmtItems')){
      if(!Array.isArray(next.mgmtItems)||next.mgmtItems.some(function(item){return !item||['active','actual','na','inactive'].indexOf(item.status)<0;}))throw new Error('관리비 세부 항목 상태를 확인해주세요.');
      var fixedTotal=next.mgmtItems.reduce(function(sum,item){return sum+(item.status==='active'?RentalBilling.won(item.amount):0);},0);
      if(Number(next.mgmt)!==fixedTotal)throw new Error('고정 관리비와 운영중 세부 항목 합계가 다릅니다.');
    }else if(Object.prototype.hasOwnProperty.call(patch,'mgmt')&&next.mgmtItems&&next.mgmtItems.length&&Number(next.mgmt)!==Number(tenant.mgmt))throw new Error('관리비 세부 항목 금액과 상태를 함께 변경해주세요.');
    var dates=String(next.contract).split('~').map(function(s){return RentalBilling.dateISO(s.trim());});if(dates.length!==2||!dates[0]||!dates[1]||dates[0]>dates[1])throw new Error('계약 시작일과 종료일을 확인해주세요.');
    if(!next.unit||data.tenants.some(function(t){return !t.archived&&t.id!==tenant.id&&t.unit===next.unit;}))throw new Error('중복되지 않는 호실을 입력해주세요.');
    allowed.filter(function(k){return k.indexOf('period_')===0&&k!=='period_water_odd';}).forEach(function(k){if(next[k]&&(!Number.isInteger(Number(next[k]))||Number(next[k])<1||Number(next[k])>31))throw new Error('사용기간 기준일은 1~31일이어야 합니다.');});
    if(!req.reason||typeof req.reason!=='string'||req.reason.length>500)throw new Error('변경 사유를 입력해주세요.');
    var oldEnd=RentalBilling.contractEndDate(tenant.contract);if(req.renew===true&&(!oldEnd||dates[1]<=oldEnd))throw new Error('재계약 종료일은 기존 종료일 이후여야 합니다.');
    var record=RentalBilling.createContractChange(tenant,next,{id:req.requestId,effectiveOn:req.effectiveOn,recordedAt:new Date().toISOString(),reason:req.reason});if(!record)throw new Error('변경된 계약 조건이 없습니다.');
    Object.keys(data.bills).forEach(function(m){var bill=data.bills[m][tenant.id];if(bill&&Object.keys(bill).length)nativeFreeze_(tenant,bill,m,true);});
    var changes={};allowed.forEach(function(k){if(nativeCanonical_(tenant[k]===undefined?null:tenant[k])!==nativeCanonical_(next[k]===undefined?null:next[k]))changes[k]={from:tenant[k]===undefined?null:tenant[k],to:next[k]===undefined?null:next[k]};});
    Object.assign(tenant,next);nativeAudit_(tenant,req.renew===true?'재계약 완료':'계약 조건 변경',req.effectiveOn+' · '+req.reason,changes);
    data.contractChanges=(data.contractChanges||[]).concat([record]);if(req.renew===true){data.renewalDone=data.renewalDone||{};data.renewalDone[tenant.id]=oldEnd;}return data;
  }
  if(req.action==='settlementConfirm'){
    var preview=nativeSettlement_(req,state,month);if(!preview.balanced||req.previewHash!==preview.previewHash||req.confirm!==true)throw new Error('배분 합계와 최신 미리보기를 확인해주세요.');
    data.bills[month]=data.bills[month]||{};
    if(preview.rows.some(function(r){return data.bills[month][r.id]&&data.bills[month][r.id].receiptLedger;}))throw new Error('입금 원장이 개시된 고지서는 재정산할 수 없습니다.');
    preview.rows.forEach(function(row){var tenant=data.tenants.filter(function(t){return t.id===row.id;})[0],existing=data.bills[month][row.id],bill=existing||{};nativeFreeze_(tenant,bill,month,!!existing&&Object.keys(existing).length>0);var before=JSON.parse(JSON.stringify(bill));
      if(row.elec!==null){bill.electricity=row.elec;bill.electricityNA=false;if(bill.paid&&bill.paid.pay_elec)bill.paid.pay_elec.na=false;}
      if(row.water!==null){bill.water=row.water;bill.waterNA=false;if(bill.paid&&bill.paid.pay_water)bill.paid.pay_water.na=false;
        var wf=preview.inputs.waterFloors[row.floor];if(wf&&wf.curMeter!=='') {bill.waterMeter=wf.curMeter;bill.waterMeterDate=preview.usagePeriods.water.end.slice(5).replace('-','/');tenant.waterHistory=(tenant.waterHistory||[]).filter(function(w){return w.mk!==month;}).concat([{mk:month,date:bill.waterMeterDate,val:wf.curMeter}]).sort(function(a,b){return a.mk.localeCompare(b.mk);});}
      }else if(!preview.inputs.waterActive){bill.waterNA=true;if(bill.paid&&bill.paid.pay_water)bill.paid.pay_water.na=true;}
      if(row.elev!==null)bill.elevatorTotal=row.elev;bill.waste=row.waste;bill.wasteNA=row.waste===0;if(bill.paid&&bill.paid.pay_waste)bill.paid.pay_waste.na=bill.wasteNA;
      var changed=RentalBilling.invalidateChangedPayments(tenant,before,bill);if(changed.length)nativeAudit_(bill,'청구 변경 · 관련 납부 재확인',changed.join(', '));nativeAudit_(bill,'정산 확정',month+' 비용 배분 · Android');data.bills[month][row.id]=bill;
    });
    data.settInputs=data.settInputs||{};data.settInputs[month]=Object.assign({},preview.inputs,{usagePeriods:preview.usagePeriods,confirmed:true,confirmedAt:new Date().toISOString(),allocationMode:'exact-gross-v2'});return data;
  }
  var tenant=data.tenants.filter(function(t){return t.id===req.tenantId;})[0],bill=data.bills[month]&&data.bills[month][req.tenantId];if(!tenant||!bill||!Object.keys(bill).length)throw new Error('저장된 고지서를 확인해주세요.');
  nativeFreeze_(tenant,bill,month,true);
  if(req.action==='ledgerOpen'){
    if(req.confirm!==true||bill.receiptLedger)throw new Error('입금 원장 상태와 확인 항목을 검토해주세요.');
    bill.receiptLedger=RentalBilling.openReceiptLedger(tenant,bill,month+':'+tenant.id,new Date().toISOString(),{reviewEstimated:req.reviewEstimated===true});nativeAudit_(bill,'입금 원장 개시','청구 기준·과거 확인 상태 검토 · Android');
  }else if(req.action==='invoiceIssue'){if(req.confirm!==true)throw new Error('고지서 발행 표시를 확인해주세요.');bill.invoiceIssued=true;nativeAudit_(bill,'고지서 발행 표시',month+' · Android');}
  return data;
}
function nativeReport_(req,state,month) {
  if(['bill','quarter','settlement'].indexOf(req.reportType)<0)throw new Error('출력 종류를 확인해주세요.');
  var lines=[],money=function(n){return Number(n||0).toLocaleString('en-US')+'원';},line=function(text,kind){lines.push({text:String(text),kind:kind||'body'});},data=state.data,title='';
  if(req.reportType==='quarter'){
    var y=Number(req.year),q=Number(req.quarter),report=RentalBilling.quarterlyStatement(data.tenants,data.bills,y,q,nativeToday_());title=y+'년 '+q+'분기 고지서 집계';
    line('저장된 고지서 기준 · 발행 여부와 수납을 구분합니다.');
    report.rows.forEach(function(r){line(r.identity.unit+' · '+(r.identity.biz||r.identity.name),'heading');line('월 '+r.months.join(', '));['rentNet','mgmtNet','elecNet','taxableNet','vat','otherCharges','gross','received','unpaid'].forEach(function(k,i){line(['월세 공급가','관리비 공급가','전기 공급가','과세 공급가','부가세','기타 실비','청구 총액','수납','미수납'][i]+'  '+money(r[k]));});line('고지서 '+r.billCount+'건 · 발행 '+r.invoiceCount+'건');if(r.estimatedFields.length)line('확인 필요: '+r.estimatedFields.join(', '));});
    line('분기 합계','heading');['rentNet','mgmtNet','elecNet','taxableNet','vat','otherCharges','gross','received','unpaid'].forEach(function(k,i){line(['월세 공급가','관리비 공급가','전기 공급가','과세 공급가','부가세','기타 실비','청구 총액','수납','미수납'][i]+'  '+money(report.totals[k]));});
  }else if(req.reportType==='settlement'){
    title=month+' 공용비 정산';var saved=data.settInputs&&data.settInputs[month];if(!saved||!saved.confirmed)throw new Error('확정된 정산 자료가 없습니다.');line('확정일 '+saved.confirmedAt);['electricity','water'].forEach(function(k){var p=saved.usagePeriods&&saved.usagePeriods[k];if(p)line((k==='electricity'?'전기':'수도')+' 기간: '+(p.inactive?'미청구':p.start+' ~ '+p.end));});
    var view=nativeView_(state,month);view.bills.forEach(function(b){line(b.unit+' · '+b.name,'heading');['pay_elec','pay_water','pay_elev','pay_waste'].forEach(function(k,i){var item=b.items[k];line(['전기','수도','승강기','오물비'][i]+'  '+(item.na?'미청구':money(item.amount)));});});
  }else{
    title=month+' 임대 고지서';var view=nativeView_(state,month),rows=view.bills.filter(function(b){return !req.tenantId||b.tenantId===req.tenantId;});if(!rows.length)throw new Error('출력할 저장 고지서가 없습니다.');
    rows.forEach(function(b,index){if(index)line('','page');line(b.unit+' · '+b.name,'heading');line(b.issued?'발행 고지서':'미발행 자료 · 검토용');line('기준일 '+nativeToday_());
      RentalBilling.itemKeys.forEach(function(k,i){var item=b.items[k];line(['월세','관리비','전기','수도','승강기','오물비'][i]+'  '+(item.na?'청구 제외':money(item.amount))+' · 수납 '+money(item.received)+' · 잔액 '+money(item.unpaid));if(item.date)line('입금 확인 날짜 '+item.date);});
      line('청구 '+money(b.total)+' · 수납 '+money(b.received)+' · 미수납 '+money(b.unpaid),'heading');
      if(b.estimatedFields.length)line('과거 추정 기준 확인 필요: '+b.estimatedFields.join(', '));
      var raw=data.bills[month][b.tenantId],person=data.tenants.filter(function(t){return t.id===b.tenantId;})[0]||{},basis=RentalBilling.effectiveTenant(person,raw);if(basis.contract)line('계약 기간 '+basis.contract);if(basis.payday)line('납입일 '+basis.payday);var usage=data.settInputs&&data.settInputs[month]&&data.settInputs[month].usagePeriods;['electricity','water'].forEach(function(k){var p=usage&&usage[k];if(p&&!p.inactive)line((k==='electricity'?'전기':'수도')+' 사용기간 '+p.start+' ~ '+p.end);});var events=raw.receiptLedger&&raw.receiptLedger.events||[];if(events.length)line('입금·정정 원문 기록','heading');events.forEach(function(e){line(JSON.stringify(e));});(raw.audit||[]).forEach(function(a){line(a.at+' · '+a.action+' · '+a.detail);});
    });
  }
  return {status:'ok',revision:state.revision,title:title,landscape:req.reportType==='quarter',generatedAt:new Date().toISOString(),lines:lines};
}

/* SHARED_CORE_BEGIN */
/* Shared, dependency-free data validation and local persistence. */
(function (root) {
  'use strict';
  const STATE_KEY = 'rentalApp.state.v1';
  const BACKUP_KEY = 'rentalApp.recovery.v1';
  const LEASE_STATUSES = Object.freeze(['임대중','재계약예정','계약종료예정','명도소송중','강제집행중','공실(정리중)','임대모집중']);
  // Older backups remain unchanged. Apply the default only at the display boundary.
  const leaseStatus = tenant => LEASE_STATUSES.includes(tenant?.leaseStatus) ? tenant.leaseStatus : '임대중';
  const KEYS = ['tenants', 'bills', 'loans', 'expenses', 'renewalDone', 'settInputs', 'waterRatio', 'floorOperations'];
  const empty = () => ({tenants: [], bills: {}, loans: [], expenses: {}, renewalDone: {},
    settInputs: {}, waterRatio: {r2: 19, r3: 10, r4: 5}, floorOperations: {5: {leaseStatus: '공실(정리중)'}}});
  const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const fail = message => { throw new Error(message); };
  function receiptRules(){
    const rules=root.RentalBilling||(typeof require==='function'?require('./billing.js'):null);
    if(!rules?.validateReceiptBill||!rules?.assertReceiptDataTransition)fail('입금 원장 검증을 지원하는 최신 앱이 필요합니다.');
    return rules;
  }
  const hasReceiptLedgers=data=>Object.values(data?.bills||{}).some(rows=>Object.values(rows||{}).some(bill=>isObject(bill)&&Object.hasOwn(bill,'receiptLedger')));
  function assertReceiptStorage(storage,data){
    const raw=storage.getItem(STATE_KEY);let previous;
    if(raw!==null){
      try{previous=JSON.parse(raw);}catch{
        if(/"(?:receiptLedger|contractChanges|propertyRecords)"\s*:/.test(raw))fail('저장 이력 원문을 읽지 못해 덮어쓰기를 중단했습니다. 원본을 보관해주세요.');
      }
    }else{
      const bills=storage.getItem('bills');if(bills!==null){try{previous={bills:JSON.parse(bills)};}catch{if(/"receiptLedger"\s*:/.test(bills))fail('기존 입금 원장 원문을 보관해주세요.');}}
    }
    if(hasReceiptLedgers(previous)||hasReceiptLedgers(data))receiptRules().assertReceiptDataTransition(previous,data);
    if(['contractChanges','propertyRecords'].some(key=>Object.hasOwn(previous||{},key)||Object.hasOwn(data||{},key)))receiptRules().assertOperationsTransition(previous,data);
  }
  const record = (value, label) => isObject(value) || fail(`${label}: 객체 형식이 필요합니다.`);
  const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value)
    && !['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty'].includes(value);
  const month = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
  function number(value, label, integer = false) {
    const raw = typeof value === 'string' ? value.replace(/,/g, '').trim() : value;
    const n = Number(raw);
    if (!['number', 'string'].includes(typeof value) || !Number.isFinite(n) || n < 0 || n > 1e12 || (integer && !Number.isSafeInteger(n)))
      fail(`${label}: 0 이상의 유효한 숫자가 필요합니다.`);
  }
  function date(value, year) {
    if (typeof value !== 'string') return false;
    if (value === '') return true;
    const match = /^(?:(\d{4})[./-])?(\d{1,2})[./-](\d{1,2})$/.exec(value);
    if (!match) return false;
    const y = Number(match[1] || year), m = Number(match[2]), d = Number(match[3]);
    return y >= 1900 && y <= 2200 && m >= 1 && m <= 12 && d >= 1 && d <= new Date(y,m,0).getDate();
  }
  function flags(value, keys, label) {
    keys.forEach(key => { if (value[key] != null && typeof value[key] !== 'boolean') fail(`${label}.${key}: 참/거짓 값이 필요합니다.`); });
  }
  function inspect(value, depth = 0) {
    if (depth > 15) fail('데이터 중첩이 너무 깊습니다.');
    if (typeof value === 'number' && !Number.isFinite(value)) fail('유효하지 않은 숫자입니다.');
    if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('허용되지 않는 데이터 키입니다.');
        inspect(child, depth + 1);
      }
    }
  }
  function validateList(list, label, numericFields = []) {
    if (!Array.isArray(list)) fail(`${label}: 목록 형식이 필요합니다.`);
    const ids = new Set();
    list.forEach(item => {
      record(item, label);
      if (!id(item.id) || ids.has(item.id)) fail(`${label}: 식별자가 잘못되었거나 중복됩니다.`);
      ids.add(item.id);
      if (typeof item.name !== 'string') fail(`${label}: 이름을 확인해주세요.`);
      numericFields.forEach(key => { if (item[key] != null) number(item[key], `${label}.${key}`, key !== 'rate'); });
    });
  }
  function validateMgmtItems(items) {
    if (!Array.isArray(items)) return;
    const seen = new Set();
    items.forEach((item, idx) => {
      if (!isObject(item)) return;
      let key = typeof item.key === 'string' ? item.key.trim() : '';
      if (!key) {
        key = `m${idx + 1}`;
      }
      if (seen.has(key)) {
        let suffix = 1;
        while (seen.has(`${key}_${suffix}`)) {
          suffix++;
        }
        key = `${key}_${suffix}`;
      }
      item.key = key;
      seen.add(key);
      if (item.amount != null && item.amount !== '') {
        number(item.amount, '관리비', true);
      }
      if (item.name != null && typeof item.name !== 'string') item.name = String(item.name);
      if (item.status != null && !['active', 'actual', 'na', 'inactive'].includes(item.status)) item.status = 'inactive';
    });
  }
  function validateAudit(entries) {
    if (!Array.isArray(entries)) fail('변경 이력 형식을 확인해주세요.');
    entries.forEach(entry => {
      record(entry, '변경 이력');
      if (!['at','action','detail'].every(key => typeof entry[key] === 'string')) fail('변경 이력 항목을 확인해주세요.');
      if (entry.changes != null) record(entry.changes, '변경 전후 값');
    });
  }
  function validateData(input) {
    record(input, '백업');
    inspect(input);
    if (input.schemaVersion !== undefined && input.schemaVersion !== 1) fail('지원하지 않는 백업 버전입니다.');
    if (!Object.hasOwn(input, 'tenants') || !Object.hasOwn(input, 'bills')) fail('세입자와 고지서 데이터가 필요합니다.');
    const data = empty();
    KEYS.forEach(key => { if (Object.hasOwn(input, key)) data[key] = JSON.parse(JSON.stringify(input[key])); });
    // Preserve extension/history fields across older clients. Export and local
    // transport metadata are deliberately kept outside the domain document.
    const metadata=['schemaVersion','exportedAt','localMeta','localDrafts','localSettlementDrafts','reason'];
    Object.keys(input).forEach(key=>{if(!KEYS.includes(key)&&!metadata.includes(key))data[key]=JSON.parse(JSON.stringify(input[key]));});
    validateList(data.tenants, '세입자', ['rent', 'mgmt', 'elevator', 'elecFixed']);
    data.tenants.forEach(t => {
      flags(t, ['archived'], '세입자');
      if (t.leaseStatus !== undefined && !LEASE_STATUSES.includes(t.leaseStatus)) fail('임대상태를 확인해주세요.');
      if (t.deposit != null && t.deposit !== '') {
        if (typeof t.deposit === 'string') t.deposit = Number(t.deposit.replace(/,/g, '').trim());
        number(t.deposit, '보증금', true);
      }
      if (t.audit != null) validateAudit(t.audit);
      if (typeof t.unit !== 'string') fail('세입자 호수를 확인해주세요.');
      for (const key of ['biz', 'contract', 'contract_first', 'payday', 'renew', 'paytype', 'bizNo', 'repName', 'email']) {
        if (t[key] != null && typeof t[key] !== 'string') fail(`세입자.${key}: 문자열이 필요합니다.`);
      }
      if (t.mgmtItems !== undefined) {
        validateMgmtItems(t.mgmtItems);
      }
      if (t.waterHistory !== undefined) {
        if (!Array.isArray(t.waterHistory)) fail('수도 이력이 올바르지 않습니다.');
        const meterMonths = new Set();
        t.waterHistory.forEach(w => {
          record(w, '수도 이력');
          if (!month(w.mk) || !date(w.date, Number(w.mk.slice(0,4))) || !w.date || meterMonths.has(w.mk)) fail('수도 이력 날짜 또는 중복 월을 확인해주세요.');
          meterMonths.add(w.mk);
          number(w.val, '계량기 수치');
        });
      }
    });
    validateList(data.loans, '대출', ['principal', 'rate']);
    for (const key of ['bills', 'expenses', 'settInputs']) {
      record(data[key], key);
      Object.entries(data[key]).forEach(([mk, value]) => {
        if (!month(mk)) fail(`${key}: 월 형식은 YYYY-MM이어야 합니다.`);
        if (key === 'expenses') validateList(value, '지출', ['amount']);
        else record(value, key);
        if (key === 'settInputs') {
          flags(value, ['confirmed','waterActive'], '정산');
          for (const field of ['elec', 'waterTotal', 'waterUsage', 'waterF1', 'elev', 'waste']) {
            if (value[field] != null) number(value[field], `정산.${field}`, !['waterUsage','waterF1'].includes(field));
          }
          if (value.waterFloors != null) {
            record(value.waterFloors, '정산 수도 층별 데이터');
            Object.entries(value.waterFloors).forEach(([floor, fData]) => {
              record(fData, `정산 수도 ${floor}층`);
              for (const fField of ['prevMeter', 'curMeter', 'usage']) {
                if (fData[fField] != null && fData[fField] !== '') number(fData[fField], `정산 수도 ${floor}층 ${fField}`);
              }
            });
          }
        }
      });
    }
    Object.entries(data.bills).forEach(([billMonth, rows]) => Object.entries(rows).forEach(([tenantId, bill]) => {
      if (!id(tenantId)) fail('고지서 식별자를 확인해주세요.');
      record(bill, '고지서');
      const receiptOriginal=Object.hasOwn(bill,'receiptLedger')?JSON.stringify(bill):null;
      if (bill.mgmtItems != null) validateMgmtItems(bill.mgmtItems);
      for (const key of ['rent', 'mgmt', 'elevator', 'elevatorTotal', 'electricity', 'water', 'waste', 'waterMeter']) {
        if (bill[key] != null) number(bill[key], `고지서.${key}`, key !== 'waterMeter');
      }
      flags(bill, ['stampedRent','stampedMgmt','electricityNA','waterNA','wasteNA','invoiceIssued'], '고지서');
      for (const key of ['stampedRentDate','stampedMgmtDate','waterMeterDate']) {
        if (bill[key] != null && !date(bill[key], Number(billMonth.slice(0,4)))) fail(`고지서.${key}: 실제 날짜가 필요합니다.`);
      }
      if (bill.paid !== undefined) {
        record(bill.paid, '납부 확인');
        Object.entries(bill.paid).forEach(([key,p]) => {
          if (!['pay_rent','pay_mgmt','pay_elec','pay_water','pay_elev','pay_waste'].includes(key)) fail('납부 항목 키를 확인해주세요.');
          record(p, '납부 항목'); flags(p, ['na'], '납부 항목');
          if (p.date != null && !date(p.date, Number(billMonth.slice(0,4)))) fail('입금일은 실제 날짜여야 합니다.');
        });
      }
      if (bill.unitSnapshot != null && typeof bill.unitSnapshot !== 'string') fail('고지서 호수를 확인해주세요.');
      if (bill.tenantSnapshot != null) {
        record(bill.tenantSnapshot, '계약 snapshot');
        Object.values(bill.tenantSnapshot).forEach(value => { if (typeof value !== 'string') fail('계약 snapshot 문자열을 확인해주세요.'); });
      }
      if (bill.paydaySnapshot != null && typeof bill.paydaySnapshot !== 'string') fail('고지서 납기일을 확인해주세요.');
      if (bill.snapshotEstimated != null && (!Array.isArray(bill.snapshotEstimated) || bill.snapshotEstimated.some(x => typeof x !== 'string'))) fail('snapshot 보완 이력을 확인해주세요.');
      if (bill.audit != null) {
        validateAudit(bill.audit);
      }
      if(receiptOriginal!==null){
        if(JSON.stringify(bill)!==receiptOriginal)fail('원장 고지서를 자동 보정할 수 없습니다. 원본 파일을 유지해주세요.');
        const tenant=data.tenants.find(row=>row.id===tenantId)||{id:tenantId,name:bill.tenantSnapshot?.name||'',unit:bill.unitSnapshot||'',rent:0,mgmt:0,elevator:0};
        receiptRules().validateReceiptBill(tenant,bill,billMonth+':'+tenantId);
      }
    }));
    record(data.renewalDone, '갱신 상태');
    record(data.floorOperations, '층 운영상태');
    Object.entries(data.floorOperations).forEach(([floor, operation]) => {
      if (!/^[1-5]$/.test(floor)) fail('층 운영상태는 1층부터 5층까지만 저장할 수 있습니다.');
      record(operation, '층 운영상태');
      if (operation.leaseStatus !== undefined && !LEASE_STATUSES.includes(operation.leaseStatus)) fail('층 임대상태를 확인해주세요.');
    });
    record(data.waterRatio, '수도 비율');
    for (const key of ['r2', 'r3', 'r4']) {
      number(data.waterRatio[key], '수도 비율');
      data.waterRatio[key] = Number(data.waterRatio[key]);
    }
    if (['r2', 'r3', 'r4'].reduce((sum, key) => sum + data.waterRatio[key], 0) <= 0) fail('수도 비율 합계는 0보다 커야 합니다.');
    if(['contractChanges','propertyRecords'].some(key=>Object.hasOwn(data,key)))receiptRules().validateOperationsData(data);
    return JSON.parse(JSON.stringify(data));
  }
  function envelope(data) {
    return {schemaVersion: 1, exportedAt: new Date().toISOString(), ...validateData(data)};
  }
  function load(storage) {
    try {
      const current = storage.getItem(STATE_KEY);
      if (current !== null) { const parsed = JSON.parse(current); return {data: validateData(parsed), meta: isObject(parsed.localMeta) ? parsed.localMeta : {}, error: null}; }
      const data = empty();
      KEYS.forEach(key => {
        const raw = storage.getItem(key);
        if (raw !== null) data[key] = JSON.parse(raw);
      });
      return {data: validateData(data), error: null};
    } catch (error) {
      // Do not overwrite the original values when a legacy key or snapshot is damaged.
      return {data: empty(), error};
    }
  }
  function persist(storage, data, meta = {}) {
    // A single setItem is atomic: no partial writes across separate collections.
    const snapshot=envelope(data);assertReceiptStorage(storage,snapshot);
    storage.setItem(STATE_KEY, JSON.stringify({...snapshot, localMeta: meta}));
  }
  function storageToken(storage) {
    const raw = storage.getItem(STATE_KEY);
    return raw === null ? JSON.stringify(KEYS.map(key => storage.getItem(key))) : raw;
  }
  function persistChecked(storage, data, expectedToken, meta = {}) {
    if (storageToken(storage) !== expectedToken) fail('다른 창에서 저장한 데이터가 있습니다. 새로고침 후 다시 편집해주세요.');
    persist(storage, data, meta);
    return storageToken(storage);
  }
  function backup(storage, data, reason) {
    const snapshot = {reason, ...envelope(data)};
    storage.setItem(BACKUP_KEY, JSON.stringify(snapshot));
    return snapshot;
  }
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g,
    ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));
  function validMeterDate(value, year) {
    const match = /^(\d{1,2})\/(\d{1,2})$/.exec(value);
    if (!match) return false;
    const m = Number(match[1]), d = Number(match[2]);
    return m >= 1 && m <= 12 && d >= 1 && d <= new Date(year, m, 0).getDate();
  }
  root.RentalCore = {STATE_KEY, BACKUP_KEY, KEYS, LEASE_STATUSES, leaseStatus, empty, validateData, envelope, load, persist,
    backup, escapeHtml, validMeterDate, storageToken, persistChecked,hasReceiptLedgers,assertReceiptStorage};
  if (typeof module !== 'undefined') module.exports = root.RentalCore;
})(typeof globalThis !== 'undefined' ? globalThis : this);

/* SHARED_CORE_END */
