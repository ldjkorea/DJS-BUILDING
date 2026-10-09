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

test('draft recovery preserves malformed local text before subsequent draft writes',async()=>{
 const {page}=await open();const raw='{broken draft text';
 await page.evaluate(raw=>appStorage.setItem(DRAFT_KEY,raw),raw);await history(page,'audit1',past,true);
 await page.locator('#bill-electricity').fill('65432');await page.evaluate(()=>flushBillDraft());
 const backup=await exportBackup(page);assert.ok(backup.localMeta?.draftRecovery?.entries.some(entry=>entry.source==='bill'&&entry.raw===raw));
 assert.equal(backup.localDrafts[past+':audit1'].fields.electricity,'65432');assert.equal(await page.evaluate(past=>bills[past].audit1.electricity,past),35000);
});

test('draft recovery reads mixed records without writing and preserves unsupported values on update',async()=>{
 const {page}=await open();const baseline=await page.evaluate(past=>JSON.stringify(bills[past].audit1),past);
 const mixed={[past+':audit1']:{fields:{electricity:'54321',futureInput:0},baseline,updatedAt:'old',futureValue:{null:null}},invalid:{fields:[]}};
 const raw=JSON.stringify(mixed);await page.evaluate(raw=>appStorage.setItem(DRAFT_KEY,raw),raw);await history(page,'audit1',past,true);
 assert.equal(await page.locator('#bill-electricity').inputValue(),'54321');assert.equal(await page.evaluate(()=>appStorage.getItem(DRAFT_KEY)),raw);assert.equal(await page.evaluate(()=>storedDraftRecovery().length),0);
 assert.match(await page.locator('#draft-recovery-notice').innerText(),/지원하지 않는/);await page.locator('#bill-electricity').fill('67890');await page.evaluate(()=>flushBillDraft());
 await page.reload();const backup=await exportBackup(page);assert.ok(backup.localMeta.draftRecovery.entries.some(entry=>entry.source==='bill'&&entry.raw===raw));assert.equal(backup.localDrafts[past+':audit1'].fields.electricity,'67890');
});

test('draft recovery blocks source overwrite on archive quota failure and retains new inputs for export',async()=>{
 for(const source of ['bill','settlement']){
  const {page,context}=await open();const keyName=source==='bill'?'rentalApp.billDrafts.v1':'rentalApp.settlementDrafts.v2',raw='{quota protected '+source;
  await page.evaluate(({keyName,raw})=>{appStorage.setItem(keyName,raw);window.draftArchiveSet=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.includes('rentalApp.draftRecovery.v1.'))throw new DOMException('test archive quota','QuotaExceededError');return window.draftArchiveSet.call(this,key,value);};},{keyName,raw});
  if(source==='bill'){await history(page,'audit1',past,true);await page.locator('#bill-electricity').fill('76543');await page.evaluate(()=>flushBillDraft());}
  else {await navigateV2(page,'settlement');await page.locator('#sett-elec').fill('76543');await page.evaluate(()=>captureSettlementDraft());}
  assert.equal(await page.evaluate(keyName=>appStorage.getItem(keyName),keyName),raw);assert.match(await page.locator('#draft-recovery-notice').innerText(),/기존 초안 저장소는 유지/);
  const backup=await exportBackup(page);assert.ok(backup.localMeta.draftRecovery.entries.some(entry=>entry.source===source&&entry.raw===raw));assert.equal(source==='bill'?backup.localDrafts[past+':audit1'].fields.electricity:backup.localSettlementDrafts[key].fields['sett-elec'].value,'76543');
  await page.evaluate(()=>{Storage.prototype.setItem=window.draftArchiveSet;flushBillDraft();captureSettlementDraft();});assert.notEqual(await page.evaluate(keyName=>appStorage.getItem(keyName),keyName),raw);assert.equal(await page.evaluate(()=>storedDraftRecovery().length),1);await context.close();
 }
});

