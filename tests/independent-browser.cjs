/* Disposable browser contexts. All cloud calls are mocked; no operating DB writes. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const core=require('../assets/core.js');
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results');
const prefix='rentalIndependent20261009.';
const sample={...core.empty(),tenants:[{id:'copy1',name:'복사본 테스트',unit:'201호',rent:100000,mgmt:10000,
  audit:[{at:'2026-10-09T00:00:00.000Z',action:'기록',detail:'null 보존',changes:{deposit:{from:null,to:0}}}]}]};
let server,browser;
const results=[];
async function check(name,action){await action();results.push({name,status:'pass'});console.log('PASS '+name);}
(async()=>{
 fs.mkdirSync(out,{recursive:true});
 server=spawn(process.execPath,['scripts/serve.cjs'],{cwd:root,env:{...process.env,RENTAL_PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});
 const url=await new Promise((resolve,reject)=>{let log='';server.stdout.on('data',b=>{log+=b;const match=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(match)resolve(match[0]+'/');});server.on('error',reject);});
 browser=await chromium.launch({headless:true,executablePath:process.env.RENTAL_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 const context=await browser.newContext({serviceWorkers:'block',viewport:{width:1280,height:1000}});
 let external=[];await context.route('**/*',r=>r.request().url().startsWith(url)?r.continue():(external.push(r.request().url()),r.abort()));
 await context.addInitScript(()=>{if(!localStorage.getItem('original-seeded')){
   localStorage.setItem('rentalApp.state.v1',JSON.stringify({tenants:[{id:'original',name:'원본 보존'}],bills:{}}));
   localStorage.setItem('rental_app_theme','original-theme');localStorage.setItem('original-seeded','yes');
 }});
 const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(url);await page.locator('#section-home.active').waitFor();
 const original=await page.evaluate(()=>localStorage.getItem('rentalApp.state.v1'));
 await check('new app does not read original browser data',async()=>assert.equal(await page.evaluate(()=>tenants.length),0));
 await check('new app save and reload preserve original data',async()=>{
   await page.evaluate(async data=>{assignData(data);await save();},sample);
   assert.equal(await page.evaluate(()=>localStorage.getItem('rentalApp.state.v1')),original);
   assert.ok(await page.evaluate(()=>localStorage.getItem('rentalIndependent20261009.'+RentalCore.STATE_KEY)));
   await page.reload();await page.locator('#section-home.active').waitFor();assert.equal(await page.evaluate(()=>tenants[0].id),'copy1');
 });
 await check('original storage events cannot block independent app saves',async()=>{
   await page.evaluate(()=>window.dispatchEvent(new StorageEvent('storage',{key:'rentalApp.state.v1',newValue:'changed'})));
   assert.equal(await page.evaluate(()=>conflictingTab),false);
 });
 await check('theme preferences stay independent',async()=>{
   await page.locator('#theme-toggle-btn').click();assert.equal(await page.evaluate(()=>localStorage.getItem('rental_app_theme')),'original-theme');
 });
 await check('demo storage and external connections remain isolated',async()=>{
   await page.goto(url+'?demo=1');await page.locator('#section-home.active').waitFor();assert.equal(await page.evaluate(()=>tenants.length),4);
   assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('rentalIndependent20261009.'+RentalCore.STATE_KEY)).tenants[0].id),'copy1');
   assert.deepEqual(external,[]);
 });
 await check('desktop and mobile menus render without overflow',async()=>{
   for(const width of [1280,390]){await page.setViewportSize({width,height:844});for(const tab of ['home','building','tenants','history','settlement','tax','settings']){
     await page.locator('#nav-'+tab).click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
   }}assert.deepEqual(errors,[]);
   await page.screenshot({path:path.join(out,'independent-mobile.png'),fullPage:true});
 });
 await context.close();
 const rpcContext=await browser.newContext({serviceWorkers:'block',viewport:{width:1280,height:1000}});
 await rpcContext.route('**/*',r=>r.request().url().startsWith(url)?r.continue():r.abort());
 await rpcContext.addInitScript(data=>{
   window.rpcCalls=[];window.mockServerData=data;window.mockRevision='copy-r1';
   window.google={script:{run:{withSuccessHandler(success){const runner={withFailureHandler(failure){runner.failure=failure;return runner;},independentRequest(request){
     window.rpcCalls.push(request);
     setTimeout(()=>{try{let reply={status:'ok',data:window.mockServerData,revision:window.mockRevision,capabilities:{conditionalWrite:true,currentStatus:true}};
       if(request.method==='POST'){const body=JSON.parse(request.body);if(body.expectedRevision!==window.mockRevision)reply={status:'conflict'};
       else{window.mockServerData=body.data;window.mockRevision='copy-r2';reply={...reply,data:body.data,revision:window.mockRevision,requestId:body.requestId,docs:{status:'ok',documentId:'copy-document'}};}}
       success(JSON.stringify(reply));}catch(error){runner.failure(error);}},10);
   }};return runner;}}}};
 },sample);
 const rpcPage=await rpcContext.newPage();rpcPage.on('dialog',d=>d.accept());await rpcPage.goto(url);
 await rpcPage.waitForFunction(()=>tenants.length===1&&cloudBaseRevision==='copy-r1');
 await check('GAS string transport preserves nested null audit values on first load and save',async()=>{
   assert.equal(await rpcPage.evaluate(()=>tenants[0].audit[0].changes.deposit.from),null);
   await rpcPage.evaluate(()=>manualSync());
   const post=await rpcPage.evaluate(()=>JSON.parse(rpcCalls.find(r=>r.method==='POST').body));
   assert.equal(post.data.tenants[0].audit[0].changes.deposit.from,null);
   assert.equal(post.expectedRevision,'copy-r1');assert.match(post.requestId,/^[a-zA-Z0-9_-]{16,100}$/);
   assert.equal(await rpcPage.evaluate(()=>cloudBaseRevision),'copy-r2');assert.equal(await rpcPage.evaluate(()=>cloudDirty),false);
 });
 await rpcContext.close();
 fs.writeFileSync(path.join(out,'independent-browser-results.json'),JSON.stringify({results,originalDataUnchanged:true,externalRequests:0},null,2));
})().catch(error=>{console.error(error.stack);process.exitCode=1;}).finally(async()=>{await browser?.close();server?.kill();});
