/* Anonymous Edge profiles; external requests are blocked. */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const core=require('../assets/core'),billing=require('../assets/billing');
const url=process.env.RENTAL_TEST_URL||'http://127.0.0.1:4286/',key='rentalIndependent20261009.'+core.STATE_KEY;
const tenant={id:'correct-example',name:'과거 성명 예시',biz:'과거 상호 예시',unit:'201호',rent:100000,mgmt:10000,elevator:1000,payday:'15일',contract:'2025/01/01~2027/12/31'},month='2026-07';
const invoice=extra=>billing.freezeBill(tenant,{water:10000,waste:1000,...extra},month);
const fixture=bill=>({...core.empty(),tenants:[{...tenant}],bills:{[month]:{[tenant.id]:bill||invoice()},'2026-06':{[tenant.id]:billing.freezeBill(tenant,{water:10000,waste:1000,rent:90000},'2026-06')}}});
const cases=[],results=[];let browser;const test=(name,fn)=>cases.push({name,fn});
async function open(state=fixture(),width=1366){
 const context=await browser.newContext({serviceWorkers:'block',viewport:{width,height:1000}}),page=await context.newPage(),errors=[],external=[];
 page.on('pageerror',error=>errors.push(error.message));await context.route('**/*',route=>{if(route.request().url().startsWith(url))return route.continue();external.push(route.request().method());return route.abort();});
 await context.addInitScript(({state,key,origin})=>{if(location.origin===origin&&!localStorage.getItem(key)){localStorage.setItem(key,JSON.stringify(state));localStorage.setItem('rentalApp.state.v1','original correction stays');}},{state,key,origin:new URL(url).origin});
 await page.goto(url);await page.evaluate(({id,month})=>goToBill(id,month),{id:tenant.id,month});await page.locator('.bill-document').waitFor();return {page,context,errors,external};
}
const source=page=>page.evaluate(key=>localStorage.getItem(key),key),data=page=>page.evaluate(()=>currentData());
async function begin(page){await page.locator('[data-focus-key="basis-correction"]').click();await page.locator('#modal-bill-basis.open').waitFor();}
async function prepare(page,reason='원래 고지서 대조 후 정정 예시'){await page.locator('#bill-basis-reason').fill(reason);await page.locator('#bill-basis-prepare').click();}
async function commit(page){await page.locator('#bill-basis-confirm').click();await page.locator('#modal-bill-basis.open').waitFor({state:'hidden'});await page.waitForFunction(()=>!persistenceBusy);}
function check(view){assert.deepEqual(view.errors,[]);assert.deepEqual(view.external.filter(method=>method==='POST'),[]);}