test('draft recovery imports malformed metadata only after review and keeps it out of domain state',async()=>{
 const {page}=await open(),incoming=sample();incoming.tenants[0].name='초안 복구 가져오기';incoming.localDrafts=['unknown',null,0];incoming.localSettlementDrafts={futureMonth:{fields:{unknown:''}}};incoming.localMeta={draftRecovery:{futureFormat:7,content:'<img src=x onerror="window.rawExecuted=1">'}};
 const before=await page.evaluate(()=>currentData());await page.locator('#import-file').setInputFiles({name:'draft-recovery.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(incoming))});await page.locator('#modal-data-replacement.open').waitFor();assert.match(await page.locator('.replacement-body').innerText(),/원문 보관에 실패하면 자료 복원을 중단/);assert.equal(await page.evaluate(()=>storedDraftRecovery().length),0);await page.getByRole('button',{name:'취소',exact:true}).click();assert.deepEqual(await page.evaluate(()=>currentData()),before);
 await page.locator('#import-file').setInputFiles({name:'draft-recovery.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(incoming))});await applyReplacement(page);const backup=await exportBackup(page);assert.equal(backup.localMeta.draftRecovery.entries.length,3);assert.ok(backup.localMeta.draftRecovery.entries.some(entry=>entry.raw===JSON.stringify(incoming.localDrafts)));assert.ok(backup.localMeta.draftRecovery.entries.some(entry=>entry.raw===JSON.stringify(incoming.localSettlementDrafts)));assert.ok(backup.localMeta.draftRecovery.entries.some(entry=>entry.raw===JSON.stringify(incoming.localMeta.draftRecovery)));assert.deepEqual(await page.evaluate(()=>currentData()),core.validateData(incoming));assert.equal(await page.evaluate(()=>Object.hasOwn(currentData(),'localMeta')),false);assert.equal(await page.evaluate(()=>window.rawExecuted),undefined);assert.equal(await page.locator('#draft-recovery-notice img').count(),0);
});

test('draft recovery import archive failure keeps domain and previous undo point while raw remains exportable',async()=>{
 const {page}=await open(),incoming=sample();incoming.tenants[0].name='중단할 후보';incoming.localDrafts='keep incoming raw';
 await page.evaluate(()=>{window.beforeDraftArchiveWrite=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.includes('rentalApp.draftRecovery.v1.'))throw new DOMException('test quota','QuotaExceededError');return window.beforeDraftArchiveWrite.call(this,key,value);};});
 const before=await page.evaluate(()=>({data:currentData(),state:appStorage.getItem(RentalCore.STATE_KEY),undo:appStorage.getItem(RentalCore.BACKUP_KEY)}));await page.locator('#import-file').setInputFiles({name:'archive-quota.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(incoming))});await applyReplacement(page);assert.deepEqual(await page.evaluate(()=>({data:currentData(),state:appStorage.getItem(RentalCore.STATE_KEY),undo:appStorage.getItem(RentalCore.BACKUP_KEY)})),before);assert.match(await page.locator('#toast').innerText(),/초안 원문/);assert.ok((await exportBackup(page)).localMeta.draftRecovery.entries.some(entry=>entry.raw===JSON.stringify(incoming.localDrafts)));
});

test('draft recovery JSON round trip and undo retain raw records without duplicating archives',async()=>{
 const {page,context}=await open();await page.evaluate(()=>{appStorage.setItem(DRAFT_KEY,'{raw round trip');readBillDrafts();storeBillDrafts({});});const backup=await exportBackup(page);assert.equal(backup.localMeta.draftRecovery.entries.length,1);
 const destination=await open(core.empty());await destination.page.locator('#import-file').setInputFiles({name:'round-trip.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await applyReplacement(destination.page);assert.deepEqual((await exportBackup(destination.page)).localMeta.draftRecovery.entries.map(e=>[e.source,e.raw]),backup.localMeta.draftRecovery.entries.map(e=>[e.source,e.raw]));await restoreRecoveryV2(destination.page);assert.equal(await destination.page.evaluate(()=>storedDraftRecovery().length),1);
 await destination.page.locator('#import-file').setInputFiles({name:'repeat.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});await applyReplacement(destination.page);assert.equal(await destination.page.evaluate(()=>storedDraftRecovery().length),1);await context.close();await destination.context.close();
});

test('draft recovery archives concurrent tab sources independently and keeps original and demo journals isolated',async()=>{
 const {page,context}=await open(),other=await context.newPage();await other.goto(TEST_URL);await other.locator('.section.active').waitFor();await page.evaluate(()=>localStorage.setItem('rentalApp.draftRecovery.v1.original','original untouched'));
 const saved=await Promise.all([page.evaluate(()=>preserveDraftText('bill','{first tab raw')),other.evaluate(()=>preserveDraftText('settlement','{second tab raw'))]);assert.deepEqual(saved,[true,true]);
 // Other renderers receive queued storage updates; prove both raw records after convergence.
 await Promise.all([page.waitForFunction(()=>storedDraftRecovery().length===2),other.waitForFunction(()=>storedDraftRecovery().length===2)]);
 const records=await page.evaluate(()=>storedDraftRecovery());assert.equal(records.length,2);assert.equal(new Set(records.map(r=>r.id)).size,2);assert.deepEqual(records.map(r=>[r.source,r.raw]).sort(),[['bill','{first tab raw'],['settlement','{second tab raw']]);
 const fresh=await context.newPage();await fresh.goto(TEST_URL);await fresh.locator('.section.active').waitFor();assert.deepEqual((await fresh.evaluate(()=>storedDraftRecovery())).map(r=>[r.source,r.raw]).sort(),[['bill','{first tab raw'],['settlement','{second tab raw']]);assert.equal(await page.evaluate(()=>localStorage.getItem('rentalApp.draftRecovery.v1.original')),'original untouched');
 const demo=await context.newPage();await demo.goto(TEST_URL+'?demo=1');await demo.locator('.section.active').waitFor();assert.equal(await demo.evaluate(()=>storedDraftRecovery().length),0);await demo.evaluate(()=>preserveDraftText('bill','{demo raw'));assert.equal(await page.evaluate(()=>storedDraftRecovery().length),2);assert.equal(await demo.evaluate(()=>storedDraftRecovery().length),1);
});

test('draft recovery notices and raw downloads remain usable across PC mobile and large text',async()=>{
 for(const [width,height] of [[360,800],[390,844],[412,915],[768,1024],[1366,768],[1920,1080]])for(const size of ['100%','200%']){
  const {page,context}=await open(sample(),{viewport:{width,height}});await page.evaluate(size=>{document.documentElement.style.fontSize=size;appStorage.setItem(DRAFT_KEY,'{example broken draft');readBillDrafts();},size);const button=page.getByRole('button',{name:'초안 원문 내보내기',exact:true});assert.ok((await button.boundingBox()).height>=44);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  const pending=page.waitForEvent('download');await button.click();const file=await pending,data=JSON.parse(fs.readFileSync(await file.path(),'utf8'));assert.ok(data.entries.some(e=>e.raw==='{example broken draft'));if(size==='100%'&&(width===390||width===1366))await page.screenshot({path:path.join(out,'draft-recovery-clean-'+width+'.png'),fullPage:true});await context.close();
 }
});

test('keyboard workflow selection keeps focus visible after closing mobile more navigation',async()=>{
 const {page}=await open(sample(),{viewport:{width:390,height:844}});await page.locator('#nav-more').focus();await page.keyboard.press('Enter');await page.locator('#nav-settings').focus();await page.keyboard.press('Enter');
 assert.equal(await page.evaluate(()=>document.activeElement.id),'page-title');assert.equal(await page.locator('#secondary-nav').isVisible(),false);assert.equal(await page.evaluate(()=>document.activeElement.getClientRects().length>0),true);
});

test('keyboard workflow covers seven destinations and skips directly to main content without startup focus theft',async()=>{
 for(const width of [390,1366]){
  const {page,context}=await open(sample(),{viewport:{width,height:844}});const before=await page.evaluate(()=>currentData());assert.equal(await page.evaluate(()=>document.activeElement===document.body),true);
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.className),'skip-link');const bounds=await page.locator('.skip-link').boundingBox();assert.ok(bounds.y>=0&&bounds.x>=0);await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement.id),'workspace-main');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>!!document.activeElement.closest('#workspace-main')),true);
  for(const tab of ['home','history','settlement','tenants','building','tax','settings']){
   if(!await page.locator('#nav-'+tab).isVisible()){await page.locator('#nav-more').focus();await page.keyboard.press('Enter');}
   await page.locator('#nav-'+tab).focus();await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>document.activeElement.id),'page-title');assert.equal(await page.locator('#nav-'+tab).getAttribute('aria-current'),'page');assert.equal(await page.getByRole('main').getAttribute('aria-labelledby'),'page-title');assert.equal(await page.locator('#section-'+tab+'.active').isVisible(),true);
  }
  assert.deepEqual(await page.evaluate(()=>currentData()),before);await page.reload();await page.locator('#section-settings.active').waitFor();assert.equal(await page.evaluate(()=>document.activeElement===document.body),true);await context.close();
 }
});

