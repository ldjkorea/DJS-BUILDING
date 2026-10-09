const {applyReplacement,restoreRecovery:restoreRecoveryV2,applyCloudImport}=require('./navigation.cjs');
const {navigate:navigateV2}=require('./navigation.cjs');
/* Operational regressions use disposable browser contexts and mock cloud responses. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const core=require('../assets/core.js');
const billing=require('../assets/billing.js');
const TEST_URL=process.env.RENTAL_TEST_URL||'http://127.0.0.1:4173/';
const out=path.resolve(__dirname,'../test-results');
fs.mkdirSync(out,{recursive:true});
const results=[];
const day=new Date(),year=day.getFullYear(),month=day.getMonth()+1;
const key=`${year}-${String(month).padStart(2,'0')}`;
const past=`${year-1}-02`;
const receipt=`${year-1}.02.15`;
const tenant={id:'audit1',name:'감사 세입자',biz:'검증 업체',unit:'201호',payday:'15일',rent:100000,mgmt:10000,elevator:0};
const sample=()=>({...core.empty(),tenants:[{...tenant}],bills:{[past]:{audit1:billing.freezeBill(tenant,{electricity:35000,water:10000},past)}}});
let browser,runtimeErrors=[];
const cases=[];
const test=(name,fn)=>cases.push({name,fn});
async function open(data=sample(),options={}) {
  const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1280,height:1000},...options});
  context.setDefaultTimeout(10000);
  context.on('page',page=>page.on('pageerror',e=>runtimeErrors.push(e.message)));
  const errors=[],requests=[];
  await context.route('**/*',route=>{
    if(route.request().url().startsWith(TEST_URL))return route.continue();
    requests.push({url:route.request().url(),method:route.request().method()});return route.abort();
  });
  await context.addInitScript(({data,stateKey,origin})=>{
    if(location.origin!==origin||!['http:','https:'].includes(location.protocol))return;
    if(!localStorage.getItem('rentalIndependent20261009.'+stateKey))localStorage.setItem('rentalIndependent20261009.'+stateKey,JSON.stringify(data));
  },{data,stateKey:core.STATE_KEY,origin:new URL(TEST_URL).origin});
  const page=await context.newPage();
  page.on('dialog',d=>d.accept());page.on('pageerror',e=>errors.push(e.message));
  await page.goto(TEST_URL);await page.locator('#section-home.active').waitFor();
  return {page,context,errors,requests};
}
async function history(page,id='audit1',billMonth=past,edit=false) {
  await page.evaluate(({id,billMonth})=>goToBill(id,billMonth),{id,billMonth});
  if(edit)await page.evaluate(()=>editThisMonth());
  await page.locator(edit?'#bill-total-display':'#hist-content').waitFor();
}
async function exportBackup(page) {
  const pending=page.waitForEvent('download');await page.evaluate(()=>exportData());
  const file=await pending;return JSON.parse(fs.readFileSync(await file.path(),'utf8'));
}
async function failStorage(page,storageKey) {
  await page.evaluate(storageKey=>{
    window.originalStorageWrite=Storage.prototype.setItem;
    Storage.prototype.setItem=function(key,value){
      if(key===storageKey)throw new DOMException('test quota','QuotaExceededError');
      return window.originalStorageWrite.call(this,key,value);
    };
  },"rentalIndependent20261009."+storageKey);
}
test('failed bill save preserves committed data and exports unsaved input',async()=>{
  const {page}=await open();await history(page,'audit1',past,true);
  const before=await page.evaluate(()=>localStorage.getItem('rentalIndependent20261009.'+RentalCore.STATE_KEY));
  await page.locator('#bill-electricity').fill('45678');await failStorage(page,core.STATE_KEY);
  await page.evaluate(()=>saveBill());
  assert.equal(await page.evaluate(()=>localStorage.getItem('rentalIndependent20261009.'+RentalCore.STATE_KEY)),before);
  assert.equal(await page.evaluate(past=>bills[past].audit1.electricity,past),35000);
  assert.equal(await page.locator('#bill-electricity').inputValue(),'45678');
  assert.equal((await exportBackup(page)).bills[past].audit1.electricity,45678);
  assert.match(await page.locator('#data-notice').innerText(),/저장하지 못해/);
});
test('reset and recovery round trip retains unfinished bill drafts',async()=>{
  const {page}=await open();await history(page,'audit1',past,true);
  await page.locator('#bill-electricity').fill('65432');
  await page.evaluate(()=>flushBillDraft());await page.evaluate(()=>resetAllData());
  await restoreRecoveryV2(page);await history(page,'audit1',past,true);
  assert.equal(await page.locator('#bill-electricity').inputValue(),'65432');
});
test('imported drafts remain exportable and warning visible when draft storage fails',async()=>{
  const {page}=await open();
  const draftKey=past+':audit1';
  const baseline=await page.evaluate(past=>JSON.stringify(bills[past].audit1),past);
  const drafts={[draftKey]:{fields:{electricity:'54321'},baseline,updatedAt:new Date().toISOString()}};
  await failStorage(page,'rentalApp.billDrafts.v1');
  await page.evaluate(({drafts})=>replaceData(currentData(),'test import',drafts),{drafts});
  assert.match(await page.locator('#data-notice').innerText(),/초안/);
  assert.equal((await exportBackup(page)).localDrafts[draftKey].fields.electricity,'54321');
});
test('cloud import recovery retains the local draft it replaced',async()=>{
  const {page,context}=await open();await history(page,'audit1',past,true);
  await page.locator('#bill-electricity').fill('77777');await page.evaluate(()=>flushBillDraft());
  await context.route('https://script.google.com/**',r=>r.fulfill({json:{status:'ok',data:core.empty()}}));
  await page.evaluate(()=>{void syncFromSheet();});await applyCloudImport(page);await restoreRecoveryV2(page);
  await history(page,'audit1',past,true);assert.equal(await page.locator('#bill-electricity').inputValue(),'77777');
});
test('orphan historical bill supports receipt confirmation and reload',async()=>{
  const data=sample();data.tenants=[];const {page}=await open(data);
  await history(page);await page.evaluate(()=>stampBill('rent'));
  await page.locator('#stamp-date').fill(receipt.replaceAll('.','-'));await page.evaluate(()=>saveStamp());
  assert.equal(await page.evaluate(past=>bills[past].audit1.stampedRent,past),true);
  await page.reload();assert.equal(await page.evaluate(past=>bills[past].audit1.stampedRentDate,past),receipt);
});
test('re-settlement invalidates changed receipts but retains unaffected payments',async()=>{
  const data=sample();data.bills[key]={audit1:billing.freezeBill(tenant,{water:10000,electricity:35000,elevatorTotal:50000,waste:1000,stampedMgmt:true,stampedMgmtDate:receipt,stampedRent:true,stampedRentDate:receipt,invoiceIssued:true},key)};
  const {page}=await open(data);await navigateV2(page,'settlement');
  await page.locator('#sett-elev').fill('60000');await page.locator('#sett-waste').fill('1000');
  await page.evaluate(()=>calcSettlement());await page.evaluate(()=>confirmSettlement());
  const state=await page.evaluate(()=>RentalBilling.payment(tenants[0],bills[mk()].audit1));
  assert.equal(state.items.pay_elev.paid,false);assert.equal(state.items.pay_elec.paid,true,JSON.stringify(state));
  assert.equal(state.items.pay_mgmt.paid,true,JSON.stringify(state));assert.equal(state.items.pay_rent.paid,true);
  assert.equal(await page.evaluate(()=>bills[mk()].audit1.invoiceIssued),false);
  assert.equal(await page.evaluate(()=>settInputs[mk()].confirmed),true);
});
test('individual payment edit under group stamp preserves other receipt dates',async()=>{
  const data=sample();Object.assign(data.bills[past].audit1,{stampedMgmt:true,stampedMgmtDate:receipt});
  const {page}=await open(data);await history(page,'audit1',past,true);
  const earlier=`${year-1}.02.14`;
  await page.evaluate(date=>updatePay('pay_water','date',date),earlier);
  const state=await page.evaluate(past=>RentalBilling.payment(tenants[0],bills[past].audit1),past);
  assert.equal(state.items.pay_water.date,earlier);assert.equal(state.items.pay_elec.date,receipt);
  await page.reload();assert.equal(await page.evaluate(past=>bills[past].audit1.paid.pay_water.date,past),earlier);
});
test('archiving retains historical totals and excludes tenant from new settlements',async()=>{
  const {page}=await open();const total=await page.evaluate(()=>RentalBilling.arrears(tenants,bills).total);
  await page.evaluate(()=>deleteTenant('audit1'));assert.equal(await page.evaluate(()=>activeTenants().length),0);
  assert.equal(await page.evaluate(()=>RentalBilling.arrears(tenants,bills).total),total);
  await history(page);assert.match(await page.locator('#hist-content').innerText(),/검증 업체/);
  await page.reload();assert.equal(await page.evaluate(()=>tenants[0].archived),true);
});
test('legacy cloud server blocks POST without losing local changes',async()=>{
  const {page,context}=await open();const methods=[];
  await context.route('https://script.google.com/**',r=>{methods.push(r.request().method());return r.fulfill({json:{status:'ok',data:sample()}});});
  await page.evaluate(async()=>{setCloudEnabled(true);tenants[0].name='local retained';await save();await manualSync();});
  assert.deepEqual(methods,['GET']);assert.match(await page.locator('#data-notice').innerText(),/버전 비교/);
  await page.reload();assert.equal(await page.evaluate(()=>tenants[0].name),'local retained');
  assert.equal(await page.evaluate(()=>cloudDirty),true);
});
test('remote revision conflict blocks POST and retains pending state across reload',async()=>{
  const data=sample();data.localMeta={cloudPending:true,cloudBaseRevision:'r1'};
  const {page,context}=await open(data);const methods=[];
  await context.route('https://script.google.com/**',r=>{methods.push(r.request().method());return r.fulfill({json:{status:'ok',data:sample(),revision:'r2',capabilities:{conditionalWrite:true}}});});
  await page.evaluate(async()=>{setCloudEnabled(true);await manualSync();});
  assert.deepEqual(methods,['GET']);assert.match(await page.locator('#data-notice').innerText(),/다른 기기/);
  await page.reload();assert.equal(await page.evaluate(()=>cloudDirty),true);
});
test('unverified cloud acknowledgement never reports saved',async()=>{
  const data=sample();data.localMeta={cloudPending:true,cloudBaseRevision:'r1'};
  const {page,context}=await open(data);
  await context.route('https://script.google.com/**',r=>r.fulfill({json:r.request().method()==='GET'?{status:'ok',data:sample(),revision:'r1',capabilities:{conditionalWrite:true}}:{status:'ok',revision:'r2',requestId:'wrong-id',capabilities:{conditionalWrite:true}}}));
  await page.evaluate(async()=>{setCloudEnabled(true);await manualSync();});
  assert.match(await page.locator('#data-notice').innerText(),/검증하지 못/);
  assert.equal(await page.evaluate(()=>cloudDirty),true);await page.reload();assert.equal(await page.evaluate(()=>cloudDirty),true);
});
test('cloud response cannot replace an unsaved form edited during download',async()=>{
  const {page,context}=await open();await history(page,'audit1',past,true);
  let release,entered;const started=new Promise(r=>entered=r),wait=new Promise(r=>release=r);
  await context.route('https://script.google.com/**',async r=>{entered();await wait;await r.fulfill({json:{status:'ok',data:core.empty()}});});
  await page.evaluate(()=>{void syncFromSheet();});await started;
  await page.locator('#bill-electricity').fill('88888');release();
  await page.waitForFunction(()=>!syncBusy);
  assert.equal(await page.locator('#bill-electricity').inputValue(),'88888');
  assert.equal(await page.evaluate(()=>tenants.length),1);assert.match(await page.locator('#data-notice').innerText(),/편집/);
});
test('simultaneous tab saves accept one writer and retain the losing candidate for export',async()=>{
  const {page,context}=await open(),other=await context.newPage();other.on('dialog',d=>d.accept());
  await other.goto(TEST_URL);await other.locator('#section-home.active').waitFor();
  const result=await Promise.all([page.evaluate(async()=>{tenants[0].name='writer A';return save();}),other.evaluate(async()=>{tenants[0].name='writer B';return save();})]);
  assert.equal(result.filter(Boolean).length,1);
  const loser=result[0]?other:page;const expected=result[0]?'writer B':'writer A';
  assert.equal((await exportBackup(loser)).tenants[0].name,expected);
});
test('stale drafts are retained for export without overwriting newer saved bills',async()=>{
  const {page}=await open();await history(page,'audit1',past,true);
  await page.locator('#bill-electricity').fill('99999');await page.evaluate(()=>flushBillDraft());
  await page.evaluate(async past=>{bills[past].audit1.electricity=22222;await save();},past);
  await page.reload();await history(page,'audit1',past,true);
  assert.equal(await page.locator('#bill-electricity').inputValue(),'22222');
  assert.match(await page.locator('#bill-draft-state').innerText(),/자동 적용하지/);
  assert.equal((await exportBackup(page)).localDrafts[past+':audit1'].fields.electricity,'99999');
});
test('failed receipt date save restores the receipt field and keeps amount input',async()=>{
  const {page}=await open();await history(page,'audit1',past,true);
  await page.locator('#bill-electricity').fill('45678');await failStorage(page,core.STATE_KEY);
  const input=page.locator('input[onchange*="pay_water"]');
  await input.fill(receipt);await input.press('Tab');
  await page.waitForFunction(()=>!persistenceBusy&&!!storageFault);
  assert.equal(await input.inputValue(),'');
  assert.equal(await page.locator('#bill-electricity').inputValue(),'45678');
});
test('failed receipt invoice save restores the visible checkbox',async()=>{
  const {page}=await open();await history(page);await failStorage(page,core.STATE_KEY);
  const input=page.locator('.invoice-check input');await input.check();
  await page.waitForFunction(()=>!persistenceBusy&&!!storageFault);
  assert.equal(await input.isChecked(),false);
});
test('CSV escapes formula-like tenant names and uses historical identity',async()=>{
  const data=sample();data.tenants[0].name='=2+3';data.tenants[0].biz='';
  data.bills[key]={audit1:billing.freezeBill(data.tenants[0],{rent:100000,mgmt:10000},key)};
  const {page}=await open(data);await page.evaluate(()=>{tenants[0].name='changed';});
  const pending=page.waitForEvent('download');await page.evaluate(()=>exportMonthCsv());
  const file=await pending;const csv=fs.readFileSync(await file.path(),'utf8');
  assert.ok(csv.includes('"\'=2+3"'));assert.ok(!csv.includes('changed'));assert.ok(csv.includes('110000'));
});
test('settlement draft backup restores inputs and remains exportable after storage failure',async()=>{
 const {page}=await open();await navigateV2(page,'settlement');await page.locator('#sett-elec').fill('76543');const backup=await exportBackup(page);assert.equal(backup.localSettlementDrafts[key].fields['sett-elec'].value,'76543');assert.equal(core.validateData(backup).localSettlementDrafts,undefined);await page.evaluate(()=>resetAllData());await restoreRecoveryV2(page);await navigateV2(page,'settlement');assert.equal(await page.locator('#sett-elec').inputValue(),'76543');await failStorage(page,'rentalApp.settlementDrafts.v2');await page.evaluate(async backup=>replaceData(RentalCore.validateData(backup),'정산 초안 격리 복원',{},backup.localSettlementDrafts),backup);assert.match(await page.locator('#data-notice').innerText(),/초안을 저장하지 못/);assert.equal((await exportBackup(page)).localSettlementDrafts[key].fields['sett-elec'].value,'76543');
});

