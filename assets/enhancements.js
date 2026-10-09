/* Read-only presentation: issued bills and historical payments use the shared engine. */
function renderDashboardMetrics(context={}) {
  const now=context.today||new Date(),key=mk(),rows=tenantsForMonth(key).map(t=>{
    const b=bills[key]?.[t.id],issued=!!b&&Object.keys(b).length>0;
    return {t,b,issued,p:issued?RentalBilling.payment(t,b):null};
  }),issued=rows.filter(r=>r.issued),missing=rows.length-issued.length;
  const total=issued.reduce((s,r)=>s+r.p.total,0),received=issued.reduce((s,r)=>s+r.p.received,0);
  const accumulated=context.accumulated||RentalBilling.arrears(tenants,bills,now),active=activeTenants();
  const occupied=active.filter(t=>!['공실(정리중)','임대모집중'].includes(t.leaseStatus));
  const vacant=active.filter(t=>['공실(정리중)','임대모집중'].includes(t.leaseStatus)).length+Object.values(floorOperations).filter(r=>['공실(정리중)','임대모집중'].includes(r.leaseStatus)).length;
  const statuses=Object.entries(active.reduce((o,t)=>{const s=t.leaseStatus||'임대중';o[s]=(o[s]||0)+1;return o;},{})).map(([s,n])=>esc(s)+' '+n+'곳').join(' · ');
  document.getElementById('dashboard-metrics').innerHTML='<section class="monthly-overview"><div class="summary-heading"><h3>청구 · 수납</h3><span>'+issued.length+'곳 고지서 기록'+(missing?' · '+missing+'곳 미발행':'')+'</span></div><div class="monthly-values"><div><span>저장된 청구액</span><strong>'+ (issued.length?fmt(total):'미발행')+'</strong></div><div class="received"><span>확인된 입금</span><strong>'+(issued.length?fmt(received):'고지서 입력 후 확인')+'</strong></div></div>'+(total>0?'<progress class="collection-progress" value="'+received+'" max="'+total+'" aria-label="청구 대비 수납률"></progress>':'')+'<div class="summary-note"><span>'+(issued.length?'입금 미확인 '+fmt(total-received):'고지서를 저장하면 수납을 확인할 수 있습니다.')+'</span><span>미발행은 청구 합계에 포함하지 않음</span></div></section><section class="operating-overview"><div class="summary-heading"><h3>운영 현황</h3><button class="text-button" onclick="switchTab(\'building\')">층별 현황 →</button></div><div class="status-counts"><div><strong>'+occupied.length+'</strong><span>임대 중 / 특수상태</span></div><div><strong>'+vacant+'</strong><span>등록된 공실</span></div></div><p class="status-detail">'+(statuses||'등록된 임차인 없음')+'</p></section>';
  let work='';
  if(accumulated.total>0)work+='<div class="priority-item urgent"><div><strong>기한이 지난 입금 '+fmt(accumulated.total)+'</strong><p>'+accumulated.tenantCount+'곳 · '+accumulated.monthCount+'개월. 지급기일 전 미확인 금액은 제외합니다.</p></div><button class="btn btn-secondary" onclick="document.querySelector(\'.quality-details\').open=true;document.getElementById(\'home-alerts\').scrollIntoView({block:\'start\'})">체납 내역</button></div>';
  if(missing)work+='<div class="priority-item"><div><strong>이번 달 고지서 '+missing+'곳 미발행</strong><p>공용비 정산 후 고지서와 청구 내역을 확인하세요.</p></div><button class="btn btn-secondary" onclick="switchTab(\'settlement\')">정산 입력</button></div>';
  const contracts=contractAlerts(koreaDateKey(now)).map(r=>({t:r.tenant,days:r.deadline.days}));
  if(contracts.length)work+='<div class="priority-item"><div><strong>계약 일정 '+contracts.length+'곳 확인</strong><p>'+contracts.slice(0,3).map(r=>esc(r.t.biz||r.t.name)+' '+(r.days<0?'만료 경과':r.days+'일 남음')).join(' · ')+'</p></div><button class="btn btn-secondary" onclick="switchTab(\'building\')">계약 확인</button></div>';
  if(cloudDirty)work+='<div class="priority-item"><div><strong>Google에 아직 반영되지 않은 수정</strong><p>이 기기 저장과 Google 저장을 확인하세요.</p></div><button class="btn btn-secondary" onclick="openSyncCenter()">저장 상태</button></div>';
  document.getElementById('priority-work').innerHTML=work||'<p class="priority-empty">현재 확인된 연체나 임박한 계약 일정이 없습니다.</p>';
  const receipts=[];
  for(const [month,bs] of Object.entries(bills))for(const [id,b] of Object.entries(bs))for(const kind of ['Rent','Mgmt'])if(b['stamped'+kind]&&b['stamped'+kind+'Date'])receipts.push({month,id,date:b['stamped'+kind+'Date'],kind});
  receipts.sort((a,b)=>b.date.localeCompare(a.date));
  document.getElementById('recent-receipts').innerHTML=receipts.slice(0,5).map(r=>{const t=findTenant(r.id,r.month);return '<div class="recent-entry"><strong>'+esc(t.biz||t.name)+' · '+(r.kind==='Rent'?'월세':'관리·공과금')+'</strong><span>'+esc(r.date)+' · '+esc(r.month)+' 고지서</span><button class="text-button" data-id="'+esc(r.id)+'" data-month="'+esc(r.month)+'" onclick="goToBill(this.dataset.id,this.dataset.month)">입금 내역 →</button></div>';}).join('')||'<p class="priority-empty">완납 날짜를 기록하면 최근 입금이 표시됩니다.</p>';
  document.getElementById('onboarding').innerHTML=tenants.length?'':'<div class="onboarding"><div><strong>건물의 첫 기록을 시작하세요.</strong><p>JSON 백업을 가져오거나 임차인을 등록하세요.</p></div><div><button class="btn btn-primary" onclick="document.getElementById(\'import-file\').click()">기존 백업 가져오기</button><button class="btn btn-secondary" onclick="switchTab(\'tenants\')">임차인 등록</button><a class="btn btn-secondary" href="?demo=1">예시로 둘러보기</a></div></div>';
}