test('keyboard workflow seven dialog types contain Tab focus and isolate the background',async()=>{
 for(const width of [390,1366]){
  const {page,context}=await open(sample(),{viewport:{width,height:844}});await history(page);const before=await page.evaluate(()=>currentData());
  const dialogs=[['tenant','openAddTenant'],['loan','openAddLoan'],['expense','openAddExpense'],['month','openMonthPicker'],['receipt','previewKakao'],['stamp','stampBill']];
  for(const [id,fn] of dialogs){
   await page.evaluate(({fn})=>window[fn](...(fn==='stampBill'?['rent']:[])),{fn});const modal=page.locator('#modal-'+id+'.open');await modal.waitFor();assert.equal(await modal.getAttribute('aria-modal'),'true');assert.ok(await modal.getAttribute('aria-label'));assert.equal(await page.evaluate(()=>document.getElementById('workspace-main').inert),true);assert.equal(await page.evaluate(()=>activeModal().contains(document.activeElement)),true);
   await page.evaluate(()=>document.getElementById('nav-home').focus());assert.equal(await page.evaluate(()=>activeModal().contains(document.activeElement)),true);
   await modal.locator('.modal-close').focus();await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>activeModal().contains(document.activeElement)),true);await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('modal-close')),true);await page.keyboard.press('Escape');await modal.waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>document.getElementById('workspace-main').inert),false);
  }
  const incoming=sample();incoming.tenants[0].name='키보드 검토 예시';await page.locator('#import-file').setInputFiles({name:'keyboard.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(incoming))});await page.locator('#modal-data-replacement.open').waitFor();assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('modal-title')),true);await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'replacement-apply');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('modal-close')),true);await page.keyboard.press('Escape');await page.locator('#modal-data-replacement.open').waitFor({state:'hidden'});assert.deepEqual(await page.evaluate(()=>currentData()),before);await context.close();
 }
});

