const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {navigate}=require('./navigation.cjs');
const url=process.env.RENTAL_TEST_URL||'http://127.0.0.1:4290/',out=path.join(__dirname,'../test-results'),version=require('../package.json').version;
const nextVersion=version.split('.').map((value,index)=>Number(value)+(index===2?1:0)).join('.');
let browser;const results=[],errors=[],external=[];
async function test(name,action){await action();results.push({name,status:'pass'});console.log('PASS '+name);}
(async()=>{
 fs.mkdirSync(out,{recursive:true});browser=await chromium.launch({headless:true,executablePath:process.env.RENTAL_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 for(const viewport of [{width:1366,height:900},{width:390,height:844}]){
  const context=await browser.newContext({viewport,serviceWorkers:'block'});
  await context.route('**/*',r=>r.request().url().startsWith(url)?r.continue():(external.push(r.request().url()),r.abort()));
  await context.addInitScript(version=>{
   localStorage.setItem('rentalIndependent20261009.rentalApp.cloudEnabled','false');
   window.__releaseVersion=version;window.__releaseReads=0;window.__dbCalls=0;
   function bridge(success,fail){return {withSuccessHandler:fn=>bridge(fn,fail),withFailureHandler:fn=>bridge(success,fn),getAppUpdateInfo:()=>{window.__releaseReads++;setTimeout(()=>window.__releaseFail?fail({message:'격리된 버전 조회 실패'}):success({appVersion:window.__releaseVersion}),0);},independentRequest:()=>{window.__dbCalls++;throw Error('Unexpected DB request');}};}
   window.google={script:{run:bridge()}};
  },version);
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await navigate(page,'settings');
  await test(viewport.width+'px latest version check does not read or write rental data',async()=>{
   await page.getByRole('button',{name:'업데이트 확인',exact:true}).click();
   await page.waitForFunction(()=>document.getElementById('application-update-status').textContent.includes('최신 웹 버전입니다'));
   assert.equal(await page.evaluate(()=>window.__dbCalls),0);
   assert.equal(await page.locator('#android-release-link').getAttribute('href'),'https://github.com/ldjkorea/NEW-RENT-STORE/releases/latest');
   assert.equal(await page.locator('#open-application-update').getAttribute('target'),'_top');
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  });
  await test(viewport.width+'px new version displays an explicit apply action without navigation',async()=>{
   const before=page.url();await page.evaluate(value=>window.__releaseVersion=value,nextVersion);
   await page.getByRole('button',{name:'업데이트 확인',exact:true}).click();
   await page.locator('#app-update-notice').waitFor({state:'visible'});
   assert.ok((await page.locator('#app-update-notice').innerText()).includes(nextVersion));assert.equal(page.url(),before);
   assert.equal(await page.evaluate(()=>prepareApplicationUpdate()),true);
   await page.screenshot({path:path.join(out,'update-'+viewport.width+'.png'),fullPage:true});
  });
  await test(viewport.width+'px update blocks busy, unsaved, conflicting and unconfirmed cloud states',async()=>{
   for(const state of ['busy','cloud','fault','conflict','changed','modal']){
    const allowed=await page.evaluate(state=>{
     const old={syncBusy,cloudEnabled,cloudDirty,storageFault,conflictingTab};let modal;
     if(state==='busy')syncBusy=true;
     if(state==='cloud'){cloudEnabled=true;cloudDirty=true;}
     if(state==='fault')storageFault=new Error('simulated');
     if(state==='conflict')conflictingTab=true;
     if(state==='changed')tenants.push({id:'temporary',name:'unsaved'});
     if(state==='modal'){modal=document.createElement('div');modal.className='modal-overlay open';document.body.append(modal);}
     const allowed=prepareApplicationUpdate();
     ({syncBusy,cloudEnabled,cloudDirty,storageFault,conflictingTab}=old);if(state==='changed')tenants.pop();modal?.remove();return allowed;
    },state);assert.equal(allowed,false,state);
   }
  });
  await test(viewport.width+'px failed and offline checks remain retryable without data changes',async()=>{
   const before=await page.evaluate(()=>JSON.stringify(currentData()));await page.evaluate(()=>window.__releaseFail=true);
   await page.getByRole('button',{name:'업데이트 확인',exact:true}).click();
   await page.waitForFunction(()=>document.getElementById('application-update-status').textContent.includes('격리된 버전 조회 실패'));
   assert.equal(await page.locator('#check-application-update').isEnabled(),true);
   await context.setOffline(true);await page.getByRole('button',{name:'업데이트 확인',exact:true}).click();
   await page.waitForFunction(()=>document.getElementById('application-update-status').textContent.includes('인터넷에 연결'));
   assert.equal(await page.evaluate(()=>JSON.stringify(currentData())),before);assert.equal(await page.evaluate(()=>window.__dbCalls),0);
  });
  await context.close();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
})().catch(error=>{results.push({name:'update verification',status:'fail',error:error.stack});console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();fs.writeFileSync(path.join(out,'update-browser-results.json'),JSON.stringify({appVersion:version,results,errors,external},null,2));});