test('correction PC mobile preview cancel preserves raw originals and two stage save changes only selected invoice',async()=>{
 for(const width of [390,1366]){
  const bill=invoice({rent:'100,000',snapshotEstimated:['rent','name'],stampedRent:true,stampedRentDate:'07/05',paid:{pay_rent:{note:null},pay_water:{date:'07/07',note:'그대로'}},custom:{value:'그대로'},invoiceIssued:true});
  const state=fixture(bill);state.tenants[0].name='현재 성명 예시';state.tenants[0].rent=900000;
  const view=await open(state,width),{page}=view,before=await source(page);await begin(page);
  assert.equal(await page.locator('#basis-rent').inputValue(),'100000');assert.equal(await page.locator('#basis-name').inputValue(),'과거 성명 예시');
  await page.locator('#basis-rent').fill('120000');await prepare(page);
  assert.equal(await source(page),before);assert.equal((await data(page)).bills[month][tenant.id].rent,'100,000');
  assert.match(await page.locator('#bill-basis-review').innerText(),/₩110,000.*₩132,000/s);assert.match(await page.locator('#bill-basis-review').innerText(),/납부 재확인: 월세/);
  await page.keyboard.press('Escape');assert.equal(await source(page),before);await begin(page);assert.equal(await page.locator('#basis-rent').inputValue(),'100000');
  await page.locator('#basis-rent').fill('120000');await page.locator('#bill-basis-values summary').click();await page.locator('#basis-name').fill('원문 성명 예시');await page.locator('#basis-contract').fill('2024/01/01~2026/12/31');await prepare(page);await commit(page);
  const saved=await data(page),next=saved.bills[month][tenant.id];assert.equal(next.rent,120000);assert.equal(next.stampedRent,false);assert.deepEqual(next.paid.pay_rent,{note:null});assert.deepEqual(next.paid.pay_water,bill.paid.pay_water);assert.deepEqual(next.custom,bill.custom);assert.deepEqual(next.snapshotEstimated,bill.snapshotEstimated);assert.equal(next.tenantSnapshot.name,'원문 성명 예시');assert.equal(next.invoiceIssued,false);
  assert.deepEqual(saved.tenants,state.tenants);assert.deepEqual(saved.bills['2026-06'],state.bills['2026-06']);assert.equal(next.receiptLedger,undefined);
  const audit=next.audit.at(-1);assert.equal(audit.action,'청구 기준 정정');assert.deepEqual(audit.changes.before,bill);assert.equal(audit.changes.after.rent,120000);assert.equal(audit.changes.before.stampedRentDate,'07/05');assert.equal(await page.evaluate(()=>localStorage.getItem('rentalApp.state.v1')),'original correction stays');
  await page.locator('.audit-details>summary').click();assert.equal(await page.locator('.basis-audit-original').count(),1);check(view);await view.context.close();
 }
});
test('correction validates integers reason limits zero values and resets reviewed candidate before edits',async()=>{
 const view=await open(),{page}=view,before=await source(page);await begin(page);
 for(const value of ['-1','1.5','1000000000001','']){await page.locator('#basis-rent').fill(value);await prepare(page);assert.equal(await page.locator('#bill-basis-confirm').isVisible(),false);assert.equal(await source(page),before);}
 await page.locator('#basis-rent').fill('0');await prepare(page,'');assert.match(await page.locator('#modal-bill-basis .modal-status').innerText(),/사유/);await prepare(page);assert.equal(await page.locator('#basis-rent').isDisabled(),true);assert.equal(await source(page),before);
 await page.locator('#bill-basis-edit').click();assert.equal(await page.locator('#bill-basis-confirm').isVisible(),false);assert.equal(await page.evaluate(()=>billBasisTarget.prepared),null);await page.locator('#basis-rent').fill('110000');await prepare(page);await commit(page);assert.equal((await data(page)).bills[month][tenant.id].rent,110000);check(view);
});
test('correction gross net first floor and settlement recheck retain exact totals and exemptions',async()=>{
 const state=fixture(invoice({elevatorTotal:15001,electricity:35000,paid:{pay_water:{na:true,date:null,note:null}}}));state.settInputs[month]={confirmed:true,marker:'정산 예시'};
 const view=await open(state),{page}=view;await begin(page);assert.equal(await page.locator('#basis-elevatorMode').inputValue(),'gross');await page.locator('#basis-elevatorMode').selectOption('net');await page.locator('#basis-elevatorAmount').fill('15000');await prepare(page);await commit(page);
 let saved=await data(page),bill=saved.bills[month][tenant.id];assert.equal(billing.charges(tenant,bill).pay_elev,16500);assert.equal(bill.elevatorTotal,undefined);assert.equal(saved.settInputs[month].confirmed,false);assert.equal(saved.settInputs[month].needsReview,true);assert.equal(saved.settInputs[month].marker,'정산 예시');assert.deepEqual(bill.paid.pay_water,state.bills[month][tenant.id].paid.pay_water);
 await begin(page);await page.locator('#basis-unitSnapshot').fill('101호');await prepare(page);assert.match(await page.locator('#bill-basis-review').innerText(),/엘리베이터.*₩16,500.*₩0/s);await commit(page);bill=(await data(page)).bills[month][tenant.id];assert.equal(billing.charges(tenant,bill).pay_elev,0);assert.equal(bill.elevator,15000);check(view);
});
test('correction dated future groups keep unrelated dates and undated groups visibly require recheck',async()=>{
 for(const date of ['2199/07/05',null]){
  const bill=invoice({electricity:35000,stampedMgmt:true,...(date?{stampedMgmtDate:date}:{})}),view=await open(fixture(bill)),{page}=view;
  await begin(page);await page.locator('#basis-mgmt').fill('20000');await prepare(page);const text=await page.locator('#bill-basis-review').innerText();
  if(!date)assert.match(text,/납부 재확인:.*공용전기세.*수도요금/s);await commit(page);const next=(await data(page)).bills[month][tenant.id];
  assert.equal(next.stampedMgmt,false);assert.equal(next.paid?.pay_mgmt?.date,undefined);if(date)for(const key of ['pay_elec','pay_water','pay_elev','pay_waste'])assert.equal(next.paid[key].date,'2199.07.05');
  assert.equal(billing.payment(tenant,next,'2026-10-10').received,0);assert.equal(next.audit.at(-1).changes.before.stampedMgmt,true);check(view);await view.context.close();
 }
});
test('correction blocked legacy route separately saves corrected basis then opens journal preserving original audit',async()=>{
 const raw={water:10000,stampedRent:true,memo:'원문 예시',paid:{pay_water:{date:null,note:null}}},view=await open(fixture(raw),390),{page}=view,before=await source(page);
 await page.locator('[data-focus-key="receipt-add"]').click();await page.locator('#receipt-basis-correct').click();assert.equal(await page.locator('#modal-receipt-entry.open').count(),0);assert.equal(await source(page),before);
 await page.locator('#basis-rent').fill('90000');await prepare(page);await commit(page);let bill=(await data(page)).bills[month][tenant.id];assert.equal(bill.receiptLedger,undefined);assert.deepEqual(bill.audit.at(-1).changes.before,raw);assert.ok(bill.snapshotEstimated.includes('rent'));
 await page.locator('[data-focus-key="receipt-add"]').click();assert.equal(await page.locator('#receipt-basis-blocked').isVisible(),false);await page.locator('#receipt-review-estimated').check();await page.locator('#receipt-item').selectOption('pay_rent');await page.locator('#receipt-amount').fill('10000');await page.locator('#receipt-prepare').click();await page.locator('#receipt-confirm').click();await page.locator('#modal-receipt-entry.open').waitFor({state:'hidden'});
 bill=(await data(page)).bills[month][tenant.id];assert.equal(bill.receiptLedger.charges.pay_rent.amount,99000);assert.equal(bill.receiptLedger.events.length,1);assert.equal(bill.receiptLedger.events[0].amount,10000);assert.deepEqual(bill.audit.at(-1).changes.before,raw);assert.equal(await page.locator('[data-focus-key="basis-correction"]').count(),0);
 const latest=await source(page);await page.evaluate(()=>openBillBasisCorrection());assert.equal(await page.locator('#modal-bill-basis.open').count(),0);assert.equal(await source(page),latest);check(view);
});
test('correction failed atomic storage leaves state and inputs intact and retry records only one audit',async()=>{
 const view=await open(),{page}=view,before=await source(page),memoryBefore=await data(page);await begin(page);await page.locator('#basis-rent').fill('120000');await prepare(page);
 await page.evaluate(key=>{window.originalCorrectionSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===key)throw new Error('정정 저장 실패 예시');return window.originalCorrectionSet.call(this,k,v);};},key);
 await page.locator('#bill-basis-confirm').click();await page.waitForFunction(()=>!persistenceBusy);assert.equal(await source(page),before);assert.deepEqual(await data(page),memoryBefore);assert.equal(await page.locator('#basis-rent').inputValue(),'120000');assert.equal(await page.locator('#bill-basis-confirm').isVisible(),true);assert.match(await page.locator('#modal-bill-basis .modal-status').innerText(),/저장 실패/);
 await page.evaluate(()=>Storage.prototype.setItem=window.originalCorrectionSet);await commit(page);const bill=(await data(page)).bills[month][tenant.id];assert.equal(bill.audit.filter(row=>row.action==='청구 기준 정정').length,1);assert.equal(bill.rent,120000);check(view);
});
test('correction another tab after preview blocks stale save and retains newer state',async()=>{
 const view=await open(),{page,context}=view;await begin(page);await page.locator('#basis-rent').fill('120000');await prepare(page);
 const second=await context.newPage();await second.goto(url);await second.locator('.section.active').waitFor();await second.evaluate(async()=>{tenants[0].biz='다른 창 예시';await save();});const latest=await source(second);
 await page.locator('#bill-basis-confirm').click();await page.waitForFunction(()=>!persistenceBusy);assert.equal(await source(page),latest);assert.equal(await page.locator('#basis-rent').inputValue(),'120000');assert.equal(await page.locator('#modal-bill-basis.open').count(),1);assert.match(await page.locator('#modal-bill-basis .modal-status').innerText(),/다른 창|변경/);check(view);
});
test('correction preserves other legacy months exactly in storage and unchanged numeric strings',async()=>{
 const state=fixture(invoice({rent:'100,000'}));state.bills['2026-06'][tenant.id]={water:1234,stampedRent:true,extension:{kept:null}};
 const view=await open(state),{page}=view;await begin(page);await page.locator('#bill-basis-values summary').click();await page.locator('#basis-contract').fill('원문 계약 예시');await prepare(page);await commit(page);
 const saved=JSON.parse(await source(page));assert.deepEqual(saved.bills['2026-06'],state.bills['2026-06']);assert.deepEqual(saved.tenants,state.tenants);assert.equal(saved.bills[month][tenant.id].rent,'100,000');check(view);
});
test('correction rechecks the candidate after a real lock wait and keeps the review open while saving',async()=>{
 const view=await open(),{page}=view,before=await source(page);await begin(page);await page.locator('#basis-rent').fill('120000');await prepare(page);
 await page.evaluate(()=>{window.correctionLockEntered=false;void navigator.locks.request('rentalIndependent20261009.rentalApp.write',()=>new Promise(resolve=>{window.releaseCorrectionLock=resolve;window.correctionLockEntered=true;}));});await page.waitForFunction(()=>window.correctionLockEntered);
 await page.locator('#bill-basis-confirm').click();await page.waitForFunction(()=>persistenceBusy);assert.equal(await source(page),before);await page.keyboard.press('Escape');assert.equal(await page.locator('#modal-bill-basis.open').count(),1);for(let i=0;i<4;i++){await page.keyboard.press(i%2?'Shift+Tab':'Tab');assert.equal(await page.evaluate(()=>activeModal().contains(document.activeElement)),true);}
 await page.evaluate(({month,id})=>{bills[month][id].memo='대기 중 변경 예시';window.releaseCorrectionLock();},{month,id:tenant.id});await page.waitForFunction(()=>!persistenceBusy);
 assert.equal(await source(page),before);assert.equal(await page.locator('#modal-bill-basis.open').count(),1);assert.match(await page.locator('#modal-bill-basis .modal-status').innerText(),/고지서가 변경/);assert.equal(await page.locator('#basis-rent').inputValue(),'120000');assert.equal((await data(page)).bills[month][tenant.id].memo,'대기 중 변경 예시');check(view);
});
test('correction blocks incidental normalization of another invoice and preserves its raw data',async()=>{
 const state=fixture();state.bills['2026-06'][tenant.id].mgmtItems=[{key:'old-item',status:'old-unknown-status',name:123,amount:10000}];
 const view=await open(state),{page}=view,before=await source(page);await begin(page);await page.locator('#basis-rent').fill('120000');await prepare(page);
 assert.equal(await page.locator('#bill-basis-confirm').isVisible(),false);assert.match(await page.locator('#modal-bill-basis .modal-status').innerText(),/다른 고지서의 원문 보정/);assert.equal(await source(page),before);assert.deepEqual(JSON.parse(await source(page)).bills['2026-06'],state.bills['2026-06']);assert.equal(await page.locator('#basis-rent').inputValue(),'120000');check(view);
});
test('correction orphan archived records escaped text keyboard and six viewports work without implicit saves',async()=>{
 for(const width of [360,390,412,768,1366,1920])for(const font of ['100%','200%']){
  const bill=invoice({rent:1000000000000});bill.tenantSnapshot.name='<img src=x onerror=window.correctionXss=1>';const state=fixture(bill);if(width===360)state.tenants=[];else state.tenants[0].archived=true;
  const view=await open(state,width),{page}=view,before=await source(page);await page.evaluate(font=>document.documentElement.style.fontSize=font,font);await begin(page);
  assert.equal(await page.locator('#basis-name').inputValue(),bill.tenantSnapshot.name);await page.locator('#bill-basis-values summary').click();await page.locator('#basis-contract').fill('정정 계약 예시');await prepare(page);
  assert.equal(await page.locator('#modal-bill-basis .modal').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);assert.equal(await page.locator('#bill-basis-review').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);assert.equal(await page.evaluate(()=>window.correctionXss),undefined);
  await page.locator('#bill-basis-edit').focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('modal-close')),true);await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement.dataset.focusKey==='basis-correction');assert.equal(await source(page),before);check(view);await view.context.close();
 }
});
(async()=>{
 browser=await chromium.launch({headless:true,executablePath:process.env.RENTAL_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{for(const {name,fn} of cases.filter(item=>!process.env.RENTAL_CASE||item.name.includes(process.env.RENTAL_CASE))){try{await fn();results.push({name,status:'pass'});console.log('PASS '+name);}catch(error){results.push({name,status:'fail',error:error.stack});console.error('FAIL '+name+': '+error.message);}finally{await Promise.all(browser.contexts().map(context=>context.close()));}}}
 finally{await browser.close();fs.mkdirSync(path.join(__dirname,'../test-results'),{recursive:true});fs.writeFileSync(path.join(__dirname,'../test-results/bill-basis-browser-results.json'),JSON.stringify(results,null,2));}
 if(results.some(result=>result.status==='fail'))process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
