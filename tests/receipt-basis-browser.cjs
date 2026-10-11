/* Anonymous local Edge contexts. Every non-local request is blocked. */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const core=require('../assets/core'),billing=require('../assets/billing');
const url=process.env.RENTAL_TEST_URL||'http://127.0.0.1:4285/',key='rentalIndependent20261009.'+core.STATE_KEY;
const tenant={id:'basis-example',name:'과거 임차 예시',biz:'과거 사무실',unit:'201호',rent:100000,mgmt:10000,elevator:0,payday:'15일',contract:'2025/01/01~2027/12/31'};
const month='2026-07',invoice=extra=>billing.freezeBill(tenant,{water:10000,waste:1000,...extra},month);
const fixture=bill=>({...core.empty(),tenants:[{...tenant}],bills:{[month]:{[tenant.id]:bill||invoice()}}});
const cases=[],results=[];let browser;
const test=(name,fn)=>cases.push({name,fn});
async function open(data=fixture(),width=1366){
 const context=await browser.newContext({serviceWorkers:'block',viewport:{width,height:1000}}),page=await context.newPage(),errors=[],external=[];
 page.on('pageerror',error=>errors.push(error.message));await context.route('**/*',route=>{if(route.request().url().startsWith(url))return route.continue();external.push(route.request().method());return route.abort();});
 await context.addInitScript(({data,key,origin})=>{if(location.origin===origin&&!localStorage.getItem(key)){localStorage.setItem(key,JSON.stringify(data));localStorage.setItem('rentalApp.state.v1','original basis stays');}},{data,key,origin:new URL(url).origin});
 await page.goto(url);await page.evaluate(({id,month})=>goToBill(id,month),{id:tenant.id,month});await page.locator('.bill-document').waitFor();
 return {page,context,errors,external};
}
const source=page=>page.evaluate(key=>localStorage.getItem(key),key);
const data=page=>page.evaluate(()=>currentData());
const row=(page,item)=>page.locator('[data-receipt-basis-item="'+item+'"]');
async function begin(page){await page.locator('[data-focus-key="receipt-add"]').click();await page.locator('#modal-receipt-entry.open').waitFor();}
function check(view){assert.deepEqual(view.errors,[]);assert.deepEqual(view.external.filter(method=>method==='POST'),[]);}
async function commit(page){await page.locator('#receipt-confirm').click();await page.locator('#modal-receipt-entry.open').waitFor({state:'hidden'});await page.waitForFunction(()=>!persistenceBusy);}