test('keyboard workflow includes dialog links summaries and excludes hidden disabled controls',async()=>{
 const {page}=await open();await page.evaluate(()=>openAddLoan());await page.evaluate(()=>{const modal=document.getElementById('modal-loan').querySelector('.modal');const link=document.createElement('a');link.href='#dialog-reference';link.id='dialog-test-link';link.textContent='검사 안내';const details=document.createElement('details');details.innerHTML='<summary id="dialog-test-summary">검사 상세</summary><input id="dialog-hidden-field">';const disabled=document.createElement('input');disabled.id='dialog-disabled-field';disabled.disabled=true;modal.append(link,details,disabled);});
 await page.locator('#dialog-test-link').focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'dialog-test-summary');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id||document.activeElement.className),'modal-close','closed summary next');await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'dialog-test-summary');
 await page.locator('#dialog-test-summary').press('Enter');await page.waitForFunction(()=>document.getElementById('dialog-test-summary').parentElement.open);await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'dialog-hidden-field');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.className),'modal-close','focus after expanded details');await page.keyboard.press('Escape');
});

test('keyboard workflow restores edited tenant loan expense and receipt callers after rerender',async()=>{
 const data=sample();data.loans=[{id:'focusloan',name:'예시 대출',principal:100000,rate:0}];data.expenses[key]=[{id:'focusexpense',name:'예시 지출',amount:1000,date:key.replace('-','/')+'/01',memo:''}];
 const {page}=await open(data);await navigateV2(page,'tenants');await page.locator('[data-focus-key="tenant-edit-audit1"]').click();await page.locator('#inp-name').fill('포커스 확인 임차인');await page.locator('#save-tenant-button').focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.activeElement.dataset.focusKey==='tenant-edit-audit1');assert.equal(await page.evaluate(()=>tenants[0].name),'포커스 확인 임차인');
 await navigateV2(page,'home');for(const [kind,identity,input] of [['loan','focusloan','inp-loan-name'],['expense','focusexpense','inp-exp-name']]){
  const opener=page.locator('[data-focus-key="'+kind+'-edit-'+identity+'"]');await opener.evaluate(el=>{for(let parent=el.parentElement;parent;parent=parent.parentElement)if(parent.tagName==='DETAILS')parent.open=true;});await opener.click();await page.locator('#'+input).fill('포커스 확인 '+kind);if(kind==='loan')await page.locator('#inp-loan-rate').fill('0');await page.locator('#modal-'+kind+' .btn-primary').focus();await page.keyboard.press('Enter');await page.waitForFunction(key=>document.activeElement.dataset.focusKey===key,kind+'-edit-'+identity);
 }
 await history(page);const stamp=page.locator('[data-focus-key="stamp-rent"]');await stamp.click();await page.locator('#stamp-date').fill(receipt.replaceAll('.','-'));await page.locator('#modal-stamp .btn-primary').focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>document.activeElement.dataset.focusKey==='stamp-rent');assert.equal(await page.evaluate(past=>bills[past].audit1.stampedRentDate,past),receipt);
});

