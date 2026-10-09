/* Mock-only V2 conflict, lost acknowledgement, draft and responsive acceptance. */
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const core=require('../assets/core.js'),{navigate}=require('./navigation.cjs');
const url=process.env.RENTAL_TEST_URL||'http://127.0.0.1:4274/',out=path.join(__dirname,'../test-results/integrity-v2');
const results=[],errors=[];let browser;
const fixture=()=>core.validateData({...core.empty(),tenants:[{id:'v2a',name:'익명 임차인',biz:'검증용 가게',unit:'201호',rent:100000,mgmt:10000,contract:'2025/01/01 ~ 2027/01/01',payday:'15일'},{id:'v2b',name:'검증용2',biz:'검증용 사무실',unit:'301호',rent:200000,mgmt:10000,contract:'2025/01/01 ~ 2027/02/01'}],futureHistory:{audit:[{from:null,to:0}],empty:'',zero:0}});
const server=(data=fixture())=>({data,revision:'rev1',calls:[],writes:0,receipts:new Map(),lostAck:false,race:false});
async function client(bus,viewport={width:1366,height:768}){
 const context=await browser.newContext({viewport,serviceWorkers:'block'});
 await context.addInitScript(data=>{if(!sessionStorage.getItem('seeded')){localStorage.setItem('rentalIndependent20261009.rentalApp.state.v1',JSON.stringify({...data,localMeta:{cloudBaseRevision:'rev1',cloudPending:false}}));sessionStorage.setItem('seeded','1');}},fixture());
 await context.route('**/*',async route=>{
  const request=route.request();if(request.url().startsWith(url))return route.continue();
  if(!request.url().startsWith('https://script.google.com/'))return route.abort();
  bus.calls.push({method:request.method(),body:request.method()==='POST'?request.postDataJSON():null});
  const capabilities={conditionalWrite:true,currentStatus:true,contractCalendar:true};
  if(request.method()!=='POST'){const reply={status:'ok',revision:bus.revision,data:bus.data,appVersion:'2.0.3',capabilities};if(bus.readHook)await bus.readHook();return route.fulfill({json:reply});}
  const req=request.postDataJSON(),prior=bus.receipts.get(req.requestId);
  if(prior)return route.fulfill({json:{...prior,duplicate:true}});
  if(bus.race){bus.revision='rev-race';bus.data={...bus.data,otherDevice:'변경'};bus.race=false;}
  if(req.expectedRevision!==bus.revision)return route.fulfill({json:{status:'conflict'}});
  bus.data=req.data;bus.revision='rev'+(++bus.writes+1);
  const reply={status:'ok',requestId:req.requestId,revision:bus.revision,capabilities,docs:{status:'error',message:'격리된 문서 권한 실패'}};
  bus.receipts.set(req.requestId,reply);
  if(bus.lostAck){bus.lostAck=false;return route.abort('failed');}
  return route.fulfill({json:reply});
 });
 const page=await context.newPage();page.on('dialog',d=>d.accept());page.on('pageerror',e=>errors.push(e.message));
 await page.goto(url);await page.locator('#section-home.active').waitFor();await page.evaluate(()=>{cloudEnabled=true;cloudBaseRevision='rev1';clearTimeout(saveTimer);});
 return {page,context};
}
async function edit(page,id,name){await page.evaluate(async({id,name})=>{tenants.find(t=>t.id===id).name=name;await save();clearTimeout(saveTimer);},{id,name});}
async function test(name,fn){try{await fn();results.push({name,status:'pass'});console.log('PASS '+name);}catch(e){results.push({name,status:'fail',error:e.stack});console.error('FAIL '+name+': '+e.message);throw e;}}
(async()=>{
 fs.mkdirSync(out,{recursive:true});browser=await chromium.launch({headless:true,executablePath:process.env.RENTAL_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 await test('PC and mobile clients block same and different tenant overwrites with a visible diff',async()=>{
  for(const id of ['v2a','v2b']){const bus=server(),a=await client(bus),b=await client(bus,{width:390,height:844});
   await edit(a.page,'v2a','첫 기기 수정');await a.page.evaluate(()=>manualSync());assert.equal(bus.writes,1);
   await edit(b.page,id,'두 번째 기기 수정');await b.page.evaluate(()=>manualSync());assert.equal(bus.writes,1);assert.equal(await b.page.evaluate(id=>tenants.find(t=>t.id===id).name,id),'두 번째 기기 수정');
   await b.page.getByRole('button',{name:'차이 비교',exact:true}).click();assert.match(await b.page.locator('#cloud-conflict-review').innerText(),/다른 기기와의 변경 비교/);await b.page.screenshot({path:path.join(out,'conflict-'+id+'.png'),fullPage:true});
   assert.equal(bus.data.futureHistory.audit[0].from,null);assert.equal(bus.data.futureHistory.zero,0);await a.context.close();await b.context.close();}
 });
 await test('lost save acknowledgement retries one request ID after reload and writes once',async()=>{
  const bus=server(),{page,context}=await client(bus);await edit(page,'v2a','응답 유실 검증');bus.lostAck=true;await page.evaluate(()=>manualSync());assert.equal(bus.writes,1);assert.equal(await page.evaluate(()=>cloudDirty),true);
  await page.reload();await page.evaluate(()=>{cloudEnabled=true;clearTimeout(saveTimer);});await page.evaluate(()=>manualSync());assert.equal(bus.writes,1);const posts=bus.calls.filter(r=>r.method==='POST');assert.equal(posts.length,2);assert.equal(posts[0].body.requestId,posts[1].body.requestId);assert.equal(await page.evaluate(()=>cloudDirty),false);assert.equal(await page.evaluate(()=>appStorage.getItem('rentalApp.pendingCloudRequest.v2')),null);assert.equal(bus.data.futureHistory.audit[0].from,null);await context.close();
 });
 await test('revision changes between preflight and POST never overwrite server state',async()=>{
  const bus=server(),{page,context}=await client(bus);await edit(page,'v2a','저장 직전 충돌');bus.race=true;await page.evaluate(()=>manualSync());assert.equal(bus.writes,0);assert.equal(bus.data.otherDevice,'변경');assert.equal(await page.evaluate(()=>cloudDirty),true);assert.equal(await page.evaluate(()=>tenants[0].name),'저장 직전 충돌');await context.close();
 });
 await test('offline edit reconnects through version comparison and saves the retained candidate',async()=>{
  const bus=server(),{page,context}=await client(bus);await context.setOffline(true);await edit(page,'v2a','오프라인 수정');await page.evaluate(()=>manualSync());assert.equal(bus.writes,0);await context.setOffline(false);await page.waitForFunction(()=>!cloudDirty,{timeout:10000});assert.equal(bus.writes,1);assert.equal(bus.data.tenants[0].name,'오프라인 수정');await context.close();
 });
 await test('settlement drafts keep period and input across navigation and reload, stale data is not applied',async()=>{
  const bus=server(),{page,context}=await client(bus);await navigate(page,'settlement');await page.locator('#sett-elec').fill('123456');await navigate(page,'home');await navigate(page,'settlement');assert.equal(await page.locator('#sett-elec').inputValue(),'123456');await page.reload();assert.equal(await page.locator('#sett-elec').inputValue(),'123456');await navigate(page,'home');await edit(page,'v2a','계약 조건 변경');await navigate(page,'settlement');assert.match(await page.locator('#sett-draft-state').innerText(),/자동 적용하지/);assert.notEqual(await page.locator('#sett-elec').inputValue(),'123456');await context.close();
 });
 await test('late background reads preserve the form edited while downloading',async()=>{
  const bus=server(),{page,context}=await client(bus);await page.evaluate(()=>goToHistory('v2a'));let release,entered;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);bus.data={...bus.data,tenants:bus.data.tenants.map(t=>({...t,name:'서버 최신'}))};bus.revision='rev2';bus.readHook=async()=>{entered();await gate;};await page.evaluate(()=>{void checkBackgroundCloudSync();});await started;await page.locator('#bill-electricity').fill('87654');release();await page.waitForTimeout(80);assert.equal(await page.locator('#bill-electricity').inputValue(),'87654');assert.equal(await page.evaluate(()=>tenants[0].name),'익명 임차인');await context.close();
 });
 await test('reversed background revision responses cannot move the client base backwards',async()=>{
  const bus=server(),{page,context}=await client(bus);let release,entered,n=0;const gate=new Promise(r=>release=r),started=new Promise(r=>entered=r);bus.readHook=async()=>{if(++n===1){entered();await gate;}};await page.evaluate(()=>{void checkBackgroundCloudSync();});await started;bus.revision='rev2';await page.evaluate(()=>checkBackgroundCloudSync());assert.equal(await page.evaluate(()=>cloudBaseRevision),'rev2');release();await page.waitForTimeout(80);assert.equal(await page.evaluate(()=>cloudBaseRevision),'rev2');await context.close();
 });
 await test('restored local data cannot overwrite a different Google baseline',async()=>{
  const bus=server(),{page,context}=await client(bus);const restored=fixture();restored.tenants[0].name='백업의 자료';await page.evaluate(data=>replaceData(data,'격리 복원 검증'),restored);await page.evaluate(()=>manualSync());assert.equal(bus.writes,0);assert.equal(await page.evaluate(()=>tenants[0].name),'백업의 자료');assert.match(await page.locator('#data-notice').innerText(),/차이|기준 자료/);await context.close();
 });
 await test('unissued bills show no fabricated zero totals and all seven destinations fit six viewports',async()=>{
  for(const [width,height] of [[360,800],[390,844],[412,915],[768,1024],[1366,768],[1920,1080]]){const {page,context}=await client(server(),{width,height});assert.match(await page.locator('.monthly-overview').innerText(),/미발행/);assert.ok(!await page.locator('.monthly-overview').innerText().then(v=>v.includes('₩0')));
   for(const tab of ['home','history','settlement','tenants','building','tax','settings']){await navigate(page,tab);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),width+' '+tab+' overflow');}
   await navigate(page,'home');await page.screenshot({path:path.join(out,'home-'+width+'x'+height+'.png'),fullPage:true});await context.close();}
 });
 await test('200 percent text, long names and large amounts remain inside the workspace',async()=>{
  const {page,context}=await client(server(),{width:390,height:844});await page.evaluate(()=>{tenants[0].biz='아주 긴 상호명과 한글 설명이 있는 건물 운영 검증용 가게 이름';tenants[0].rent=999999999999;bills[mk()]={v2a:{rent:999999999999,tenantSnapshot:structuredClone(tenants[0])}};renderAll();document.documentElement.style.fontSize='200%';});
  for(const tab of ['home','tenants','history','settlement','building','settings']){await navigate(page,tab);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),tab+' large text overflow');}
  await navigate(page,'home');await page.screenshot({path:path.join(out,'large-text.png'),fullPage:true});await context.close();
 });
 await test('large anonymous dataset renders within a measured two second local budget',async()=>{
  const {page,context}=await client(server(),{width:1366,height:768});const ms=await page.evaluate(()=>{tenants=Array.from({length:500},(_,i)=>({...tenants[0],id:'perf'+i,name:'익명'+i}));const start=performance.now();renderAll();return performance.now()-start;});assert.ok(ms<2000,'measured '+ms+' ms');results.push({name:'500-tenant render measurement',status:'pass',ms});await context.close();
 });
 assert.deepEqual(errors,[]);
})().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(async()=>{await browser?.close();fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({results,errors,externalGoogleWrites:0},null,2));});
