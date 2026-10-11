/* Anonymous local profiles; every external request is blocked. */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const core=require('../assets/core.js'),billing=require('../assets/billing.js'),key='rentalIndependent20261009.'+core.STATE_KEY,root=path.resolve(__dirname,'..');
const {navigate:navigateV2}=require('./navigation.cjs');
const tenant={id:'anonymous-operation',name:'익명 예시',unit:'201호',rent:100000,mgmt:0,elevator:0,payday:'15일',paytype:'후불납',contract:'2025/01/01 ~ 2027/12/31'};
const fixture=()=>({...core.empty(),tenants:[{...tenant}],bills:{'2026-09':{[tenant.id]:billing.freezeBill(tenant,{invoiceIssued:true},'2026-09')}}});
const cases=[],results=[];let browser,server,serverExited,url=process.env.RENTAL_TEST_URL;
const test=(name,fn)=>cases.push({name,fn});
async function open(data=fixture(),width=1366){
 const context=await browser.newContext({serviceWorkers:'block',timezoneId:'Asia/Seoul',viewport:{width,height:1000}}),page=await context.newPage(),errors=[],external=[];
 page.on('pageerror',error=>errors.push(error.message));await context.route('**/*',route=>new URL(route.request().url()).origin===new URL(url).origin?route.continue():(external.push(route.request().method()),route.abort()));
 await context.addInitScript(({data,key})=>{if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(data));localStorage.setItem('rentalIndependent20261009.rentalApp.cloudEnabled','false');localStorage.setItem('rentalApp.state.v1','original untouched');},{data,key});
 await page.goto(url);await page.locator('#section-home.active').waitFor();return {context,page,errors,external};
}
const raw=page=>page.evaluate(key=>localStorage.getItem(key),key),data=page=>page.evaluate(()=>currentData());
function checked(view){assert.deepEqual(view.errors,[]);assert.deepEqual(view.external,[]);}
async function fillRepair(page){await page.evaluate(()=>switchTab('building'));await page.locator('#repair-location').fill('201호');await page.locator('#repair-amount').fill('30000');await page.locator('#repair-description').fill('익명 수리 내용 <img src=x onerror=alert(1)>');await page.locator('#repair-evidence').fill('https://example.com/anonymous-receipt');}
async function saveRepair(page){await page.locator('#save-repair').click();await page.waitForFunction(()=>!persistenceBusy&&currentData().propertyRecords?.length===1);}
test('repair PC mobile saves once preserves expense source reloads evidence and appends reasoned cancellation',async()=>{
 for(const width of [390,1366]){
  const view=await open(fixture(),width),{page}=view,before=await data(page);await fillRepair(page);await saveRepair(page);const saved=await data(page),record=saved.propertyRecords[0];assert.deepEqual(saved.expenses,before.expenses);assert.deepEqual(saved.bills,before.bills);assert.equal(record.amount,30000);assert.equal(await page.locator('#repair-records img').count(),0);const link=page.locator('#repair-records a');assert.equal(await link.getAttribute('href'),'https://example.com/anonymous-receipt');assert.equal(await link.getAttribute('rel'),'noopener noreferrer');
  await page.reload();await page.evaluate(()=>switchTab('building'));assert.equal((await data(page)).propertyRecords.length,1);await page.locator('#repair-records summary').click();await page.locator('#repair-void-'+record.id).fill('익명 증빙 대조');await page.locator('#repair-records button').click();await page.waitForFunction(()=>!persistenceBusy&&currentData().propertyRecords.length===2);const canceled=await data(page);assert.deepEqual(canceled.propertyRecords[0],record);assert.equal(canceled.propertyRecords[1].reference,record.id);assert.match(await page.locator('#repair-records').innerText(),/취소 기록 있음/);assert.equal(await page.evaluate(()=>localStorage.getItem('rentalApp.state.v1')),'original untouched');checked(view);await view.context.close();
 }
});
test('repair invalid future unsafe links and failed save retain original plus retry input without duplication',async()=>{
 const view=await open(),{page}=view;await fillRepair(page);const before=await raw(page);await page.locator('#repair-evidence').fill('javascript:alert(1)');await page.evaluate(()=>saveRepairRecord());assert.equal(await raw(page),before);await page.locator('#repair-evidence').fill('https://example.com/anonymous-receipt');
 await page.evaluate(()=>{window.originalStorageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.endsWith('rentalApp.state.v1'))throw new DOMException('full','QuotaExceededError');return originalStorageSet.call(this,k,v);};});await page.locator('#save-repair').click();await page.waitForFunction(()=>!persistenceBusy&&!!storageFault);assert.equal(await raw(page),before);assert.equal(await page.locator('#repair-location').inputValue(),'201호');assert.equal(await page.locator('#repair-amount').inputValue(),'30000');const prepared=await page.evaluate(()=>repairDraft.id);await page.evaluate(()=>Storage.prototype.setItem=originalStorageSet);await saveRepair(page);assert.equal((await data(page)).propertyRecords[0].id,prepared);checked(view);await view.context.close();
});
test('contract condition save keeps issued historical bill and stores application date before after and audit',async()=>{
 const view=await open(),{page}=view;const before=await data(page);await page.evaluate(id=>editTenant(id),tenant.id);await page.locator('#inp-rent').fill('120000');await page.locator('#inp-contract-effective').fill('2026-10-01');await page.locator('#inp-contract-reason').fill('익명 재계약 원문 대조');await page.locator('#save-tenant-button').click();await page.locator('#modal-tenant.open').waitFor({state:'hidden'});const saved=await data(page);assert.deepEqual(saved.bills,before.bills);assert.equal(saved.contractChanges.length,1);assert.equal(saved.contractChanges[0].before.rent,100000);assert.equal(Number(saved.contractChanges[0].after.rent),120000);assert.equal(saved.contractChanges[0].effectiveOn,'2026-10-01');assert.equal(saved.tenants[0].audit.at(-1).action,'임차인 정보 변경');
 await page.evaluate(()=>switchTab('building'));await page.locator('.operations-card').last().locator('summary').click();assert.match(await page.locator('#contract-change-records').innerText(),/100000 → 120000/);await page.reload();assert.equal((await data(page)).contractChanges.length,1);checked(view);await view.context.close();
});
test('contract future date rejects before modifying tenants snapshots or raw storage',async()=>{
 const view=await open(),{page}=view,before=await raw(page);await page.evaluate(id=>editTenant(id),tenant.id);await page.locator('#inp-rent').fill('120000');await page.locator('#inp-contract-effective').fill('2199-01-01');await page.locator('#save-tenant-button').click();assert.equal(await raw(page),before);assert.equal((await data(page)).tenants[0].rent,100000);assert.equal(await page.locator('#modal-tenant.open').count(),1);checked(view);await view.context.close();
});
test('operational source cannot be removed by restore and older Google server never receives its history',async()=>{
 const view=await open(),{page}=view;await fillRepair(page);await saveRepair(page);const before=await raw(page);const message=await page.evaluate(()=>{try{RentalCore.assertReceiptStorage(appStorage,RentalCore.empty());return '';}catch(e){return e.message;}});assert.match(message,/제거/);assert.equal(await raw(page),before);
 const outcome=await page.evaluate(async()=>{let posts=0;cloudEnabled=true;cloudRequest=async options=>{if(options?.method==='POST')posts++;return {status:'ok',revision:'server-r1',data:currentData(),capabilities:{conditionalWrite:true}};};await doSync();return {posts,notice:document.getElementById('data-notice').textContent};});assert.equal(outcome.posts,0);assert.match(outcome.notice,/이력 보호/);checked(view);await view.context.close();
});
test('operational panel mobile PC large text keeps draft keyboard actions and annual income usable',async()=>{
 for(const width of [360,390,768,1366])for(const scale of [1,2]){
  const view=await open(fixture(),width),{page}=view;await fillRepair(page);await page.evaluate(scale=>document.documentElement.style.fontSize=(16*scale)+'px',scale);await page.evaluate(()=>{switchTab('home');switchTab('building');});assert.equal(await page.locator('#repair-location').inputValue(),'201호');assert.equal(await page.locator('[data-income-month="2026-09"] td').nth(1).innerText(),'₩110,000');assert.equal(await page.locator('[data-income-month="2026-09"] td').nth(0).innerText(),'근거 없음');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);await page.locator('#repair-description').focus();await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'save-repair');
  if(scale===1&&[390,1366].includes(width)){fs.mkdirSync(path.join(root,'docs/screenshots'),{recursive:true});await page.screenshot({path:path.join(root,'docs/screenshots/operations-'+width+'.png'),fullPage:true});}checked(view);await view.context.close();
 }
});
test('vacant fourth floor PC mobile shows owner candidate and cannot create tenant bills',async()=>{
 for(const width of [390,1366]){
  const sample=core.empty();sample.tenants=[1,2,3,4].map(f=>({...tenant,id:'vacant-test-'+f,unit:f+'01호',archived:f===4,period_elec:'15',period_water_day:'15'}));
  const view=await open(sample,width),{page}=view;const before=await raw(page);
  await page.evaluate(()=>{cY=2026;cM=9;});await navigateV2(page,'settlement');
  await page.locator('#sett-elec').fill('100000');await page.evaluate(()=>calcSettlement());
  assert.equal(await page.locator('#confirm-settlement').isDisabled(),true);assert.match(await page.locator('#sett-tbody').innerText(),/4층 공실 · 임대인 부담 후보/);assert.match(await page.locator('#sett-tbody').innerText(),/33,000/);
  await page.evaluate(()=>confirmSettlement());assert.equal(await raw(page),before);assert.equal((await data(page)).bills['2026-09'],undefined);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);checked(view);await view.context.close();
 }
});
test('contract reminder and repair expense comparison PC mobile preserve current contracts and historical money',async()=>{
 for(const width of [390,1366]){
  const sample=fixture(),today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);sample.tenants[0].leaseStatus='공실(정리중)';sample.floorOperations[2]={leaseStatus:'공실(정리중)'};sample.expenses[today.slice(0,7)]=[{id:'existing-expense',name:'기존 수리 지출',amount:30000,date:today}];
  const view=await open(sample,width),{page}=view;page.on('dialog',dialog=>dialog.accept());await navigateV2(page,'building');const before=await data(page);
  await page.locator('#review-'+tenant.id).fill('2027-01-15');await page.getByRole('button',{name:'확인 일정 저장',exact:true}).click();await page.waitForFunction(id=>currentData().tenants.find(t=>t.id===id).contractReviewOn==='2027-01-15',tenant.id);
  const updated=await data(page);assert.deepEqual(updated.bills,before.bills);assert.equal(updated.tenants[0].contract,before.tenants[0].contract);assert.equal(updated.tenants[0].rent,before.tenants[0].rent);assert.equal(updated.contractChanges,undefined);
  await fillRepair(page);await saveRepair(page);assert.match(await page.locator('#repair-records').innerText(),/기존 수리 지출/);assert.deepEqual((await data(page)).expenses,before.expenses);assert.match(await page.locator('[data-floor="2"]').innerText(),/수리 1건/);
  await page.evaluate(()=>switchTab('home'));assert.equal(await page.evaluate(()=>RentalBilling.buildingOverview(currentData()).vacant),2);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);checked(view);await view.context.close();
 }
});
(async()=>{
 if(!url){server=spawn(process.execPath,['scripts/serve.cjs'],{cwd:root,env:{...process.env,RENTAL_PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});serverExited=new Promise(resolve=>server.once('exit',resolve));url=await new Promise((resolve,reject)=>{let log='';const timeout=setTimeout(()=>reject(Error('Startup timed out')),10000);server.once('error',reject);server.stdout.on('data',b=>{log+=b;const m=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(m){clearTimeout(timeout);resolve(m[0]+'/');}});});}
 browser=await chromium.launch({headless:true,executablePath:process.env.RENTAL_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});for(const {name,fn} of cases){try{await fn();results.push({name,status:'pass'});console.log('PASS '+name);}catch(error){results.push({name,status:'fail',error:error.stack});console.error('FAIL '+name+': '+error.message);}finally{await Promise.all(browser.contexts().map(c=>c.close()));}}
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();if(server?.exitCode===null){server.kill();await serverExited;}fs.mkdirSync(path.join(root,'test-results'),{recursive:true});fs.writeFileSync(path.join(root,'test-results/operations-browser-results.json'),JSON.stringify(results,null,2));if(results.some(row=>row.status!=='pass'))process.exitCode=1;});