test('keyboard workflow fallback and nested dialogs restore focus and preexisting inert state',async()=>{
 const {page}=await open();await page.evaluate(()=>{document.getElementById('toast').inert=true;const button=document.createElement('button');button.id='temporary-dialog-opener';button.textContent='검사 입력';document.getElementById('workspace-main').append(button);button.focus();openAddTenant();button.remove();});await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement.id==='page-title');assert.equal(await page.evaluate(()=>document.getElementById('toast').inert),true);
 await page.evaluate(()=>openAddTenant());await page.locator('#inp-name').fill('유지할 첫 입력');await page.evaluate(()=>openAddLoan());assert.equal(await page.evaluate(()=>document.getElementById('modal-tenant').inert),true);await page.keyboard.press('Escape');await page.locator('#modal-loan.open').waitFor({state:'hidden'});await page.waitForFunction(()=>document.getElementById('modal-tenant').contains(document.activeElement));assert.equal(await page.locator('#inp-name').inputValue(),'유지할 첫 입력');assert.equal(await page.evaluate(()=>document.getElementById('workspace-main').inert),true);await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.getElementById('workspace-main').inert),false);
});

test('keyboard workflow save failures remain readable inside the dialog with editable input retained',async()=>{
 for(const width of [390,1366])for(const scale of [1,2]){
  const {page,context}=await open(sample(),{viewport:{width,height:844}});await page.evaluate(scale=>document.documentElement.style.fontSize=(16*scale)+'px',scale);await navigateV2(page,'tenants');await page.locator('[data-focus-key="tenant-edit-audit1"]').click();await page.locator('#modal-tenant .modal').evaluate(el=>Promise.all(el.getAnimations().map(animation=>animation.finished)));await page.locator('#inp-name').fill('실패 후 유지 입력');await failStorage(page,core.STATE_KEY);await page.locator('#save-tenant-button').focus();await page.keyboard.press('Enter');await page.locator('#modal-tenant .modal-status:not([hidden])').waitFor();assert.match(await page.locator('#modal-tenant .modal-status').innerText(),/저장/);assert.equal(await page.locator('#modal-tenant .modal-status').getAttribute('role'),'status');
  assert.equal(await page.locator('#modal-tenant .modal-status').evaluate(el=>{const box=el.getBoundingClientRect(),modal=el.closest('.modal').getBoundingClientRect();return box.top>=Math.max(0,modal.top)&&box.bottom<=Math.min(innerHeight,modal.bottom)&&el.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2));}),true,'save error is visible inside the scrolled dialog');
  assert.equal(await page.locator('#save-tenant-button').evaluate(el=>{const box=el.getBoundingClientRect(),modal=el.closest('.modal').getBoundingClientRect();return box.top>=Math.max(0,modal.top)&&box.bottom<=Math.min(innerHeight,modal.bottom)&&el.contains(document.elementFromPoint(box.x+box.width/2,box.y+box.height/2));}),true,'focused save button remains visible after the error appears');
  assert.equal(await page.locator('#inp-name').inputValue(),'실패 후 유지 입력');assert.equal(await page.evaluate(()=>activeModal().contains(document.activeElement)),true);assert.equal(await page.evaluate(()=>document.getElementById('data-notice').closest('[inert]')!==null),true);await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement.dataset.focusKey==='tenant-edit-audit1');await context.close();
 }
});

test('keyboard workflow busy replacement and mobile Escape shortcuts keep modal focus boundaries',async()=>{
 const {page}=await open(sample(),{viewport:{width:390,height:844}});await page.locator('#nav-more').click();await page.evaluate(()=>openAddLoan());await page.keyboard.press('Escape');assert.equal(await page.locator('.workspace-sidebar').evaluate(el=>el.classList.contains('more-open')),true);await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.id),'nav-more');
 const incoming=sample();incoming.tenants[0].name='잠금 대기 후보';await page.locator('#import-file').setInputFiles({name:'busy-keyboard.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(incoming))});await page.locator('#modal-data-replacement.open').waitFor();await page.evaluate(()=>{window.keyboardLockEntered=false;void navigator.locks.request('rentalIndependent20261009.rentalApp.write',()=>new Promise(resolve=>{window.releaseKeyboardLock=resolve;window.keyboardLockEntered=true;}));});await page.waitForFunction(()=>window.keyboardLockEntered);await page.getByRole('button',{name:'이 백업으로 복원',exact:true}).click();await page.waitForFunction(()=>persistenceBusy);for(let i=0;i<6;i++){await page.keyboard.press(i%2?'Shift+Tab':'Tab');assert.equal(await page.evaluate(()=>activeModal().contains(document.activeElement)),true);}await page.keyboard.press('Escape');assert.equal(await page.locator('#modal-data-replacement.open').isVisible(),true);await page.evaluate(()=>window.releaseKeyboardLock());await page.locator('#modal-data-replacement.open').waitFor({state:'hidden'});await page.waitForFunction(()=>document.activeElement.id==='nav-more');assert.equal(await page.evaluate(()=>document.getElementById('workspace-main').inert),false);
});