test('backup replacement waits for visible review and cancel preserves current data',async()=>{
 const {page}=await open();const before=await page.evaluate(()=>currentData());const incoming=sample();incoming.tenants[0].name='복원할 익명 자료';await page.locator('#import-file').setInputFiles({name:'review.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(incoming))});await page.waitForTimeout(150);assert.deepEqual(await page.evaluate(()=>currentData()),before);await page.locator('#modal-data-replacement.open').waitFor();assert.match(await page.locator('#replacement-details').innerText(),/복원할 익명 자료/);await page.getByRole('button',{name:'취소',exact:true}).click();assert.deepEqual(await page.evaluate(()=>currentData()),before);
});

test('backup replacement applies only after review and keeps complete undo data on PC and mobile',async()=>{
 for(const viewport of [{width:1366,height:768},{width:390,height:844}]){
  const {page}=await open(sample(),{viewport});const before=await page.evaluate(()=>currentData());const incoming=sample();incoming.tenants[0].name='<img src=x onerror="window.reviewInjection=1">';incoming.tenants[0].audit=[{at:'2026-10-10',action:'검증',detail:'보증금 이력',changes:{deposit:{from:null,to:0}}}];incoming.futureFields={nullValue:null,blank:'',zero:0};
  await page.locator('#import-file').setInputFiles({name:'verified.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(incoming))});await page.locator('#modal-data-replacement.open').waitFor();assert.equal(await page.locator('#replacement-details img').count(),0);assert.equal(await page.evaluate(()=>window.reviewInjection),undefined);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  await page.locator('.replacement-review').evaluate(async el=>{await Promise.all(el.getAnimations().map(a=>a.finished));});await page.screenshot({path:path.join(out,'backup-review-'+viewport.width+'.png'),fullPage:false});await applyReplacement(page);assert.deepEqual(await page.evaluate(()=>currentData()),core.validateData(incoming));assert.deepEqual(await page.evaluate(()=>RentalCore.validateData(JSON.parse(appStorage.getItem(RentalCore.BACKUP_KEY)))),before);
  await page.reload();assert.deepEqual(await page.evaluate(()=>currentData()),core.validateData(incoming));await restoreRecoveryV2(page);assert.deepEqual(await page.evaluate(()=>currentData()),before);
 }
});

test('backup replacement rejects edits and another tab changing the reviewed baseline',async()=>{
 for(const mode of ['input','data','other-tab']){
  const {page,context}=await open();const incoming=sample();incoming.tenants[0].name='복원 후보';await page.locator('#import-file').setInputFiles({name:'stale.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(incoming))});await page.locator('#modal-data-replacement.open').waitFor();
  let other;
  if(mode==='input')await page.evaluate(()=>{draftVersion++;});
  if(mode==='data')await page.evaluate(()=>{tenants[0].name='미리보기 중 현재 수정';});
  if(mode==='other-tab'){other=await context.newPage();await other.goto(TEST_URL);await other.evaluate(async()=>{tenants[0].name='다른 창의 최신 자료';await save();});await page.waitForFunction(()=>conflictingTab);}
  const raw=await page.evaluate(()=>appStorage.getItem(RentalCore.STATE_KEY));await applyReplacement(page);assert.equal(await page.evaluate(()=>appStorage.getItem(RentalCore.STATE_KEY)),raw);assert.notEqual(await page.evaluate(()=>tenants[0].name),'복원 후보');if(other)await other.close();
 }
});

test('backup replacement Escape cancels and cloud synchronization stays paused while reviewing',async()=>{
 const {page,requests}=await open();const before=await page.evaluate(()=>currentData());const incoming=sample();incoming.tenants[0].name='취소할 후보';await page.locator('#import-file').setInputFiles({name:'cancel.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(incoming))});await page.locator('#modal-data-replacement.open').waitFor();await page.evaluate(async()=>{cloudEnabled=true;cloudDirty=true;await doSync();await checkBackgroundCloudSync();});assert.equal(requests.length,0);await page.keyboard.press('Escape');await page.locator('#modal-data-replacement.open').waitFor({state:'hidden'});assert.deepEqual(await page.evaluate(()=>currentData()),before);assert.equal(await page.evaluate(()=>replacementReview),null);
});

test('backup replacement keeps its review open while waiting for a lock and preserves data on quota failure',async()=>{
 const {page}=await open();const before=await page.evaluate(()=>currentData());const incoming=sample();incoming.tenants[0].name='실패할 복원 후보';await page.locator('#import-file').setInputFiles({name:'quota.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(incoming))});await page.locator('#modal-data-replacement.open').waitFor();
 await page.evaluate(()=>{window.reviewLockEntered=false;void navigator.locks.request('rentalIndependent20261009.rentalApp.write',()=>new Promise(resolve=>{window.releaseReviewLock=resolve;window.reviewLockEntered=true;}));});await page.waitForFunction(()=>window.reviewLockEntered);await page.getByRole('button',{name:'이 백업으로 복원',exact:true}).click();await page.waitForFunction(()=>persistenceBusy);assert.equal(await page.locator('#replacement-cancel').isDisabled(),true);assert.equal(await page.locator('#modal-data-replacement.open').isVisible(),true);assert.deepEqual(await page.evaluate(()=>currentData()),before);await page.keyboard.press('Escape');assert.equal(await page.locator('#modal-data-replacement.open').isVisible(),true);
 await failStorage(page,core.STATE_KEY);await page.evaluate(()=>window.releaseReviewLock());await page.locator('#modal-data-replacement.open').waitFor({state:'hidden'});assert.deepEqual(await page.evaluate(()=>currentData()),before);assert.equal(await page.evaluate(()=>replacementReview),null);
});

test('backup replacement review keeps its actions visible across six viewports and 200 percent text',async()=>{
 for(const [width,height] of [[360,800],[390,844],[412,915],[768,1024],[1366,768],[1920,1080]]){
  for(const size of ['100%','200%']){const {page,context}=await open(sample(),{viewport:{width,height}});await page.evaluate(size=>{document.documentElement.style.fontSize=size;},size);const incoming=sample();incoming.tenants[0].name='복원 확인용 예시';incoming.futureFields={nullValue:null,blank:'',zero:0};await page.locator('#import-file').setInputFiles({name:'예시백업.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(incoming))});await page.locator('#modal-data-replacement.open').waitFor();await page.locator('.replacement-review').evaluate(async el=>{await Promise.all(el.getAnimations().map(a=>a.finished));});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));for(const id of ['replacement-cancel','replacement-backup','replacement-apply']){const r=await page.locator('#'+id).boundingBox();assert.ok(r.y>=0&&r.y+r.height<=height+1,'action outside viewport '+width+' '+size+' '+id);assert.ok(r.height>=44);}
   if(size==='100%'&&(width===390||width===1366))await page.screenshot({path:path.join(out,'backup-review-clean-'+width+'.png'),fullPage:false});await page.getByRole('button',{name:'취소',exact:true}).click();await context.close();}
 }
});

test('backup replacement counts valid drafts and keeps legacy domain data when draft metadata is malformed',async()=>{
 const {page}=await open();const incoming=sample();incoming.localSettlementDrafts='x'.repeat(200000);await page.locator('#import-file').setInputFiles({name:'old-backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(incoming))});await page.locator('#modal-data-replacement.open').waitFor();assert.match(await page.locator('.replacement-body').innerText(),/초안 0개/);await applyReplacement(page);assert.deepEqual(await page.evaluate(()=>currentData()),core.validateData(incoming));assert.deepEqual(await page.evaluate(()=>readSettlementDrafts()),{});
});

test('Google import review waits for consent and cancellation preserves the entire local state',async()=>{
 const data=sample();data.localMeta={cloudPending:true,cloudBaseRevision:'before-review'};
 const {page,context}=await open(data),methods=[];const incoming=sample();incoming.tenants[0].name='Google 비교 예시';
 await history(page,'audit1',past,true);await page.locator('#bill-electricity').fill('65432');await page.evaluate(()=>{flushBillDraft();cloudEnabled=true;appStorage.setItem('rentalApp.pendingCloudRequest.v2','{"requestId":"cancel-retained"}');});
 await context.route('https://script.google.com/**',route=>{methods.push(route.request().method());return route.fulfill({json:{status:'ok',data:incoming,revision:'remote-review',capabilities:{conditionalWrite:true}}});});
 const before=await page.evaluate(()=>({domain:currentData(),state:appStorage.getItem(RentalCore.STATE_KEY),recovery:appStorage.getItem(RentalCore.BACKUP_KEY),base:cloudBaseRevision,dirty:cloudDirty,drafts:collectBillDrafts(),pending:appStorage.getItem('rentalApp.pendingCloudRequest.v2')}));
 await page.evaluate(()=>{void syncFromSheet();});
 await page.locator('#modal-data-replacement.open').waitFor({timeout:3000});
 assert.match(await page.locator('.replacement-body').innerText(),/Google 비교 예시/);
 assert.deepEqual(await page.evaluate(()=>currentData()),before.domain);
 await page.getByRole('button',{name:'취소',exact:true}).click();await page.waitForFunction(()=>!syncBusy);
 assert.deepEqual(await page.evaluate(()=>({domain:currentData(),state:appStorage.getItem(RentalCore.STATE_KEY),recovery:appStorage.getItem(RentalCore.BACKUP_KEY),base:cloudBaseRevision,dirty:cloudDirty,drafts:collectBillDrafts(),pending:appStorage.getItem('rentalApp.pendingCloudRequest.v2')})),before);
 await page.waitForTimeout(2200);
 assert.deepEqual(methods,['GET']);
});

test('Google import review accepts a rechecked snapshot with undo drafts and safe next upload',async()=>{
 for(const width of [390,1366]){
  const initial=sample();initial.localMeta={cloudPending:true,cloudBaseRevision:'old-google'};
  const {page,context}=await open(initial,{viewport:{width,height:844}});await history(page,'audit1',past,true);await page.locator('#bill-electricity').fill('54321');await page.evaluate(()=>{flushBillDraft();cloudEnabled=true;});
  const before=await page.evaluate(()=>currentData()),incoming=sample();incoming.tenants[0].name='Google 검토 후 적용';incoming.extension={zero:0,blank:'',missing:null};incoming.bills[past].audit1.unknownReceipt={from:null,to:0};
  const methods=[],writes=[];let remoteRevision='verified-google';
  await context.route('https://script.google.com/**',route=>{
   methods.push(route.request().method());if(route.request().method()==='GET')return route.fulfill({json:{status:'ok',data:incoming,revision:remoteRevision,capabilities:{conditionalWrite:true}}});
   const body=route.request().postDataJSON();writes.push(body);remoteRevision='uploaded-google';return route.fulfill({json:{status:'ok',requestId:body.requestId,revision:remoteRevision,capabilities:{conditionalWrite:true},docs:{status:'error',message:'모의 문서 권한 오류'}}});
  });
  await page.evaluate(()=>{void syncFromSheet();});await page.locator('#modal-data-replacement.open').waitFor();
  assert.match(await page.locator('#modal-data-replacement .modal-title').innerText(),/Google 자료 불러오기 검토/);
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'현재 자료 백업',exact:true}).click();const file=await download;const reviewedBackup=JSON.parse(fs.readFileSync(await file.path(),'utf8'));assert.deepEqual(core.validateData(reviewedBackup),core.validateData(before));assert.equal(reviewedBackup.localDrafts[past+':audit1'].fields.electricity,'54321');
  await applyCloudImport(page);assert.deepEqual(methods.slice(0,2),['GET','GET']);assert.ok(methods.every(method=>method==='GET'));assert.deepEqual(await page.evaluate(()=>currentData()),core.validateData(incoming));
  assert.equal(await page.evaluate(()=>cloudBaseRevision),'verified-google');assert.equal(await page.evaluate(()=>cloudDirty),false);assert.deepEqual(await page.evaluate(()=>collectBillDrafts()),{});
  const undo=await page.evaluate(()=>JSON.parse(appStorage.getItem(RentalCore.BACKUP_KEY)));assert.deepEqual(core.validateData(undo),core.validateData(before));assert.equal(undo.localDrafts[past+':audit1'].fields.electricity,'54321');
  await page.reload();assert.deepEqual(await page.evaluate(()=>currentData()),core.validateData(incoming));assert.equal(await page.evaluate(()=>cloudBaseRevision),'verified-google');
  await page.evaluate(async()=>{cloudEnabled=true;tenants[0].name='명시적 다음 저장';await save();await manualSync();});assert.equal(writes.length,1);assert.equal(writes[0].expectedRevision,'verified-google');assert.equal(writes[0].data.tenants[0].name,'명시적 다음 저장');assert.equal(await page.evaluate(()=>cloudDirty),false);assert.match(await page.locator('#current-status-notice').innerText(),/DB 저장은 완료/);
  await restoreRecoveryV2(page);assert.deepEqual(await page.evaluate(()=>currentData()),core.validateData(before));await history(page,'audit1',past,true);assert.equal(await page.locator('#bill-electricity').inputValue(),'54321');await context.close();
 }
});

test('Google import review rejects changed remote revision payload and server capabilities',async()=>{
 for(const mode of ['revision','payload','legacy-payload','capabilities']){
  const {page,context}=await open(),incoming=sample();incoming.tenants[0].name='서버 검토 예시';let reads=0;const methods=[];
  await context.route('https://script.google.com/**',route=>{methods.push(route.request().method());reads++;const data=structuredClone(incoming);if(reads>1&&mode.includes('payload'))data.tenants[0].name='검토 후 서버 변경';const safe=mode!=='legacy-payload'&&!(reads>1&&mode==='capabilities');return route.fulfill({json:{status:'ok',data,...(safe?{revision:reads>1&&mode==='revision'?'new-remote':'same-remote',capabilities:{conditionalWrite:true}}:{})}});});
  const before=await page.evaluate(()=>({domain:currentData(),state:appStorage.getItem(RentalCore.STATE_KEY),backup:appStorage.getItem(RentalCore.BACKUP_KEY)}));
  await page.evaluate(()=>{void syncFromSheet();});await applyCloudImport(page);assert.match(await page.locator('#data-notice').innerText(),/Google 자료가 변경/);assert.deepEqual(await page.evaluate(()=>({domain:currentData(),state:appStorage.getItem(RentalCore.STATE_KEY),backup:appStorage.getItem(RentalCore.BACKUP_KEY)})),before);assert.deepEqual(methods,['GET','GET']);await context.close();
 }
});

test('Google import review rejects form edits and another tab during revalidation',async()=>{
 for(const mode of ['review-input','verification-input','verification-tab']){
  const {page,context}=await open();await history(page,'audit1',past,true);const incoming=sample();incoming.tenants[0].name='미적용 서버 예시';let reads=0,release,entered;const waiting=new Promise(r=>release=r),started=new Promise(r=>entered=r);
  await context.route('https://script.google.com/**',async route=>{reads++;if(reads===2){entered();await waiting;}return route.fulfill({json:{status:'ok',data:incoming,revision:'same-remote',capabilities:{conditionalWrite:true}}});});
  await page.evaluate(()=>{void syncFromSheet();});await page.locator('#modal-data-replacement.open').waitFor();
  if(mode==='review-input')await page.evaluate(()=>{const el=document.getElementById('bill-electricity');el.value='67890';el.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.getByRole('button',{name:'Google 자료 적용',exact:true}).click();
  if(mode!=='review-input'){
   await started;
   if(mode==='verification-input')await page.evaluate(()=>{const el=document.getElementById('bill-electricity');el.value='67890';el.dispatchEvent(new Event('input',{bubbles:true}));});
   else {const other=await context.newPage();await other.goto(TEST_URL);await other.locator('.section.active').waitFor();await other.evaluate(async()=>{tenants[0].name='다른 창 보존';await save();});}
   release();
  }
  await page.waitForFunction(()=>!syncBusy);assert.equal(await page.evaluate(()=>tenants[0].name),tenant.name);assert.match(await page.locator('#data-notice').innerText(),/입력|편집|다른 창/);
  if(mode!=='verification-tab')assert.equal(await page.locator('#bill-electricity').inputValue(),'67890');else assert.equal(await page.evaluate(()=>RentalCore.load(appStorage).data.tenants[0].name),'다른 창 보존');
  assert.equal(reads,mode==='review-input'?1:2);await context.close();
 }
});

test('Google import review retains data for lock wait edits and failed storage writes',async()=>{
 for(const mode of ['lock-edit','quota','backup-quota']){
  const {page,context}=await open(),incoming=sample();incoming.tenants[0].name='저장 실패 서버 예시';await context.route('https://script.google.com/**',route=>route.fulfill({json:{status:'ok',data:incoming,revision:'same-remote',capabilities:{conditionalWrite:true}}}));
  const before=await page.evaluate(()=>({domain:currentData(),state:appStorage.getItem(RentalCore.STATE_KEY)}));await page.evaluate(()=>{void syncFromSheet();});await page.locator('#modal-data-replacement.open').waitFor();
  await page.evaluate(()=>{window.cloudReviewLock=false;void navigator.locks.request('rentalIndependent20261009.rentalApp.write',()=>new Promise(resolve=>{window.releaseCloudReviewLock=resolve;window.cloudReviewLock=true;}));});await page.waitForFunction(()=>window.cloudReviewLock);
  await page.getByRole('button',{name:'Google 자료 적용',exact:true}).click();await page.waitForFunction(()=>persistenceBusy);assert.equal(await page.locator('#replacement-cancel').isDisabled(),true);await page.keyboard.press('Escape');assert.equal(await page.locator('#modal-data-replacement.open').isVisible(),true);
  if(mode==='lock-edit')await page.evaluate(()=>{draftVersion++;});else await failStorage(page,mode==='quota'?core.STATE_KEY:core.BACKUP_KEY);
  await page.evaluate(()=>window.releaseCloudReviewLock());await page.waitForFunction(()=>!syncBusy);assert.deepEqual(await page.evaluate(()=>({domain:currentData(),state:appStorage.getItem(RentalCore.STATE_KEY)})),before);assert.match(await page.locator('#data-notice').innerText(),/실패/);assert.equal(await page.evaluate(()=>replacementReview),null);await context.close();
 }
});

test('Google import review closes on failed downloads and invalid remote data',async()=>{
 for(const mode of ['first-invalid','second-invalid','second-network']){
  const {page,context}=await open(),incoming=sample();let reads=0;await context.route('https://script.google.com/**',route=>{reads++;if(reads===2&&mode==='second-network')return route.abort();return route.fulfill({json:{status:'ok',data:(reads===1&&mode==='first-invalid')||(reads===2&&mode==='second-invalid')?{tenants:{},bills:[]}:incoming,revision:'same-remote',capabilities:{conditionalWrite:true}}});});
  const before=await page.evaluate(()=>({domain:currentData(),state:appStorage.getItem(RentalCore.STATE_KEY),backup:appStorage.getItem(RentalCore.BACKUP_KEY)}));await page.evaluate(()=>{void syncFromSheet();});if(mode!=='first-invalid')await applyCloudImport(page);await page.waitForFunction(()=>!syncBusy);assert.deepEqual(await page.evaluate(()=>({domain:currentData(),state:appStorage.getItem(RentalCore.STATE_KEY),backup:appStorage.getItem(RentalCore.BACKUP_KEY)})),before);assert.match(await page.locator('#data-notice').innerText(),/불러오기 실패/);assert.equal(await page.evaluate(()=>replacementReview),null);await context.close();
 }
});

test('Google import review shows identical data draft effects and legacy read only warning',async()=>{
 const {page,context}=await open();await history(page,'audit1',past,true);await page.locator('#bill-electricity').fill('12345');await page.evaluate(()=>flushBillDraft());await navigateV2(page,'settlement');await page.locator('#sett-elec').fill('43210');await page.evaluate(()=>captureSettlementDraft());const settlementDrafts=await page.evaluate(()=>readSettlementDrafts());const incoming=await page.evaluate(()=>currentData()),methods=[];
 await context.route('https://script.google.com/**',route=>{methods.push(route.request().method());return route.fulfill({json:{status:'ok',data:incoming}});});await page.evaluate(()=>{void syncFromSheet();});await page.locator('#modal-data-replacement.open').waitFor();assert.match(await page.locator('.replacement-body').innerText(),/임대 자료는 동일/);assert.match(await page.locator('.replacement-body').innerText(),/고지서 초안을 비웁니다/);assert.match(await page.locator('.replacement-body').innerText(),/업로드는 차단/);await applyCloudImport(page);assert.equal(await page.evaluate(()=>cloudBaseRevision),null);assert.match(await page.locator('#data-notice').innerText(),/업로드는 차단/);assert.equal(await page.evaluate(()=>JSON.parse(appStorage.getItem(RentalCore.BACKUP_KEY)).localDrafts[Object.keys(JSON.parse(appStorage.getItem(RentalCore.BACKUP_KEY)).localDrafts)[0]].fields.electricity),'12345');assert.deepEqual(await page.evaluate(()=>readSettlementDrafts()[mk()].fields),settlementDrafts[key].fields);assert.deepEqual(await page.evaluate(()=>JSON.parse(appStorage.getItem(RentalCore.BACKUP_KEY)).localSettlementDrafts[mk()].fields),settlementDrafts[key].fields);await page.evaluate(async()=>{cloudEnabled=true;tenants[0].name='로컬 수정';await save();await manualSync();});assert.ok(methods.every(method=>method==='GET'));assert.equal(await page.evaluate(()=>cloudDirty),true);
});

test('Google import review keeps actions visible across six viewports and cancels by Escape',async()=>{
 for(const [width,height] of [[360,800],[390,844],[412,915],[768,1024],[1366,768],[1920,1080]])for(const size of ['100%','200%']){
  const {page,context}=await open(sample(),{viewport:{width,height}}),incoming=sample();incoming.tenants[0].name='Google 변경 비교 예시';incoming.tenants[0].rent=120000;await context.route('https://script.google.com/**',route=>route.fulfill({json:{status:'ok',data:incoming,revision:'same-remote',capabilities:{conditionalWrite:true}}}));await page.evaluate(size=>{document.documentElement.style.fontSize=size;void syncFromSheet();},size);await page.locator('#modal-data-replacement.open').waitFor();await page.locator('.replacement-review').evaluate(async el=>{await Promise.all(el.getAnimations().map(a=>a.finished));});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'cloud overflow '+width+' '+size);for(const id of ['replacement-cancel','replacement-backup','replacement-apply']){const r=await page.locator('#'+id).boundingBox();assert.ok(r.y>=0&&r.y+r.height<=height+1,width+' '+size+' '+id);assert.ok(r.height>=44);}if(width<=560)assert.ok(await page.locator('#replacement-details').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'comparison needs horizontal panning '+width+' '+size);if(size==='100%'&&(width===390||width===1366))await page.screenshot({path:path.join(out,'cloud-review-clean-'+width+'.png'),fullPage:false});await page.keyboard.press('Escape');await page.waitForFunction(()=>!syncBusy);assert.equal(await page.evaluate(()=>tenants[0].name),tenant.name);await context.close();
 }
});

(async()=>{
  browser=await chromium.launch({headless:true,executablePath:process.env.RENTAL_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try {
    for(const {name,fn} of cases.filter(c=>!process.env.RENTAL_CASE||c.name.includes(process.env.RENTAL_CASE))){
      runtimeErrors=[];
      try{await fn();assert.deepEqual(runtimeErrors,[]);results.push({name,status:'pass'});console.log('PASS '+name);}
      catch(error){results.push({name,status:'fail',error:error.stack});console.error('FAIL '+name+': '+error.message);}
      finally{await Promise.all(browser.contexts().map(c=>c.close()));}
    }
  } finally {
    await browser.close();fs.writeFileSync(path.join(out,'audit-browser-results.json'),JSON.stringify(results,null,2));
  }
  if(results.some(r=>r.status==='fail'))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
