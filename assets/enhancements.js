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
function discardBillDraft(){
  clearBillDraft();editThisMonth();showToast('초안을 지우고 저장된 고지서를 표시합니다.');
}

function readBillDrafts() {
  if(retainedBillDrafts!==null)return validateDrafts(retainedBillDrafts);
  try { const value=JSON.parse(appStorage.getItem(DRAFT_KEY)||'{}');return validateDrafts(value); }
  catch { return {}; }
}
function collectBillDrafts() {
  return {...readBillDrafts(),...(pendingBillDraft?{[pendingBillDraft.key]:pendingBillDraft.value}:{})};
}
function storeBillDrafts(drafts) {
  retainedBillDrafts=validateDrafts(drafts);
  try {
    appStorage.setItem(DRAFT_KEY,JSON.stringify(retainedBillDrafts));
    retainedBillDrafts=null;return true;
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
function readSettlementDrafts(){if(retainedSettlementDrafts!==null)return retainedSettlementDrafts;try{const v=JSON.parse(appStorage.getItem(SETT_DRAFT_KEY)||'{}');return v&&typeof v==='object'&&!Array.isArray(v)?v:{};}catch{return {};}}
function captureSettlementDraft(){
  if(!settlementDraftEdited||!document.getElementById('section-settlement')?.classList.contains('active')||!document.getElementById('sett-elec'))return;
  const fields={};
  document.querySelectorAll('#sett-step1 input[id],#sett-step1 select[id]').forEach(el=>{fields[el.id]={value:el.value,checked:el.checked===true};});
  const drafts=readSettlementDrafts();drafts[mk()]={fields,baseline:settlementBaseline(),at:new Date().toISOString()};
  if(!storeSettlementDrafts(drafts))showDataNotice('정산 초안을 임시 저장하지 못했습니다. 화면을 유지한 채 백업과 저장 공간을 확인해주세요.');
}
function clearSettlementDraft(){const drafts=readSettlementDrafts();delete drafts[mk()];try{appStorage.setItem(SETT_DRAFT_KEY,JSON.stringify(drafts));settlementDraftError=false;}catch{settlementDraftError=true;}}
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
const baseSwitchTab=switchTab;switchTab=function(tab){captureSettlementDraft();baseSwitchTab(tab);toggleMoreNav(false);document.getElementById('nav-more').classList.toggle('active',['building','tax','settings'].includes(tab));renderSyncCenter();rememberWorkspace();};
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
const APPLICATION_VERSION='2.0.2';
function observeApplicationVersion(remoteVersion){
  if(!remoteVersion||remoteVersion===APPLICATION_VERSION||!/^\d+\.\d+\.\d+$/.test(remoteVersion))return;
  const notice=document.getElementById('app-update-notice');notice.hidden=false;notice.textContent='서버 버전 '+remoteVersion+' · 이 화면 '+APPLICATION_VERSION+'. 입력 중인 내용을 저장하거나 백업하고 다시 열어주세요. 자동으로 새로고침하지 않습니다.';
}
document.addEventListener('DOMContentLoaded',()=>{
  if(initialWorkspace&&Number.isInteger(initialWorkspace.year)&&initialWorkspace.year>=1900&&initialWorkspace.year<=2200&&Number.isInteger(initialWorkspace.month)&&initialWorkspace.month>=1&&initialWorkspace.month<=12){
    cY=initialWorkspace.year;cM=initialWorkspace.month;histY=cY;histM=cM;updateMonthLabel();renderAll();
    if(BUILDING_FILTERS[initialWorkspace.buildingFilter])buildingFilter=initialWorkspace.buildingFilter;
    if(historyTenants().some(t=>t.id===initialWorkspace.tenant))selTenantId=initialWorkspace.tenant;
    switchTab(TABS.includes(initialWorkspace.tab)?initialWorkspace.tab:'home');
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
  try{appStorage.setItem(SETT_DRAFT_KEY,JSON.stringify(clean));retainedSettlementDrafts=null;settlementDraftError=false;return true;}catch{settlementDraftError=true;return false;}
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