test('recovery viewer empty inventory is available from settings without storage or domain writes',async()=>{
 const {page,requests}=await open();await navigateV2(page,'settings');const before=await page.evaluate(()=>({data:currentData(),storage:{...localStorage}}));
 await page.locator('[data-focus-key="draft-recovery-open-settings"]').click();await page.locator('#modal-draft-recovery.open').waitFor();assert.match(await page.locator('#draft-recovery-summary').innerText(),/확인된 복구 원문이 없습니다/);assert.equal(await page.locator('#draft-recovery-list article').count(),0);assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('modal-title')),true);await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement.dataset.focusKey==='draft-recovery-open-settings');assert.deepEqual(await page.evaluate(()=>({data:currentData(),storage:{...localStorage}})),before);assert.ok(requests.every(r=>r.method!=='POST'));
});

test('recovery viewer distinguishes stored memory and current source records without applying raw data',async()=>{
 const {page}=await open();await page.evaluate(()=>{preserveDraftText('bill','{archived bill');preserveDraftText('settlement','{archived settlement');appStorage.setItem(DRAFT_RECOVERY_PREFIX+'invalid','{invalid archive wrapper');appStorage.setItem(DRAFT_KEY,'{current bill');readBillDrafts();const write=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.includes(DRAFT_RECOVERY_PREFIX))throw new DOMException('example quota','QuotaExceededError');return write.call(this,k,v);};preserveDraftText('recovery','{memory only');Storage.prototype.setItem=write;});const before=await page.evaluate(()=>({data:currentData(),storage:{...localStorage}}));
 await page.locator('[data-focus-key="draft-recovery-open-notice"]').click();assert.equal(await page.locator('#draft-recovery-list article').count(),5);assert.match(await page.locator('#draft-recovery-summary').innerText(),/기기 보관 3 · 기기 미보관 2/);assert.match(await page.locator('#draft-recovery-list').innerText(),/현재 창에만 있음/);assert.match(await page.locator('#draft-recovery-list').innerText(),/별도 보관 전/);assert.match(await page.locator('#draft-recovery-list').innerText(),/현재 초안 확인 필요/);assert.equal(await page.locator('#draft-recovery-list textarea').count(),0);assert.deepEqual(await page.evaluate(()=>({data:currentData(),storage:{...localStorage}})),before);await page.keyboard.press('Escape');
});

test('recovery viewer lazy literal preview and individual download preserve exact original text',async()=>{
 const raw='<img src=x onerror="window.recoveryExecuted=1">\r\n<script>window.recoveryExecuted=2</script> 한글 😀\n';const {page}=await open();await page.evaluate(raw=>preserveDraftText('bill',raw),raw);await page.locator('[data-focus-key="draft-recovery-open-notice"]').click();const row=page.locator('#draft-recovery-list article');await row.locator('summary').click();await row.locator('textarea').waitFor();assert.equal(await row.locator('textarea').inputValue(),raw.replace(/\r\n/g,'\n'));assert.equal(await row.locator('textarea').getAttribute('readonly'),'');assert.equal(await row.locator('img,script').count(),0);assert.equal(await page.evaluate(()=>window.recoveryExecuted),undefined);
 const download=page.waitForEvent('download');await row.getByRole('button',{name:'이 원문 내보내기',exact:true}).click();const file=await download,result=JSON.parse(fs.readFileSync(await file.path(),'utf8'));assert.equal(result.format,'rental-draft-recovery-v1');assert.equal(result.entries.length,1);assert.equal(result.entries[0].raw,raw);assert.equal(await page.evaluate(()=>storedDraftRecovery()[0].raw),raw);assert.match(await page.locator('#modal-draft-recovery .modal-status').innerText(),/다운로드를 시작/);
});

