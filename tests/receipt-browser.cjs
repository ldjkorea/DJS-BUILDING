/* Disposable local Edge contexts. All cloud requests are blocked or replaced with in-memory mocks. */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const core=require('../assets/core.js'),billing=require('../assets/billing.js'),{applyReplacement,navigate}=require('./navigation.cjs');
const url=process.env.RENTAL_TEST_URL||'http://127.0.0.1:4282/',prefix='rentalIndependent20261009.',stateKey=prefix+core.STATE_KEY;
const tenant={id:'receipt-ui1',name:'입금 화면 검증',biz:'원장 예시',unit:'201호',rent:100000,mgmt:10000,elevator:0,payday:'15일'};
const today=new Date(),month=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;
const fixture=extra=>({...core.empty(),tenants:[{...tenant}],bills:{[month]:{[tenant.id]:billing.freezeBill(tenant,{water:10000,...extra},month)}}});
const cases=[],results=[];let browser,runtimeErrors=[];
const test=(name,fn)=>cases.push({name,fn});
async function open(data=fixture(),width=1366,billMonth=month){
 const context=await browser.newContext({serviceWorkers:'block',viewport:{width,height:1000}});context.setDefaultTimeout(10000);
 const requests=[],errors=[];context.on('page',page=>page.on('pageerror',error=>{errors.push(error.message);runtimeErrors.push(error.message);}));
 await context.route('**/*',route=>{if(route.request().url().startsWith(url))return route.continue();requests.push({method:route.request().method()});return route.abort();});
 await context.addInitScript(({data,stateKey,origin})=>{if(location.origin!==origin)return;if(!localStorage.getItem(stateKey)){localStorage.setItem(stateKey,JSON.stringify(data));localStorage.setItem('rentalApp.state.v1','original data stays');}},{data,stateKey,origin:new URL(url).origin});
 const page=await context.newPage();await page.goto(url);await page.locator('.section.active').waitFor();if(data.tenants.length)await history(page,billMonth);return {page,context,requests,errors};
}
async function history(page,billMonth=month){await page.evaluate(({id,month})=>goToBill(id,month),{id:tenant.id,month:billMonth});await page.locator('.bill-document').waitFor();}
const read=page=>page.evaluate(()=>currentData());
const source=page=>page.evaluate(stateKey=>localStorage.getItem(stateKey),stateKey);
async function start(page,amount,options={}){
 await page.locator('[data-focus-key="receipt-add"]').click();await page.locator('#modal-receipt-entry.open').waitFor();
 if(options.item)await page.locator('#receipt-item').selectOption(options.item);await page.locator('#receipt-amount').fill(String(amount));if(options.date)await page.locator('#receipt-date').fill(options.date);if(options.note)await page.locator('#receipt-note').fill(options.note);
 await page.locator('#receipt-prepare').click();
}
async function commit(page){await page.locator('#receipt-confirm').click();await page.locator('#modal-receipt-entry.open').waitFor({state:'hidden'});await page.waitForFunction(()=>!persistenceBusy);}
async function download(page,action){const pending=page.waitForEvent('download');await page.evaluate(action);const file=await pending;return fs.readFileSync(await file.path(),'utf8');}
test('receipt UI PC mobile saves 30000 plus 80000 and reloads exact rent balance with protected original storage',async()=>{
 for(const width of [390,1366]){
  const {page,context,requests,errors}=await open(fixture(),width);const before=await source(page);await start(page,30000,{note:'첫 입금'});assert.equal(await source(page),before);assert.match(await page.locator('#receipt-review').innerText(),/30,000/);await commit(page);
  let data=await read(page),bill=data.bills[month][tenant.id];assert.equal(billing.payment(tenant,bill).groups.rent.unpaid,80000);assert.equal(bill.receiptLedger.events.length,1);assert.match(await page.locator('.charge-list').innerText(),/잔액.*80,000/);assert.ok((await page.locator('.receipt-entry>div').boundingBox()).width>=180,'입금일과 금액을 읽을 수 있는 기록 영역');assert.match(await page.locator('.payment-grid').innerText(),/관리비·공과금/);
  assert.equal(await page.locator('.receipt-panel summary').count(),0,'개시 시각과 같은 새 입금을 과거 납부 근거로 만들지 않음');assert.equal(await page.locator('[data-focus-key^="receipt-legacy-"]').count(),0);
  await start(page,80000,{note:'두 번째 입금'});await commit(page);data=await read(page);bill=data.bills[month][tenant.id];assert.equal(billing.payment(tenant,bill).groups.rent.complete,true);assert.equal(bill.receiptLedger.events.length,2);assert.equal(billing.payment(tenant,bill).unpaid,21000);
  await page.reload();await history(page);assert.deepEqual((await read(page)).bills[month][tenant.id],bill);assert.equal(await page.evaluate(()=>localStorage.getItem('rentalApp.state.v1')),'original data stays');assert.ok(requests.every(r=>r.method!=='POST'));assert.deepEqual(errors,[]);await context.close();
 }
});
test('receipt UI correction needs reason preserves receipt payload and removes canceled recent cash',async()=>{
 const {page}=await open();await start(page,30000,{note:'<img src=x onerror=window.receiptXss=1>'});await commit(page);const bill=(await read(page)).bills[month][tenant.id],event=bill.receiptLedger.events[0];assert.equal(await page.locator('.receipt-panel img').count(),0);
 await page.locator('[data-focus-key="receipt-void-'+event.id+'"]').click();await page.locator('#receipt-prepare').click();assert.match(await page.locator('#modal-receipt-entry .modal-status').innerText(),/사유|정정/);await page.locator('#receipt-reason').fill('중복 확인 정정');await page.locator('#receipt-prepare').click();await commit(page);
 const corrected=(await read(page)).bills[month][tenant.id];assert.deepEqual(corrected.receiptLedger.events[0],event);assert.equal(corrected.receiptLedger.events.length,2);assert.equal(billing.payment(tenant,corrected).received,0);assert.match(await page.locator('.receipt-panel').innerText(),/정정됨/);assert.doesNotMatch(await page.locator('#recent-receipts').innerText(),/30,000/);assert.equal(await page.evaluate(()=>window.receiptXss),undefined);
});
test('receipt UI invalid amount future date and estimated snapshot review preserve all input and source',async()=>{
 const {page}=await open(fixture({snapshotEstimated:['rent','payday']}));const before=await source(page);await start(page,30000);assert.match(await page.locator('#modal-receipt-entry .modal-status').innerText(),/추정/);assert.equal(await source(page),before);
 await page.locator('#receipt-review-estimated').check();for(const value of ['0','-1','1.5','110001']){await page.locator('#receipt-amount').fill(value);await page.locator('#receipt-prepare').click();assert.equal(await source(page),before);assert.equal(await page.locator('#receipt-confirm').isVisible(),false);}
 await page.locator('#receipt-amount').fill('30000');await page.locator('#receipt-date').fill('2199-12-31');await page.locator('#receipt-prepare').click();assert.equal(await source(page),before);await page.locator('#receipt-date').fill(await page.evaluate(()=>localToday()));await page.locator('#receipt-prepare').click();await commit(page);assert.deepEqual((await read(page)).bills[month][tenant.id].receiptLedger.estimatedFields,['rent','payday']);
});
test('receipt UI quota failure retains prepared ID and raw input then retries once',async()=>{
 const {page}=await open();await start(page,30000,{note:'보존할 메모'});const before=await source(page),entry=await page.evaluate(()=>receiptTarget.prepared.event);
 await page.evaluate(stateKey=>{window.receiptOriginalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key===stateKey)throw new DOMException('test quota','QuotaExceededError');return window.receiptOriginalSet.call(this,key,value);};},stateKey);
 await page.locator('#receipt-confirm').click();await page.waitForFunction(()=>!persistenceBusy);assert.equal(await source(page),before);assert.equal(await page.locator('#receipt-note').inputValue(),'보존할 메모');assert.equal(await page.locator('#modal-receipt-entry.open').count(),1);assert.deepEqual(await page.evaluate(()=>receiptTarget.prepared.event),entry);
 const failed=JSON.parse(await download(page,()=>exportData()));assert.deepEqual(failed.bills[month][tenant.id].receiptLedger.events,[entry]);await page.evaluate(()=>Storage.prototype.setItem=window.receiptOriginalSet);await commit(page);assert.deepEqual((await read(page)).bills[month][tenant.id].receiptLedger.events,[entry]);
});
test('receipt UI another tab saving during review stops the stale receipt and retains its input',async()=>{
 const {page,context}=await open();await start(page,30000);const second=await context.newPage();await second.goto(url);await second.locator('.section.active').waitFor();await second.evaluate(async()=>{tenants[0].name='다른 창 현재 이름';await save();});const after=await source(second);await page.locator('#receipt-confirm').click();await page.waitForFunction(()=>!persistenceBusy);assert.equal(await source(page),after);assert.equal(await page.locator('#receipt-amount').inputValue(),'30000');assert.equal(await page.locator('#modal-receipt-entry.open').count(),1);assert.equal(JSON.parse(after).bills[month][tenant.id].receiptLedger,undefined);
});
test('receipt UI full backup restores journal on new device and rejects old history erasing backup',async()=>{
 const {page}=await open();await start(page,30000);await commit(page);const exported=JSON.parse(await download(page,()=>exportData()));await page.locator('#import-file').setInputFiles({name:'older.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture()))});assert.equal(await page.locator('#modal-data-replacement.open').count(),0);const after=await source(page);
 const fresh=await open(core.empty());await fresh.page.locator('#import-file').setInputFiles({name:'journal.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(exported))});await applyReplacement(fresh.page);assert.deepEqual((await read(fresh.page)).bills,exported.bills);await history(fresh.page);assert.equal(billing.payment(tenant,(await read(fresh.page)).bills[month][tenant.id]).groups.rent.unpaid,80000);assert.equal(await source(page),after);
});
test('receipt UI cash balance matches dashboard Kakao and monthly CSV including water and waste',async()=>{
 const {page}=await open(fixture({waste:1000}));await start(page,30000);await commit(page);assert.match(await page.locator('#dashboard-metrics').innerText(),/30,000/);await page.evaluate(()=>previewKakao());const message=await page.locator('#kakao-text').evaluate(el=>el.value??el.innerText);assert.match(message,/월세 잔액 80,000원/);assert.match(message,/합계 102,000원 추가 입금/);assert.match(message,/오물처리비 잔액 1,000원/);await page.keyboard.press('Escape');const csv=await download(page,()=>exportMonthCsv());assert.match(csv,/"132000","30000","102000"/);
});
test('receipt UI legacy undated confirmation stays separate and can be corrected without deleting source',async()=>{
 const {page}=await open(fixture({stampedRent:true,stampedMgmt:true}));await page.locator('[data-focus-key="receipt-add"]').click();await page.locator('#receipt-prepare').click();await commit(page);let bill=(await read(page)).bills[month][tenant.id];assert.equal(bill.receiptLedger.events.length,0);await page.locator('.receipt-panel summary').click();assert.match(await page.locator('.receipt-panel').innerText(),/날짜 미지정/);await page.locator('[data-focus-key="receipt-legacy-pay_rent"]').click();await page.locator('#receipt-reason').fill('원래 확인 표시 오류');await page.locator('#receipt-prepare').click();await commit(page);await start(page,30000);await commit(page);bill=(await read(page)).bills[month][tenant.id];assert.equal(bill.stampedRent,true);assert.equal(bill.receiptLedger.legacy.stampedRent,true);assert.equal(billing.payment(tenant,bill).groups.rent.unpaid,80000);assert.deepEqual(bill.receiptLedger.events.map(event=>event.kind),['void','receipt']);
});
test('receipt UI overdue balance agrees across operating view quarterly tax row and tax CSV',async()=>{
 const previous=new Date(today.getFullYear(),today.getMonth()-1,1),pastMonth=`${previous.getFullYear()}-${String(previous.getMonth()+1).padStart(2,'0')}`;
 const bill=billing.freezeBill(tenant,{water:10000},pastMonth),at=new Date().toISOString(),receivedOn=`${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
 bill.receiptLedger=billing.openReceiptLedger(tenant,bill,pastMonth+':'+tenant.id,at);bill.receiptLedger=billing.appendReceiptEvent(bill.receiptLedger,{kind:'receipt',id:'tax-receipt',billId:pastMonth+':'+tenant.id,item:'pay_rent',amount:30000,receivedOn,recordedAt:at,note:'체납 잔액 검증'});
 const {page}=await open({...core.empty(),tenants:[tenant],bills:{[pastMonth]:{[tenant.id]:bill}}},1366,pastMonth);const before=await source(page);
 await navigate(page,'building');assert.match(await page.locator('#section-building').innerText(),/101,000/);
 await navigate(page,'tax');await page.locator('#tax-quarter-select').selectOption(`${previous.getFullYear()}-Q${Math.floor(previous.getMonth()/3)+1}`);assert.match(await page.locator('#tax-summary-table').innerText(),/101,000/);
 const csv=await download(page,()=>exportTaxCsv());assert.match(csv,/,"101000","30000","101000","0","0",/);assert.equal(await source(page),before);
});
test('receipt UI typed mock cloud lost acknowledgement retries the same ID and preserves one persisted receipt',async()=>{
 const {page}=await open();await start(page,30000);await commit(page);
 await page.evaluate(()=>{
  clearTimeout(saveTimer);cloudEnabled=true;cloudDirty=true;cloudBaseRevision='before-receipt';
  window.receiptMockData=structuredClone(currentData());delete window.receiptMockData.bills[activeMk()][selTenantId].receiptLedger;window.receiptMockRevision='before-receipt';window.receiptMockWrites=0;window.receiptMockIds=[];
  cloudRequest=async(options={})=>{
   const capabilities={conditionalWrite:true,receiptLedgerStorage:RentalBilling.RECEIPT_FORMAT};
   if(options.method!=='POST')return {status:'ok',protocol:'rental-sync-v2',revision:window.receiptMockRevision,capabilities,data:structuredClone(window.receiptMockData)};
   const request=JSON.parse(options.body);if(request.receiptLedgerProtocol!==RentalBilling.RECEIPT_FORMAT)throw Error('receipt protocol missing');window.receiptMockIds.push(request.requestId);
   if(!window.receiptMockWrites){RentalBilling.assertReceiptDataTransition(window.receiptMockData,request.data);window.receiptMockData=structuredClone(request.data);window.receiptMockRevision='after-receipt';window.receiptMockWrites++;throw Error('test acknowledgement lost');}
   if(request.requestId!==window.receiptMockIds[0])throw Error('retry ID changed');return {status:'ok',protocol:'rental-sync-v2',revision:window.receiptMockRevision,requestId:request.requestId,capabilities,duplicate:true,docs:{status:'ok'}};
  };
 });
 await page.evaluate(()=>doSync());assert.equal(await page.evaluate(()=>receiptMockWrites),1);assert.equal(await page.evaluate(()=>cloudDirty),true);await page.evaluate(()=>doSync());assert.equal(await page.evaluate(()=>cloudDirty),false);assert.equal(await page.evaluate(()=>receiptMockWrites),1);const ids=await page.evaluate(()=>receiptMockIds);assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);assert.deepEqual(await page.evaluate(()=>receiptMockData.bills),(await read(page)).bills);
});
test('receipt UI six viewports large text keyboard and cancel keep usable controls and source',async()=>{
 for(const width of [360,390,412,768,1366,1920]){
  const {page,context}=await open(fixture(),width);await page.evaluate(()=>document.documentElement.style.fontSize='200%');const before=await source(page);await page.locator('[data-focus-key="receipt-add"]').click();assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.equal(await page.locator('#modal-receipt-entry .modal').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);for(const button of await page.locator('#modal-receipt-entry .btn:visible').all())assert.ok((await button.boundingBox()).height>=44);await page.locator('#receipt-prepare').focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('modal-close')),true);await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement.dataset.focusKey==='receipt-add');assert.equal(await source(page),before);await context.close();
 }
});
(async()=>{
 browser=await chromium.launch({headless:true,executablePath:process.env.RENTAL_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{for(const {name,fn} of cases.filter(item=>!process.env.RENTAL_CASE||item.name.includes(process.env.RENTAL_CASE))){try{runtimeErrors=[];await fn();assert.deepEqual(runtimeErrors,[]);results.push({name,status:'pass'});console.log('PASS '+name);}catch(error){results.push({name,status:'fail',error:error.stack});console.error('FAIL '+name+': '+error.message);}finally{await Promise.all(browser.contexts().map(context=>context.close()));}}}
 finally{await browser.close();fs.mkdirSync(path.join(__dirname,'../test-results'),{recursive:true});fs.writeFileSync(path.join(__dirname,'../test-results/receipt-browser-results.json'),JSON.stringify(results,null,2));}
 if(results.some(result=>result.status==='fail'))process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