test('basis opening PC mobile shows all saved charges confirmations balances and past identity without writes',async()=>{
 for(const width of [390,1366]){
  const bill=invoice({stampedRent:true,paid:{pay_mgmt:{date:'07/05',note:null},pay_water:{na:true,date:null}},electricity:35000});
  const state=fixture(bill);state.tenants[0].name='현재 이름';state.tenants[0].biz='현재 상호';state.tenants[0].unit='999호';state.tenants[0].rent=900000;
  const view=await open(state,width),{page}=view,before=await source(page);await begin(page);
  assert.equal(await page.locator('#receipt-basis-details').getAttribute('open'),'');assert.equal(await page.locator('[data-receipt-basis-item]').count(),6);
  const text=await page.locator('#receipt-basis-content').innerText();assert.match(text,/과거 임차 예시/);assert.match(text,/201호/);assert.doesNotMatch(text,/현재 이름|현재 상호|999호/);
  assert.deepEqual(await row(page,'pay_rent').locator('dd').allTextContents(),['₩110,000','₩110,000','₩0']);assert.match(await row(page,'pay_rent').innerText(),/날짜 미지정/);
  assert.deepEqual(await row(page,'pay_water').locator('dd').allTextContents(),['₩0','₩0','₩0']);assert.match(await row(page,'pay_water').innerText(),/미부과/);
  assert.match(await row(page,'pay_mgmt').innerText(),/2026-07-05/);assert.match(await page.locator('#receipt-basis-total').innerText(),/청구 총액 ₩160,500.*기존 확인 ₩121,000.*새 입금 ₩0.*잔액 ₩39,500/);
  assert.equal(await source(page),before);await page.keyboard.press('Escape');assert.equal(await source(page),before);assert.equal(await page.evaluate(()=>localStorage.getItem('rentalApp.state.v1')),'original basis stays');check(view);await view.context.close();
 }
});
test('basis estimates use readable labels escape unknown fields and preserve checked estimate source',async()=>{
 const fields=['rent','payday','name','period_water_day','constructor','<img src=x onerror=window.basisXss=1>'];
 const view=await open(fixture(invoice({snapshotEstimated:fields,paid:{pay_water:{date:null,note:null}}}))),{page}=view,before=await source(page);await begin(page);
 const text=await page.locator('#receipt-estimate-list').innerText();assert.match(text,/월세 공급가/);assert.match(text,/월세 납기/);assert.match(text,/임차인 성명/);assert.match(text,/수도 기준일/);assert.match(text,/확인 항목: constructor/);assert.equal(await page.locator('#receipt-estimate-list img').count(),0);
 await page.locator('#receipt-amount').fill('30000');await page.locator('#receipt-prepare').click();assert.match(await page.locator('.modal-status').innerText(),/추정/);assert.equal(await source(page),before);
 await page.locator('#receipt-review-estimated').check();await page.locator('#receipt-prepare').click();await commit(page);
 const bill=(await data(page)).bills[month][tenant.id];assert.deepEqual(bill.snapshotEstimated,fields);assert.deepEqual(bill.receiptLedger.estimatedFields,fields);assert.deepEqual(bill.paid.pay_water,{date:null,note:null});assert.equal(await page.evaluate(()=>window.basisXss),undefined);assert.equal(await page.locator('.receipt-panel img').count(),0);check(view);
});
test('basis incomplete stored snapshots block before input and keep the original storage unchanged',async()=>{
 const original={water:10000,stampedRent:true,paid:{pay_water:{date:null,note:null}}};
 const view=await open(fixture(original)),{page}=view,before=await source(page);await begin(page);
 assert.equal(await page.locator('#receipt-basis-blocked').isVisible(),true);assert.equal(await page.locator('#receipt-prepare').isVisible(),false);assert.equal(await page.locator('#receipt-amount').isDisabled(),true);
 assert.equal(await page.locator('#receipt-fields').isVisible(),false);assert.match(await page.locator('#receipt-title').innerText(),/청구 기준 대조/);
 assert.equal(await page.evaluate(()=>receiptTarget.prepared),null);
 assert.match(await page.locator('#receipt-basis-blocked').innerText(),/저장된 원문|별도로 저장/);assert.match(await page.locator('#receipt-estimate-list').innerText(),/월세 공급가|월세 납기/);
 await page.evaluate(()=>reviewReceiptEntry());assert.equal(await page.locator('#receipt-confirm').isVisible(),false);assert.equal(await source(page),before);assert.deepEqual(JSON.parse(before).bills[month][tenant.id],original);check(view);
});
test('basis comparison route needs separate manual save then retains legacy source on receipt opening',async()=>{
 const original={water:10000,stampedRent:true,paid:{pay_water:{date:null,note:'보존 메모'}},memo:'원본 예시'};
 const view=await open(fixture(original),390),{page}=view,before=await source(page);await begin(page);await page.locator('#receipt-basis-check').click();await page.locator('#modal-receipt-entry.open').waitFor({state:'hidden'});
 assert.equal(await page.locator('#bill-water').count(),1);assert.equal(await source(page),before);await page.getByRole('button',{name:'💾 저장',exact:true}).click();await page.locator('.bill-document').waitFor();await page.waitForFunction(()=>!persistenceBusy);
 const saved=(await data(page)).bills[month][tenant.id];assert.equal(saved.receiptLedger,undefined);assert.equal(saved.stampedRent,true);assert.deepEqual(saved.paid,original.paid);assert.equal(saved.memo,original.memo);
 await begin(page);assert.equal(await page.locator('#receipt-basis-blocked').isVisible(),false);await page.locator('#receipt-review-estimated').check();await page.locator('#receipt-item').selectOption('pay_mgmt');await page.locator('#receipt-amount').fill('3000');await page.locator('#receipt-prepare').click();await commit(page);
 const bill=(await data(page)).bills[month][tenant.id];assert.equal(bill.receiptLedger.events.length,1);assert.equal(bill.receiptLedger.events[0].amount,3000);assert.equal(bill.receiptLedger.legacy.stampedRent,true);assert.deepEqual(bill.receiptLedger.legacy.paid,original.paid);assert.equal(billing.payment(tenant,bill).groups.mgmt.unpaid,18000);check(view);
});
test('basis future legacy dates stay visible without fabricating current confirmation or a new receipt',async()=>{
 const view=await open(fixture(invoice({stampedRent:true,stampedRentDate:'2199/07/05'}))),{page}=view,before=await source(page);await begin(page);
 assert.deepEqual(await row(page,'pay_rent').locator('dd').allTextContents(),['₩110,000','₩0','₩110,000']);assert.match(await row(page,'pay_rent').innerText(),/기준일 이후.*2199-07-05/);assert.match(await page.locator('#receipt-basis-total').innerText(),/기존 확인 ₩0.*새 입금 ₩0/);assert.match(await page.locator('#receipt-legacy-summary').innerText(),/기존 확인 ₩0.*새 입금 ₩0/);assert.equal(await source(page),before);check(view);
});
test('basis existing ledger shows partial balances and keeps saved header and events on cancel',async()=>{
 const bill=invoice({snapshotEstimated:['rent']});const at='2026-07-01T00:00:00.000Z';
 bill.receiptLedger=billing.openReceiptLedger(tenant,bill,month+':'+tenant.id,at,{reviewEstimated:true});
 bill.receiptLedger=billing.appendReceiptEvent(bill.receiptLedger,{kind:'receipt',id:'basis-r1',billId:month+':'+tenant.id,item:'pay_rent',amount:30000,receivedOn:'2026-07-02',recordedAt:'2026-07-02T00:00:00.000Z',note:'확인 예시'});
 const view=await open(fixture(bill)),{page}=view,before=await source(page);await begin(page);assert.equal(await page.locator('#receipt-basis-details').getAttribute('open'),null);await page.locator('#receipt-basis-details summary').click();
 assert.deepEqual(await row(page,'pay_rent').locator('dd').allTextContents(),['₩110,000','₩30,000','₩80,000']);assert.match(await page.locator('#receipt-basis-total').innerText(),/새 입금 ₩30,000/);await page.keyboard.press('Escape');assert.equal(await source(page),before);assert.deepEqual((await data(page)).bills[month][tenant.id],bill);check(view);
});
test('basis six viewports and 200 percent text wrap large amounts with keyboard and storage preserved',async()=>{
 for(const width of [360,390,412,768,1366,1920])for(const font of ['100%','200%']){
  const bill=invoice();bill.tenantSnapshot.name='긴 익명 성명 '.repeat(14);bill.rent=1000000000000;
  const view=await open(fixture(bill),width),{page}=view,before=await source(page);await page.evaluate(font=>document.documentElement.style.fontSize=font,font);await begin(page);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.equal(await page.locator('#modal-receipt-entry .modal').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
  // Translated entrance animation can produce a fractional DOMRect just below
  // 44px. Measure the completed layout while retaining the strict touch target.
  await page.locator('#modal-receipt-entry .modal').evaluate(async element=>{await Promise.all(element.getAnimations().map(animation=>animation.finished));});
  assert.equal(await page.locator('#receipt-basis-content').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);const targetHeight=(await page.locator('#receipt-basis-details summary').boundingBox()).height;assert.ok(targetHeight>=44,`${width}px / ${font}: summary height ${targetHeight}`);assert.equal(await row(page,'pay_rent').locator('dd').first().innerText(),'₩1,100,000,000,000');
  await page.locator('#receipt-input-focus').click();assert.equal(await page.locator('#receipt-basis-details').getAttribute('open'),null);assert.equal(await page.evaluate(()=>document.activeElement.id),'receipt-amount');assert.equal(await source(page),before);
  await page.locator('#receipt-prepare').focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.classList.contains('modal-close')),true);await page.keyboard.press('Escape');await page.waitForFunction(()=>document.activeElement.dataset.focusKey==='receipt-add');assert.equal(await source(page),before);check(view);await view.context.close();
 }
});
test('basis stale blocked comparison route stops after another tab saves and never changes newer data',async()=>{
 const view=await open(fixture({water:10000})),{page,context}=view;await begin(page);const second=await context.newPage();await second.goto(url);await second.locator('.section.active').waitFor();await second.evaluate(async()=>{tenants[0].name='다른 창 변경';await save();});const latest=await source(second);
 await page.locator('#receipt-basis-check').click();assert.equal(await page.locator('#modal-receipt-entry.open').count(),1);assert.match(await page.locator('#modal-receipt-entry .modal-status').innerText(),/다른 창|변경|최신/);assert.equal(await source(page),latest);assert.equal(await page.locator('#bill-water').count(),0);check(view);
});
(async()=>{
 browser=await chromium.launch({headless:true,executablePath:process.env.RENTAL_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 try{for(const {name,fn} of cases.filter(item=>!process.env.RENTAL_CASE||item.name.includes(process.env.RENTAL_CASE))){try{await fn();results.push({name,status:'pass'});console.log('PASS '+name);}catch(error){results.push({name,status:'fail',error:error.stack});console.error('FAIL '+name+': '+error.message);}finally{await Promise.all(browser.contexts().map(context=>context.close()));}}}
 finally{await browser.close();fs.mkdirSync(path.join(__dirname,'../test-results'),{recursive:true});fs.writeFileSync(path.join(__dirname,'../test-results/receipt-basis-browser-results.json'),JSON.stringify(results,null,2));}
 if(results.some(result=>result.status==='fail'))process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