test('recovery viewer retry preserves the source on quota failure and verifies durable archive after success',async()=>{
 const {page}=await open();await page.evaluate(()=>{appStorage.setItem(DRAFT_KEY,'{source to retry');readBillDrafts();});const before=await page.evaluate(()=>({data:currentData(),state:appStorage.getItem(RentalCore.STATE_KEY),raw:appStorage.getItem(DRAFT_KEY)}));await page.locator('[data-focus-key="draft-recovery-open-notice"]').click();await page.evaluate(()=>{window.viewerWrite=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.includes(DRAFT_RECOVERY_PREFIX))throw new DOMException('example quota','QuotaExceededError');return window.viewerWrite.call(this,k,v);};});await page.getByRole('button',{name:'기기에 보관 다시 시도',exact:true}).click();assert.match(await page.locator('#draft-recovery-list').innerText(),/현재 창에만 있음/);assert.equal(await page.evaluate(()=>pendingDraftRecovery.size),1);assert.deepEqual(await page.evaluate(()=>({data:currentData(),state:appStorage.getItem(RentalCore.STATE_KEY),raw:appStorage.getItem(DRAFT_KEY)})),before);
 await page.evaluate(()=>Storage.prototype.setItem=window.viewerWrite);await page.getByRole('button',{name:'기기에 보관 다시 시도',exact:true}).click();assert.match(await page.locator('#draft-recovery-summary').innerText(),/기기 보관 1 · 기기 미보관 0/);assert.equal(await page.evaluate(()=>pendingDraftRecovery.size),0);assert.equal(await page.evaluate(()=>document.activeElement.tagName),'SUMMARY');assert.deepEqual(await page.evaluate(()=>({data:currentData(),state:appStorage.getItem(RentalCore.STATE_KEY),raw:appStorage.getItem(DRAFT_KEY)})),before);await page.reload();await page.evaluate(()=>openDraftRecovery());assert.equal(await page.locator('#draft-recovery-list article').count(),1);assert.match(await page.locator('#draft-recovery-list').innerText(),/기기에 보관됨/);
});

test('recovery viewer follows other tab changes and keeps expanded preview and text selection',async()=>{
 const {page,context}=await open();await page.evaluate(()=>preserveDraftText('bill','{selection to retain'));await page.locator('[data-focus-key="draft-recovery-open-notice"]').click();await page.locator('#draft-recovery-list summary').click();const raw=page.locator('#draft-recovery-list textarea');await raw.focus();await raw.evaluate(el=>el.setSelectionRange(2,8));const field=await raw.getAttribute('id');const other=await context.newPage();await other.goto(TEST_URL);await other.locator('.section.active').waitFor();await other.evaluate(()=>preserveDraftText('settlement','{other tab'));await page.waitForFunction(()=>document.querySelectorAll('#draft-recovery-list article').length===2);assert.equal(await page.evaluate(()=>document.activeElement.id),field);assert.equal(await page.locator('#'+field).evaluate(el=>el.selectionStart),2);assert.equal(await page.locator('#'+field).evaluate(el=>el.selectionEnd),8);assert.equal(await page.locator('#'+field).inputValue(),'{selection to retain');
 await other.evaluate(()=>{const physical=Object.keys(localStorage).find(k=>k.startsWith(STORAGE_PREFIX+DRAFT_RECOVERY_PREFIX)&&JSON.parse(localStorage.getItem(k)).source==='settlement');localStorage.setItem(physical,JSON.stringify({source:'settlement',raw:'{same count refreshed',at:'',id:'replacement'}));});await page.waitForFunction(()=>draftRecoveryInventory().rows.some(r=>r.entry.raw==='{same count refreshed'));await page.locator('#draft-recovery-list article[data-source="settlement"] summary').click();assert.equal(await page.locator('#draft-recovery-list article[data-source="settlement"] textarea').inputValue(),'{same count refreshed');assert.equal(await page.locator('#draft-recovery-list article').count(),2);
});