function exportMonthCsv() {
  const rows=[['기준월','호수','상호','세입자','월세','관리비','전기','수도','엘리베이터','오물비','미부과 차감','총 청구액','입금 확인','미확인','월세 완납일','관리비 완납일']];
  tenantsForMonth().forEach(t=>{
    const bill=bills[mk()]?.[t.id]||{},s=RentalBilling.payment(t,bill),c=RentalBilling.charges(t,bill);
    const identity=billTenant(t,bill);
    rows.push([mk(),identity.unit,identity.biz||'',identity.name,...['pay_rent','pay_mgmt','pay_elec','pay_water','pay_elev','pay_waste'].map(k=>c[k]),s.exempt,s.total,s.received,s.unpaid,bill.stampedRent?bill.stampedRentDate||'':'',bill.stampedMgmt?bill.stampedMgmtDate||'':'']);
  });
  const cell=value=>{
    let text=String(value??'');
    if(typeof value==='string'&&/^[\s]*[=+@-]/.test(text))text="'"+text;
    return '"'+text.replaceAll('"','""')+'"';
  };
  const url=URL.createObjectURL(new Blob(['\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));
  const link=document.createElement('a');link.href=url;link.download=`임대관리_월별내역_${mk()}.csv`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  showToast('월별 내역 다운로드를 시작했습니다.');
}

const DRAFT_KEY='rentalApp.billDrafts.v1';
let draftTimer=null,pendingBillDraft=null,draftVersion=0;
// Keep imported drafts recoverable if the separate draft storage write fails.
let retainedBillDrafts=null;
const billSignature=()=>JSON.stringify(bills[activeMk()]?.[selTenantId]||{});
function validateDrafts(value) {
  if(!value||typeof value!=='object'||Array.isArray(value))return {};
  const result={};
  for(const [key,draft] of Object.entries(value)){
    if(!/^\d{4}-(0[1-9]|1[0-2]):[a-zA-Z0-9_-]{1,100}$/.test(key)||!draft?.fields||typeof draft.fields!=='object')continue;
    const fields={};
    for(const field of ['electricity','water','waste','water-meter','water-date'])
      if(typeof draft.fields[field]==='string'&&draft.fields[field].length<1000)fields[field]=draft.fields[field];
    result[key]={fields,updatedAt:typeof draft.updatedAt==='string'?draft.updatedAt:'',baseline:typeof draft.baseline==='string'?draft.baseline:null};
  }
  return result;
}
const DRAFT_RECOVERY_PREFIX='rentalApp.draftRecovery.v1.';
const DRAFT_RECOVERY_FORMAT='rental-draft-recovery-v1';
const pendingDraftRecovery=new Map(),draftDiagnostics=new Map();
let draftRecoveryWriteFailed=false,draftNoticeSignature='';
const draftRecoveryViewKeys=new Map();
const draftStorageReadFailures=new Set();
function draftContentChanged(original,clean){
  if(original&&clean&&typeof original==='object'&&typeof clean==='object'&&Array.isArray(original)===Array.isArray(clean))
    return Object.keys(original).some(key=>!Object.hasOwn(clean,key)||draftContentChanged(original[key],clean[key]));
  return original!==clean;
}
function inspectDraftText(raw,source){
  if(raw===null)return {clean:{},problem:false};
  try {
    const value=JSON.parse(raw),clean=source==='bill'?validateDrafts(value):validateSettlementDrafts(value);
    return {clean,problem:!value||typeof value!=='object'||Array.isArray(value)||draftContentChanged(value,clean)};
  } catch {return {clean:{},problem:true};}
}
function readDraftStorage(key,source){
  try {
    const raw=appStorage.getItem(key),inspection=inspectDraftText(raw,source);
    draftStorageReadFailures.delete(source);
    if(inspection.problem)draftDiagnostics.set(source,raw);else draftDiagnostics.delete(source);
    renderDraftRecoveryNotice();return inspection.clean;
  } catch {
    draftStorageReadFailures.add(source);renderDraftRecoveryNotice();return {};
  }
}
function storedDraftRecovery(){
  const scope=STORAGE_PREFIX+(isDemo?'rentalDemo.':'')+DRAFT_RECOVERY_PREFIX,entries=[];
  for(let i=0;i<localStorage.length;i++){
    const physical=localStorage.key(i);if(!physical?.startsWith(scope))continue;
    const raw=localStorage.getItem(physical);if(raw===null)continue;
    try {
      const entry=JSON.parse(raw);
      if(entry&&['bill','settlement','recovery'].includes(entry.source)&&typeof entry.raw==='string')entries.push(entry);
      else entries.push({source:'recovery',raw,at:'',id:physical.slice(scope.length)});
    } catch {entries.push({source:'recovery',raw,at:'',id:physical.slice(scope.length)});}
  }
  return entries;
}
function collectDraftRecovery(){
  readDraftStorage(DRAFT_KEY,'bill');readDraftStorage(SETT_DRAFT_KEY,'settlement');
  if(draftStorageReadFailures.size)throw new Error('초안 저장소를 읽지 못해 전체 원문을 확인할 수 없습니다.');
  const entries=[...storedDraftRecovery(),...pendingDraftRecovery.values()];
  for(const [source,raw] of draftDiagnostics)if(!entries.some(entry=>entry.source===source&&entry.raw===raw))entries.push({source,raw,at:'',id:''});
  return {format:DRAFT_RECOVERY_FORMAT,entries};
}
function preserveDraftText(source,raw){
  const identity=source+'\n'+raw;
  if(storedDraftRecovery().some(entry=>entry.source===source&&entry.raw===raw)){
    pendingDraftRecovery.delete(identity);draftRecoveryWriteFailed=pendingDraftRecovery.size>0;renderDraftRecoveryNotice();return true;
  }
  const entry=pendingDraftRecovery.get(identity)||{source,raw,at:new Date().toISOString(),id:crypto.randomUUID()};
  pendingDraftRecovery.set(identity,entry);
  try {
    const key=DRAFT_RECOVERY_PREFIX+entry.id,value=JSON.stringify(entry);
    appStorage.setItem(key,value);
    if(appStorage.getItem(key)!==value)throw new Error('초안 원문 보관 확인 실패');
    pendingDraftRecovery.delete(identity);draftRecoveryWriteFailed=pendingDraftRecovery.size>0;renderDraftRecoveryNotice();return true;
  } catch {draftRecoveryWriteFailed=true;renderDraftRecoveryNotice();return false;}
}
function preserveStoredDraft(key,source){
  const raw=appStorage.getItem(key);
  if(!inspectDraftText(raw,source).problem)return true;
  return preserveDraftText(source,raw);
}
function preserveIncomingDrafts(backup){
  if(!backup)return;
  for(const [name,source] of [['localDrafts','bill'],['localSettlementDrafts','settlement']]){
    if(backup[name]===undefined)continue;
    const raw=JSON.stringify(backup[name]);
    if(inspectDraftText(raw,source).problem&&!preserveDraftText(source,raw))throw new Error('가져올 초안 원문을 보관하지 못했습니다. 원본 파일을 유지하고 저장 공간을 확인해주세요.');
  }
  const recovery=backup.localMeta?.draftRecovery;if(recovery===undefined)return;
  if(recovery?.format===DRAFT_RECOVERY_FORMAT&&Array.isArray(recovery.entries)){
    if(Object.keys(recovery).some(key=>!['format','entries'].includes(key))&&!preserveDraftText('recovery',JSON.stringify(recovery)))throw new Error('확장된 초안 복구 원문을 보관하지 못했습니다. 원본 파일을 유지해주세요.');
    for(const entry of recovery.entries){
      const valid=entry&&['bill','settlement','recovery'].includes(entry.source)&&typeof entry.raw==='string';
      if(valid&&Object.keys(entry).some(key=>!['source','raw','at','id'].includes(key))&&!preserveDraftText('recovery',JSON.stringify(entry)))throw new Error('확장된 초안 복구 원문을 보관하지 못했습니다. 원본 파일을 유지해주세요.');
      if(!preserveDraftText(valid?entry.source:'recovery',valid?entry.raw:JSON.stringify(entry)))throw new Error('초안 복구 원문 보관에 실패했습니다. 원본 파일을 유지해주세요.');
    }
  } else if(!preserveDraftText('recovery',JSON.stringify(recovery)))throw new Error('초안 복구 원문 보관에 실패했습니다. 원본 파일을 유지해주세요.');
}
function incomingDraftWarning(backup){
  return [['localDrafts','bill'],['localSettlementDrafts','settlement']].some(([key,source])=>backup[key]!==undefined&&inspectDraftText(JSON.stringify(backup[key]),source).problem)||backup.localMeta?.draftRecovery!==undefined;
}
let backupCheckSequence=0,backupCheckReader=null,backupCheckData=null;
function endBackupCheck(){
  backupCheckSequence++;backupCheckData=null;
  if(backupCheckReader?.readyState===FileReader.LOADING)backupCheckReader.abort();
  backupCheckReader=null;document.getElementById('backup-check-result')?.replaceChildren();
}
function openBackupCheck(){
  if(document.querySelector('.modal-overlay.open'))return;
  endBackupCheck();document.getElementById('backup-check-status').textContent='확인할 JSON 파일을 선택해주세요.';
  openModal('modal-backup-check');
}
function backupCheckLine(label,value){
  const row=document.createElement('div'),term=document.createElement('dt'),definition=document.createElement('dd');
  term.textContent=label;definition.textContent=value;row.append(term,definition);return row;
}
function refreshBackupComparison(){
  const target=document.getElementById('backup-check-comparison');if(!target||!backupCheckData)return;
  if(loadedState.error||conflictingTab){target.textContent='이 창 자료의 비교는 저장 상태 확인이 필요합니다. 파일의 형식 검사 결과는 유지됩니다.';return;}
  try{
    const count=cloudDifferences(RentalCore.validateData(currentData()),backupCheckData).length;
    target.textContent='비교 시각 '+new Date().toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+' · 이 창의 임대 자료와 '+(count?'차이 '+count+'개가 있습니다.':'일치합니다.')+' 미저장 입력, 초안과 복구 원문은 이 비교에 포함하지 않습니다.';
  }catch{target.textContent='이 창 자료를 비교하지 못했습니다. 파일의 형식 검사 결과는 유지됩니다.';}
}
function renderBackupFileReport(parsed){
  const list=document.createElement('dl');list.className='backup-check-facts';
  const result=document.getElementById('backup-check-result');result.append(list);
  const isObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  if(isObject(parsed)&&!Object.hasOwn(parsed,'tenants')&&!Object.hasOwn(parsed,'bills')){
    if(parsed.format===DRAFT_RECOVERY_FORMAT&&Array.isArray(parsed.entries)){
      document.getElementById('backup-check-status').textContent='초안 복구 원문 파일입니다. 전체 임대 자료 백업이 아닙니다.';
      list.append(backupCheckLine('원문 항목',parsed.entries.length+'개'));
      const valid=parsed.entries.filter(entry=>entry&&['bill','settlement','recovery'].includes(entry.source)&&typeof entry.raw==='string').length;
      list.append(backupCheckLine('원문 형식',valid===parsed.entries.length?'문자열 원문을 포함합니다.':'확인이 필요한 원문 항목이 있습니다.'));
      return;
    }
    if(Object.hasOwn(parsed,'recoveryRaw')){
      document.getElementById('backup-check-status').textContent='손상 원본 보관 파일입니다. 전체 자료 복원에 바로 사용할 수 없습니다.';return;
    }
  }
  const data=RentalCore.validateData(parsed);backupCheckData=data;
  document.getElementById('backup-check-status').textContent='임대 자료의 형식 검사를 통과했습니다. 이 기기의 자료는 변경하지 않았습니다.';
  const countRows=value=>Object.values(value).reduce((sum,rows)=>sum+Object.keys(rows).length,0);
  list.append(backupCheckLine('백업 버전',parsed.schemaVersion===undefined?'이전 형식 (버전 표기 없음)':String(parsed.schemaVersion)),
    backupCheckLine('파일 안의 백업 시각',typeof parsed.exportedAt==='string'&&!Number.isNaN(Date.parse(parsed.exportedAt))?new Date(parsed.exportedAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'확인되지 않음'),
    backupCheckLine('임차인 (보관 포함)',data.tenants.length+'명'),backupCheckLine('고지서',countRows(data.bills)+'건 · '+Object.keys(data.bills).length+'개월'),
    backupCheckLine('대출',data.loans.length+'건'),backupCheckLine('지출',countRows(data.expenses)+'건'),backupCheckLine('정산',Object.keys(data.settInputs).length+'개월'));
  const warnings=[];
  const metadata=new Set(['schemaVersion','exportedAt','localMeta','localDrafts','localSettlementDrafts','reason']);
  const original=Object.fromEntries(Object.entries(parsed).filter(([key])=>!metadata.has(key)));
  if(cloudDifferences(original,data).length)warnings.push('기존 복원 규칙에 따라 기본값이 추가되거나 일부 값이 정규화됩니다. 적용 전 파일 가져오기의 비교 화면을 확인해주세요.');
  for(const [field,source,title] of [['localDrafts','bill','고지서 초안'],['localSettlementDrafts','settlement','정산 초안']]){
    if(parsed[field]===undefined){list.append(backupCheckLine(title,'파일에 포함되지 않음'));continue;}
    const inspected=inspectDraftText(JSON.stringify(parsed[field]),source);
    list.append(backupCheckLine(title,'지원 형식 '+Object.keys(inspected.clean).length+'개'+(inspected.problem?' · 원문 확인 필요':'')));
    if(inspected.problem)warnings.push(title+'에 자동 적용하지 않는 내용이 있습니다. 기존 복원은 해당 원문을 별도 보관하며, 보관 실패 시 중단합니다.');
  }
  const recovery=parsed.localMeta?.draftRecovery;
  list.append(backupCheckLine('복구 원문',recovery===undefined?'파일에 포함되지 않음':recovery?.format===DRAFT_RECOVERY_FORMAT&&Array.isArray(recovery.entries)?recovery.entries.length+'개':'원문 형식 확인 필요'));
  if(recovery!==undefined)warnings.push('복구 원문은 확인·별도 보관용이며 고지서·정산에 자동 적용하지 않습니다.');
  if(parsed.localMeta!==undefined&&!isObject(parsed.localMeta))warnings.push('기기 메타데이터의 형식을 확인해주세요.');
  const extra=isObject(parsed.localMeta)?Object.keys(parsed.localMeta).filter(key=>key!=='draftRecovery'):[];
  if(extra.length)warnings.push('복원 대상이 아닌 기기 메타데이터가 있습니다. 원본 파일을 보관해주세요.');
  for(const text of warnings){const warning=document.createElement('p');warning.className='hint-box';warning.textContent=text;result.append(warning);}
  const comparison=document.createElement('p');comparison.id='backup-check-comparison';comparison.setAttribute('role','status');result.append(comparison);
  const compare=document.createElement('button');compare.type='button';compare.className='btn btn-secondary';compare.textContent='이 창 자료와 다시 비교';compare.onclick=refreshBackupComparison;result.append(compare);refreshBackupComparison();
}
function checkBackupFile(event){
  const file=event.target.files[0];event.target.value='';if(!file)return;
  endBackupCheck();const sequence=backupCheckSequence,result=document.getElementById('backup-check-result'),status=document.getElementById('backup-check-status');
  const facts=document.createElement('dl');facts.className='backup-check-facts';facts.append(backupCheckLine('선택한 파일',file.name),backupCheckLine('파일 크기',file.size.toLocaleString()+'B'));result.append(facts);
  if(file.size>10*1024*1024){status.textContent='10MB 이하의 JSON 파일을 선택해주세요.';return;}
  status.textContent='파일을 읽고 형식을 확인하는 중입니다…';
  const reader=new FileReader();backupCheckReader=reader;
  const current=()=>sequence===backupCheckSequence&&document.getElementById('modal-backup-check').classList.contains('open');
  reader.onerror=()=>{if(current())status.textContent='파일을 읽지 못했습니다. 원본 파일을 유지하고 다시 선택해주세요.';};
  reader.onload=async()=>{
    if(!current())return;
    try{
      const bytes=reader.result;if(bytes.byteLength!==file.size)throw new Error('파일 크기와 읽은 내용이 일치하지 않습니다.');
      let parsed;try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new Error('UTF-8 JSON 형식으로 읽지 못했습니다. 원본 파일을 유지해주세요.');}
      renderBackupFileReport(parsed);
      const fingerprint=document.createElement('details'),summary=document.createElement('summary'),hash=document.createElement('p');summary.textContent='파일 지문 확인';hash.className='backup-check-hash';fingerprint.append(summary,hash);result.append(fingerprint);
      try{const digest=await crypto.subtle.digest('SHA-256',bytes);if(!current())return;hash.textContent='SHA-256 '+[...new Uint8Array(digest)].map(value=>value.toString(16).padStart(2,'0')).join('');}
      catch{if(!current())return;hash.textContent='이 환경에서는 파일 지문을 계산하지 못했습니다. 위의 형식 검사 결과는 유지됩니다.';}
      const note=document.createElement('p');note.className='card-sub';note.textContent='파일 지문은 같은 파일인지 구분하는 값입니다. 파일 내용이 최신인지, 모든 자료가 빠짐없이 포함됐는지를 보장하지 않습니다.';fingerprint.append(note);
    }catch(error){if(current()){backupCheckData=null;result.replaceChildren(facts);status.textContent='형식 확인 실패: '+error.message;}}
  };
  try{reader.readAsArrayBuffer(file);}catch{reader.onerror();}
}
function exportDraftRecovery(){
  try {downloadJson(collectDraftRecovery(),'초안원문');showToast('초안 원문 파일 다운로드를 시작했습니다.');}
  catch {showToast('초안 원문을 내보내지 못했습니다. 이 창을 유지하고 저장소 접근 상태를 확인해주세요.');}
}
function draftRecoveryInventory(){
  let stored=[],unreadable=false;
  try{stored=storedDraftRecovery();}catch{unreadable=true;}
  const records=new Map();
  const add=(entry,state)=>{
    const identity=entry.source+'\n'+entry.raw;
    let row=records.get(identity);
    if(!row){
      if(!draftRecoveryViewKeys.has(identity))draftRecoveryViewKeys.set(identity,'draft-record-'+draftRecoveryViewKeys.size);
      row={entry,key:draftRecoveryViewKeys.get(identity),stored:false,pending:false,current:false};records.set(identity,row);
    }
    row[state]=true;
  };
  stored.forEach(entry=>add(entry,'stored'));
  pendingDraftRecovery.forEach(entry=>add(entry,'pending'));
  draftDiagnostics.forEach((raw,source)=>add({source,raw,at:'',id:''},'current'));
  return {rows:[...records.values()],unreadable};
}
function openDraftRecovery(){
  readDraftStorage(DRAFT_KEY,'bill');readDraftStorage(SETT_DRAFT_KEY,'settlement');
  openModal('modal-draft-recovery');renderDraftRecoveryView();
}
function refreshDraftRecovery(){
  readDraftStorage(DRAFT_KEY,'bill');readDraftStorage(SETT_DRAFT_KEY,'settlement');renderDraftRecoveryView();
}
function retryDraftRecovery(row){
  try{
    if(!preserveDraftText(row.entry.source,row.entry.raw))throw new Error('초안 원문 보관 실패');
    showToast('초안 원문을 기기에 보관했습니다. 기존 초안과 임대 자료는 유지됩니다.');
  }catch{showToast('초안 원문을 기기에 보관하지 못했습니다. 이 창을 유지하고 파일로 내보내주세요.');}
  renderDraftRecoveryView();
}
function exportDraftRecoveryEntry(row){
  try{downloadJson({format:DRAFT_RECOVERY_FORMAT,entries:[row.entry]},'초안원문_개별');showToast('선택한 원문 파일 다운로드를 시작했습니다. 파일이 저장됐는지 확인해주세요.');}
  catch{showToast('선택한 원문을 내보내지 못했습니다. 이 창을 유지해주세요.');}
}
function renderDraftRecoveryView(){
  const modal=document.getElementById('modal-draft-recovery');if(!modal?.classList.contains('open'))return;
  const inventory=draftRecoveryInventory(),rows=inventory.rows,unreadable=inventory.unreadable||draftStorageReadFailures.size>0,list=document.getElementById('draft-recovery-list');
  const focused=document.activeElement,focusKey=focused?.dataset.focusKey;
  const expanded=new Set([...list.querySelectorAll('details[open]')].map(el=>el.dataset.recordKey));
  const selection=focused?.tagName==='TEXTAREA'?{start:focused.selectionStart,end:focused.selectionEnd}:null;
  const scrollTop=modal.querySelector('.modal').scrollTop;
  const error=document.getElementById('draft-recovery-read-error');error.hidden=!unreadable;error.textContent=unreadable?'초안 원문 저장소를 읽지 못했습니다. 저장소 접근 상태를 확인해주세요. 아래 목록에는 현재 창에서 확인할 수 있는 원문만 표시합니다.':'';
  document.getElementById('draft-recovery-summary').textContent=rows.length?'확인된 원문 '+rows.length+'건 · 기기 보관 '+rows.filter(r=>r.stored).length+' · 기기 미보관 '+rows.filter(r=>!r.stored).length+(unreadable?' · 기기 기록 확인 필요':''):unreadable?'기기 기록 확인 필요':'확인된 복구 원문이 없습니다.';
  list.replaceChildren();
  for(const row of rows){
    const card=document.createElement('article');card.className='draft-recovery-record';card.dataset.recordKey=row.key;card.dataset.source=row.entry.source;
    const title=document.createElement('h3');title.textContent=({bill:'고지서 초안',settlement:'정산 초안',recovery:'복구 기록 원문'})[row.entry.source];
    const status=document.createElement('p');status.className='draft-recovery-state';status.textContent=(row.stored?'기기에 보관됨':row.pending?'현재 창에만 있음 · 기기 보관 실패':'기존 초안 저장소에 있음 · 별도 보관 전')+(row.current?' · 현재 초안 확인 필요':'');
    const metadata=document.createElement('p');metadata.className='card-sub';
    const at=typeof row.entry.at==='string'?new Date(row.entry.at):new Date(NaN),bytes=new Blob([row.entry.raw]).size;
    metadata.textContent='보관 시각 '+(row.stored&&!Number.isNaN(at.getTime())?at.toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'확인되지 않음')+' · 원문 '+bytes.toLocaleString()+'B';
    const actions=document.createElement('div');actions.className='draft-recovery-actions';
    const download=document.createElement('button');download.type='button';download.className='btn btn-secondary';download.textContent='이 원문 내보내기';download.dataset.focusKey=row.key+'-export';download.onclick=()=>exportDraftRecoveryEntry(row);actions.append(download);
    if(!row.stored){const retry=document.createElement('button');retry.type='button';retry.className='btn btn-secondary';retry.textContent='기기에 보관 다시 시도';retry.dataset.focusKey=row.key+'-retry';retry.onclick=()=>retryDraftRecovery(row);actions.append(retry);}
    const details=document.createElement('details');details.dataset.recordKey=row.key;
    const summary=document.createElement('summary');summary.textContent='원문 보기';summary.dataset.focusKey=row.key+'-summary';details.append(summary);
    const showRaw=()=>{
      if(!details.open||details.querySelector('textarea'))return;
      const label=document.createElement('label');label.textContent='원문 내용';label.htmlFor=row.key+'-raw';
      const raw=document.createElement('textarea');raw.id=label.htmlFor;raw.className='draft-raw-text';raw.readOnly=true;raw.rows=6;raw.value=row.entry.raw;raw.dataset.focusKey=row.key+'-raw';details.append(label,raw);
    };
    details.addEventListener('toggle',showRaw);details.open=expanded.has(row.key);showRaw();
    card.append(title,status,metadata,actions,details);list.append(card);
  }
  modal.querySelector('.modal').scrollTop=scrollTop;
  if(focusKey&&list.contains(focused)===false&&!focused?.isConnected){
    const replacement=list.querySelector('[data-focus-key="'+CSS.escape(focusKey)+'"]')||list.querySelector('[data-focus-key="'+CSS.escape(focusKey.replace(/-(retry|export|raw)$/,'-summary'))+'"]')||modal.querySelector('.modal-title');
    replacement?.focus({preventScroll:true});if(selection&&replacement?.tagName==='TEXTAREA')replacement.setSelectionRange(selection.start,selection.end);
  }
}
function renderDraftRecoveryNotice(){
  renderDraftRecoveryView();
  const anchor=document.getElementById('data-notice');if(!anchor)return;
  let count=0,readFailed=draftStorageReadFailures.size>0;try{count=storedDraftRecovery().length+pendingDraftRecovery.size;}catch{readFailed=true;}
  const active=draftDiagnostics.size,signature=[count,active,draftRecoveryWriteFailed,readFailed].join(':');
  if(signature===draftNoticeSignature)return;draftNoticeSignature=signature;
  let panel=document.getElementById('draft-recovery-notice');
  if(!panel){panel=document.createElement('section');panel.id='draft-recovery-notice';panel.className='data-notice draft-recovery-notice';panel.setAttribute('role','status');anchor.after(panel);}
  panel.hidden=!count&&!active&&!draftRecoveryWriteFailed&&!readFailed;panel.replaceChildren();if(panel.hidden)return;
  const text=document.createElement('p');
  text.textContent=readFailed?'초안 기록을 읽지 못했습니다. 복구 원문 확인에서 현재 확인 가능한 기록을 내보내고 저장소 접근 상태를 확인해주세요.':draftRecoveryWriteFailed?'초안 원문을 기기에 보관하지 못했습니다. 기존 초안 저장소는 유지합니다. 이 창을 닫기 전에 원문과 현재 입력을 파일로 내보내주세요.':active?'초안 확인 필요 · 읽지 못하거나 지원하지 않는 내용이 있습니다. 정상 고지서·정산 자료는 유지하며, 해당 원문은 초안에 자동 적용하지 않습니다.':'초안 복구 원문 '+count+'건을 이 기기에 보관했습니다. 파일로 내보내 장기 보관할 수 있습니다.';
  const button=document.createElement('button');button.type='button';button.className='btn btn-secondary';button.textContent='초안 원문 내보내기';button.onclick=exportDraftRecovery;
  const inspect=document.createElement('button');inspect.type='button';inspect.className='btn btn-secondary';inspect.textContent='복구 원문 확인';inspect.dataset.focusKey='draft-recovery-open-notice';inspect.onclick=openDraftRecovery;panel.append(text,inspect,button);
}
document.addEventListener('DOMContentLoaded',()=>{readDraftStorage(DRAFT_KEY,'bill');readDraftStorage(SETT_DRAFT_KEY,'settlement');renderDraftRecoveryNotice();});
window.addEventListener('storage',event=>{
  const scope=STORAGE_PREFIX+(isDemo?'rentalDemo.':'');
  if([scope+DRAFT_KEY,scope+SETT_DRAFT_KEY].includes(event.key))refreshDraftRecovery();
  else if(event.key?.startsWith(scope+DRAFT_RECOVERY_PREFIX))renderDraftRecoveryNotice();
});
function discardBillDraft(){
  clearBillDraft();editThisMonth();showToast('초안을 지우고 저장된 고지서를 표시합니다.');
}

function readBillDrafts() {
  if(retainedBillDrafts!==null)return validateDrafts(retainedBillDrafts);
  return readDraftStorage(DRAFT_KEY,'bill');
}
function collectBillDrafts() {
  return {...readBillDrafts(),...(pendingBillDraft?{[pendingBillDraft.key]:pendingBillDraft.value}:{})};
}
function storeBillDrafts(drafts) {
  retainedBillDrafts=validateDrafts(drafts);
  try {
    if(!preserveStoredDraft(DRAFT_KEY,'bill'))return false;
    appStorage.setItem(DRAFT_KEY,JSON.stringify(retainedBillDrafts));
    retainedBillDrafts=null;readDraftStorage(DRAFT_KEY,'bill');return true;
  } catch {return false;}
}
function flushBillDraft() {
  clearTimeout(draftTimer);
  if(!pendingBillDraft||storageFault||conflictingTab)return;
  try {
    const drafts=readBillDrafts();drafts[pendingBillDraft.key]=pendingBillDraft.value;
    if(!storeBillDrafts(drafts))throw new Error('Draft storage failed');
    pendingBillDraft=null;
    const label=document.getElementById('bill-draft-state');if(label)label.textContent='작성 중인 내용이 이 기기에 임시 보관되었습니다.';
  } catch { showDataNotice('고지서 초안을 임시 저장하지 못했습니다. 저장 버튼으로 내용을 저장하고 저장 공간을 확인해주세요.'); }
}
function clearBillDraft(month=activeMk(),id=selTenantId) {
  const key=`${month}:${id}`;
  if(pendingBillDraft?.key===key)pendingBillDraft=null;
  const drafts=readBillDrafts();delete drafts[key];
  if(!storeBillDrafts(drafts))showDataNotice('초안 저장소를 갱신하지 못했습니다. 백업을 내보낸 뒤 저장 공간을 확인해주세요.');
}
function applyBillDraft() {
  const key=`${activeMk()}:${selTenantId}`;
  const draft=pendingBillDraft?.key===key?pendingBillDraft.value:readBillDrafts()[key];
  const stale=draft&&draft.baseline!==billSignature();
  if(draft&&!stale&&draft.fields){
    for(const field of ['electricity','water','waste','water-meter','water-date']){
      const input=document.getElementById('bill-'+field);
      if(input&&typeof draft.fields[field]==='string')input.value=draft.fields[field];
    }
    updateBillTotal();
  }
  const form=document.getElementById('bill-total-display');
  if(form&&!document.getElementById('bill-draft-state')){
    const label=document.createElement('p');label.id='bill-draft-state';label.className='draft-state';
    label.textContent=stale?'저장된 고지서가 바뀌어 이전 초안을 자동 적용하지 않았습니다. 백업으로 초안을 보관할 수 있습니다.':draft?'이 기기에 보관된 초안을 복원했습니다. 저장하면 고지서에 반영됩니다.':'입력 중인 내용은 이 기기에 임시 보관됩니다.';
    if(draft){const button=document.createElement('button');button.className='btn btn-secondary';button.textContent='초안 버리기';button.onclick=discardBillDraft;label.append(button);}
    form.closest('.bill-total-box').before(label);
  }
}
document.addEventListener('input',event=>{
  const input=event.target;
  if(!input.closest('#hist-content')||!document.getElementById('bill-total-display')||!selTenantId)return;
  const fields={};
  for(const field of ['electricity','water','waste','water-meter','water-date']){
    const el=document.getElementById('bill-'+field);if(el)fields[field]=el.value;
  }
  pendingBillDraft={key:`${activeMk()}:${selTenantId}`,value:{fields,baseline:billSignature(),updatedAt:new Date().toISOString()}};
  clearTimeout(draftTimer);draftTimer=setTimeout(flushBillDraft,300);
});
window.addEventListener('pagehide',flushBillDraft);
document.addEventListener('visibilitychange',()=>{if(document.hidden)flushBillDraft();});

for(const type of ['input','change'])document.addEventListener(type,event=>{if(event.target.matches('input:not([type=file]),select,textarea'))draftVersion++;});

/* ───────────────────────────────────────
   테마 모드 제어 (토스 스타일 라이트/다크)
─────────────────────────────────────── */
function initTheme() {
  let theme = 'light';
  try {
    const saved = appStorage.getItem('rental_app_theme');
    theme = saved || 'light';
  } catch (e) {}
  applyTheme(theme, false);
}

function applyTheme(theme, notify = true) {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
  const icon = document.getElementById('theme-icon');
  const text = document.getElementById('theme-text');
  if (icon) icon.textContent = theme === 'dark' ? '☀️' : '🌙';
  if (text) text.textContent = theme === 'dark' ? '라이트' : '다크';
  const btn = document.getElementById('theme-toggle-btn');
  if (btn) {
    const label = theme === 'dark' ? '라이트모드로 전환' : '다크모드로 전환';
    btn.setAttribute('aria-label', label);
    btn.title = label;
  }
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute('content', theme === 'dark' ? '#111317' : '#f7f8fa');
  try { appStorage.setItem('rental_app_theme', theme); } catch (e) {}
  if (notify && typeof showToast === 'function') {
    showToast(theme === 'dark' ? '🌙 다크모드로 변경되었습니다.' : '☀️ 라이트모드로 변경되었습니다.');
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'light';
  const next = current === 'dark' ? 'light' : 'dark';
  applyTheme(next, true);
}

if (typeof document !== 'undefined') {
  initTheme();
  document.addEventListener('DOMContentLoaded', () => {
    const current = document.documentElement.getAttribute('data-theme') || 'light';
    applyTheme(current, false);
  });
  if (typeof window !== 'undefined' && window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
      try {
        if (!appStorage.getItem('rental_app_theme')) {
          applyTheme(e.matches ? 'dark' : 'light', false);
        }
      } catch (err) {}
    });
  }
}
/* V2 workspace state is local-only and shares the independent storage adapter. */
const UI_STATE_KEY='rentalApp.workspace.v2';
let initialWorkspace=null;
try{initialWorkspace=JSON.parse(appStorage.getItem(UI_STATE_KEY)||'null');}catch{}
function toggleMoreNav(force){
  const sidebar=document.querySelector('.workspace-sidebar');
  const open=typeof force==='boolean'?force:!sidebar.classList.contains('more-open');
  sidebar.classList.toggle('more-open',open);document.getElementById('nav-more').setAttribute('aria-expanded',String(open));
}
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&document.querySelector('.workspace-sidebar.more-open')){toggleMoreNav(false);document.getElementById('nav-more').focus();}});
function openSyncCenter(){switchTab('settings');document.getElementById('sync-center').focus();document.getElementById('sync-center').scrollIntoView({block:'start'});renderSyncCenter();}
let localSavedAt=null,googleSavedAt=null,lastGoogleReadAt=null,lastDocsReport=null,lastCalendarReport=null,syncPhase='local';
function renderSyncCenter(){
  const el=document.getElementById('sync-state-grid');if(!el)return;
  const time=value=>value?new Date(value).toLocaleString('ko-KR'):'이번 실행에서 확인하지 않음';
  const report=(value,label)=>value?value.status==='ok'?label+' 완료 · '+time(value.updatedAt):label+' 실패 · '+(value.message||'재시도 필요'):'이번 실행에서 확인하지 않음';
  const rows=[['이 기기 자료',storageFault||conflictingTab?'저장 확인 필요':localSavedAt?'정상 저장 · '+time(localSavedAt):'기존 저장 자료 / 아직 수정 없음'],
    ['Google DB',syncPhase==='saving'?'저장 확인 중':cloudDirty?'현재 수정 반영 대기':googleSavedAt?'서버 저장 응답 검증 · '+time(googleSavedAt):lastGoogleReadAt?'서버 자료 조회 · '+time(lastGoogleReadAt):'이번 실행에서 조회하지 않음'],
    ['현재현황 문서',report(lastDocsReport,'문서 갱신')],['계약 Calendar',report(lastCalendarReport,'일정 동기화')]];
  el.innerHTML=rows.map(([k,v])=>'<div><dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd></div>').join('')+'<div><dt>서버 기준 revision</dt><dd>'+esc(cloudBaseRevision||'아직 대조하지 않음')+'</dd></div><div><dt>로컬 수정 / 연결</dt><dd>'+revision+'회 · '+(cloudEnabled?'Google 연결 켜짐':'이 기기만 사용')+'</dd></div>';
}
const SETT_DRAFT_KEY='rentalApp.settlementDrafts.v2';
const settlementBaseline=()=>JSON.stringify({saved:settInputs[mk()]||{},tenants:activeTenants(),bills:bills[mk()]||{}});
let retainedSettlementDrafts=null;
let settlementDraftError=false,settlementDraftEdited=false;
function readSettlementDrafts(){if(retainedSettlementDrafts!==null)return retainedSettlementDrafts;return readDraftStorage(SETT_DRAFT_KEY,'settlement');}
function captureSettlementDraft(){
  if(!settlementDraftEdited||!document.getElementById('section-settlement')?.classList.contains('active')||!document.getElementById('sett-elec'))return;
  const fields={};
  document.querySelectorAll('#sett-step1 input[id],#sett-step1 select[id]').forEach(el=>{fields[el.id]={value:el.value,checked:el.checked===true};});
  const drafts=readSettlementDrafts();drafts[mk()]={fields,baseline:settlementBaseline(),at:new Date().toISOString()};
  if(!storeSettlementDrafts(drafts))showDataNotice('정산 초안을 임시 저장하지 못했습니다. 화면을 유지한 채 백업과 저장 공간을 확인해주세요.');
}
function clearSettlementDraft(){const drafts=readSettlementDrafts();delete drafts[mk()];return storeSettlementDrafts(drafts);}
function applySettlementDraft(){
  settlementDraftEdited=false;
  const d=readSettlementDrafts()[mk()];if(!d)return;
  const match=d.baseline===settlementBaseline();
  if(match)for(const [id,f] of Object.entries(d.fields||{})){
    const el=document.getElementById(id);if(!el?.closest('#sett-step1')||!el.matches('input,select')||typeof f.value!=='string'||f.value.length>1000)continue;
    el.value=f.value;if(el.type==='checkbox')el.checked=f.checked===true;
  }
  if(match){toggleWaterFields();updateWaterCalculations();if(typeof updateSettLiveTotal==='function')updateSettLiveTotal();}
  const label=document.createElement('p');label.className='draft-state';label.id='sett-draft-state';
  label.textContent=match?'이 기기의 정산 초안을 복원했습니다. 계산·확정 후 저장됩니다.':'기준 자료가 바뀌어 이전 정산 초안을 자동 적용하지 않았습니다. 백업 후 새로 계산하세요.';
  const button=document.createElement('button');button.className='btn btn-secondary';button.textContent='정산 초안 버리기';button.onclick=()=>{clearSettlementDraft();renderSettTab();};label.append(button);document.getElementById('sett-step1').prepend(label);
}
function rememberWorkspace(){
  try{appStorage.setItem(UI_STATE_KEY,JSON.stringify({year:cY,month:cM,tab:document.body.dataset.tab,tenant:selTenantId,buildingFilter,search:document.getElementById('tenant-search')?.value||''}));}catch{}
}
for(const type of ['input','change'])document.addEventListener(type,event=>{if(event.target.closest('#sett-step1')){settlementDraftEdited=true;captureSettlementDraft();}if(event.target.id==='tenant-search')rememberWorkspace();});
window.addEventListener('pagehide',()=>{captureSettlementDraft();rememberWorkspace();});
const baseRenderSett=renderSettTab;renderSettTab=function(){baseRenderSett();applySettlementDraft();};
const baseSwitchTab=switchTab;switchTab=function(tab,options){captureSettlementDraft();baseSwitchTab(tab,options);toggleMoreNav(false);document.getElementById('nav-more').classList.toggle('active',['building','tax','settings'].includes(tab));renderSyncCenter();rememberWorkspace();};
for(const name of ['changeMonth','quickPick','applyMonthPicker','jumpToSettlementMonth']){
  const fn=window[name];window[name]=function(...args){captureSettlementDraft();const result=fn(...args);rememberWorkspace();return result;};
}
const baseConfirmSettlement=confirmSettlement;confirmSettlement=async function(){const before=settInputs[mk()]?.confirmedAt;await baseConfirmSettlement();if(settInputs[mk()]?.confirmedAt!==before){clearSettlementDraft();document.getElementById('sett-draft-state')?.remove();}};
const baseSave=save;save=async function(...args){const ok=await baseSave(...args);if(ok)localSavedAt=new Date().toISOString();renderSyncCenter();return ok;};
const baseDocsReport=showCurrentStatusResult;showCurrentStatusResult=function(report,...args){lastDocsReport=report;baseDocsReport(report,...args);renderSyncCenter();};
const baseCalendarReport=showCalendarSyncResult;showCalendarSyncResult=function(report){lastCalendarReport=report;baseCalendarReport(report);renderSyncCenter();};
const baseSyncUI=syncUI;syncUI=function(state){syncPhase=state;baseSyncUI(state);renderSyncCenter();};
const baseCloudRequest=cloudRequest;cloudRequest=async function(options={}){
  const result=await baseCloudRequest(options),time=new Date().toISOString();
  if(options.method!=='POST')lastGoogleReadAt=time;
  observeApplicationVersion(result.appVersion);renderSyncCenter();return result;
};
const APPLICATION_VERSION='2.1.0';
function observeApplicationVersion(remoteVersion){
  if(!remoteVersion||remoteVersion===APPLICATION_VERSION||!/^\d+\.\d+\.\d+$/.test(remoteVersion))return;
  const notice=document.getElementById('app-update-notice');notice.hidden=false;notice.textContent='서버 버전 '+remoteVersion+' · 이 화면 '+APPLICATION_VERSION+'. 입력 중인 내용을 저장하거나 백업하고 다시 열어주세요. 자동으로 새로고침하지 않습니다.';
}
document.addEventListener('DOMContentLoaded',()=>{
  if(initialWorkspace&&Number.isInteger(initialWorkspace.year)&&initialWorkspace.year>=1900&&initialWorkspace.year<=2200&&Number.isInteger(initialWorkspace.month)&&initialWorkspace.month>=1&&initialWorkspace.month<=12){
    cY=initialWorkspace.year;cM=initialWorkspace.month;histY=cY;histM=cM;updateMonthLabel();renderAll();
    if(BUILDING_FILTERS[initialWorkspace.buildingFilter])buildingFilter=initialWorkspace.buildingFilter;
    if(historyTenants().some(t=>t.id===initialWorkspace.tenant))selTenantId=initialWorkspace.tenant;
    switchTab(TABS.includes(initialWorkspace.tab)?initialWorkspace.tab:'home',{focus:false});
    const search=document.getElementById('tenant-search');if(search&&typeof initialWorkspace.search==='string'){search.value=initialWorkspace.search.slice(0,200);renderTenants();}
  }
  renderSyncCenter();
});
/* V2 labels follow dynamically created existing forms without duplicating listeners. */
function attachInputLabels(){
  document.querySelectorAll('label:not([for])').forEach(label=>{
    const input=label.querySelector('input,select,textarea')||label.parentElement.querySelector('input:not([type=hidden]),select,textarea');
    if(input?.id)label.htmlFor=input.id;
  });
  const labels={'wr2':'2층 수도 배분 비율','wr3':'3층 수도 배분 비율','wr4':'4층 수도 배분 비율'};
  for(const [id,label] of Object.entries(labels))document.getElementById(id)?.setAttribute('aria-label',label);
}
let labelsFrame=0;
if(typeof MutationObserver==='function'&&typeof document.querySelectorAll==='function'){
const labelObserver=new MutationObserver(()=>{if(!labelsFrame)labelsFrame=requestAnimationFrame(()=>{labelsFrame=0;attachInputLabels();});});
labelObserver.observe(document.body,{childList:true,subtree:true});
attachInputLabels();

}
function validateSettlementDrafts(source){
  const clean={};
  if(source&&typeof source==='object'&&!Array.isArray(source))for(const [month,d] of Object.entries(source)){
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||!d||typeof d.baseline!=='string'||d.baseline.length>5000000||!d.fields||typeof d.fields!=='object')continue;
    const fields={};for(const [id,v] of Object.entries(d.fields)){if(/^sett-[a-z0-9-]{1,80}$/.test(id)&&v&&typeof v.value==='string'&&v.value.length<1000)fields[id]={value:v.value,checked:v.checked===true};}
    clean[month]={fields,baseline:d.baseline,at:typeof d.at==='string'?d.at:''};
  }
  return clean;
}
function storeSettlementDrafts(source){
  const clean=validateSettlementDrafts(source);
  retainedSettlementDrafts=clean;
  try{if(!preserveStoredDraft(SETT_DRAFT_KEY,'settlement')){settlementDraftError=true;return false;}appStorage.setItem(SETT_DRAFT_KEY,JSON.stringify(clean));retainedSettlementDrafts=null;settlementDraftError=false;readDraftStorage(SETT_DRAFT_KEY,'settlement');return true;}catch{settlementDraftError=true;return false;}
}
async function inspectCloudRecovery(){
  if(isDemo||!cloudEnabled){showToast('Google에 연결한 독립앱에서 점검할 수 있습니다.');return;}
  if(syncBusy||persistenceBusy){showToast('현재 요청이 끝난 뒤 다시 점검해주세요.');return;}
  syncBusy=true;const button=document.getElementById('inspect-cloud-recovery');button.disabled=true;
  try{
    const requestId=crypto.randomUUID();const result=await cloudRequest({method:'POST',body:JSON.stringify({protocol:'rental-sync-v2',action:'inspectRecovery',expectedRevision:cloudBaseRevision||'inspection-only',requestId})});
    const r=result.recovery;if(result.requestId!==requestId||!r||!/^sha256-[a-f0-9]{64}$/.test(r.revision))throw new Error('서버 복구점 검증 결과를 확인하지 못했습니다. 서버 버전과 복구 시트를 확인해주세요.');
    showDataNotice('최근 서버 복구점 해시 검증 완료 · '+r.tenants+'명 · '+r.billMonths+'개월 · '+r.chunks+'청크 · '+r.revision+'. 점검은 DB나 문서를 변경하지 않습니다. 복원은 문서에 정리한 절차에 따라 원문을 보관하고 진행하세요.');
  }catch(error){showDataNotice('서버 복구점 점검 실패: '+error.message);}finally{syncBusy=false;button.disabled=false;}
}