test('recovery viewer read failures are explicit while current window raw stays downloadable',async()=>{
 const {page}=await open();await page.evaluate(()=>{preserveDraftText('bill','{disk archive');const write=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.includes(DRAFT_RECOVERY_PREFIX))throw new DOMException('example quota','QuotaExceededError');return write.call(this,k,v);};preserveDraftText('settlement','{memory export');Storage.prototype.setItem=write;window.viewerRead=Storage.prototype.getItem;Storage.prototype.getItem=function(k){if(k.includes(DRAFT_RECOVERY_PREFIX))throw new DOMException('example denied','SecurityError');return window.viewerRead.call(this,k);};});await page.locator('[data-focus-key="draft-recovery-open-notice"]').click();assert.match(await page.locator('#draft-recovery-read-error').innerText(),/읽지 못/);assert.equal(await page.locator('#draft-recovery-list article').count(),1);const download=page.waitForEvent('download');await page.locator('#draft-recovery-list article').getByRole('button',{name:'이 원문 내보내기',exact:true}).click();const file=await download;assert.equal(JSON.parse(fs.readFileSync(await file.path(),'utf8')).entries[0].raw,'{memory export');assert.equal(await page.evaluate(()=>pendingDraftRecovery.size),1);await page.evaluate(()=>Storage.prototype.getItem=window.viewerRead);await page.getByRole('button',{name:'기록 새로 확인',exact:true}).click();assert.equal(await page.locator('#draft-recovery-read-error').isVisible(),false);assert.equal(await page.locator('#draft-recovery-list article').count(),2);
 await page.evaluate(()=>{Storage.prototype.getItem=function(k){if(k===STORAGE_PREFIX+DRAFT_KEY)throw new DOMException('example denied','SecurityError');return window.viewerRead.call(this,k);};});await page.getByRole('button',{name:'기록 새로 확인',exact:true}).click();assert.match(await page.locator('#draft-recovery-read-error').innerText(),/읽지 못/);let unexpectedDownloads=0;page.on('download',()=>unexpectedDownloads++);await page.getByRole('button',{name:'전체 원문 내보내기',exact:true}).click();assert.match(await page.locator('#modal-draft-recovery .modal-status').innerText(),/내보내지 못/);assert.equal(unexpectedDownloads,0);await page.evaluate(()=>Storage.prototype.getItem=window.viewerRead);await page.getByRole('button',{name:'기록 새로 확인',exact:true}).click();assert.equal(await page.locator('#draft-recovery-read-error').isVisible(),false);
});

test('recovery viewer PC mobile and large text keep actions usable and keyboard focus contained',async()=>{
 for(const [width,height] of [[360,800],[390,844],[412,915],[768,1024],[1366,768],[1920,1080]])for(const size of ['100%','200%']){
  const {page,context}=await open(sample(),{viewport:{width,height}});await page.evaluate(size=>{document.documentElement.style.fontSize=size;preserveDraftText('bill','한글 긴 원문 '.repeat(300));},size);await page.locator('[data-focus-key="draft-recovery-open-notice"]').click();await page.locator('#modal-draft-recovery .modal').evaluate(el=>Promise.all(el.getAnimations().map(a=>a.finished)));await page.locator('#draft-recovery-list summary').click();await page.locator('#draft-recovery-list textarea').waitFor();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.equal(await page.locator('#modal-draft-recovery .modal').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);for(const button of await page.locator('#modal-draft-recovery .btn').all())assert.ok((await button.boundingBox()).height>=44);await page.locator('#modal-draft-recovery .modal-close').focus();await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.tagName),'TEXTAREA');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('modal-close')),true);await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement.dataset.focusKey==='draft-recovery-open-notice');await context.close();
 }
});

test('recovery viewer keeps original and demo journals isolated and full backup preserves the archive',async()=>{
 const {page,context}=await open();await page.evaluate(()=>{localStorage.setItem('rentalApp.draftRecovery.v1.original','original must stay');preserveDraftText('bill','{independent raw');});const before=await page.evaluate(()=>currentData());await page.locator('[data-focus-key="draft-recovery-open-notice"]').click();const backup=await exportBackup(page);assert.deepEqual(core.validateData(backup),before);assert.equal(backup.localMeta.draftRecovery.entries.length,1);assert.equal(backup.localMeta.draftRecovery.entries[0].raw,'{independent raw');const demo=await context.newPage();await demo.goto(TEST_URL+'?demo=1');await demo.locator('.section.active').waitFor();await demo.evaluate(()=>openDraftRecovery());assert.equal(await demo.locator('#draft-recovery-list article').count(),0);await demo.evaluate(()=>preserveDraftText('bill','{demo raw'));assert.equal(await demo.locator('#draft-recovery-list article').count(),1);assert.equal(await page.locator('#draft-recovery-list article').count(),1);assert.equal(await page.evaluate(()=>storedDraftRecovery()[0].raw),'{independent raw');assert.equal(await page.evaluate(()=>localStorage.getItem('rentalApp.draftRecovery.v1.original')),'original must stay');
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
