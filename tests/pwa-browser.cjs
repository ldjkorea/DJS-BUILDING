const {navigate:navigateV2}=require('./navigation.cjs');
/* Real service worker lifecycle on a loopback-only server and temporary profile. */
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results');
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
const results=[],errors=[],external=[];
let browser,server,context,update=false;
const assets=new Set(['index.html','sw.js','manifest.json','icon.svg','assets/core.js','assets/billing.js','assets/app.js','assets/enhancements.js','assets/styles.css','assets/workspace.css','assets/mobile.css','icons/icon-180.png','icons/icon-192.png','icons/icon-512.png','icons/maskable-512.png']);
const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'};
async function test(name,action){
  try{await action();results.push({name,status:'pass'});console.log('PASS '+name);}
  catch(error){results.push({name,status:'fail',error:error.stack});console.error('FAIL '+name+': '+error.message);throw error;}
}
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    // Observe activation from a same-origin page outside the application's
    // worker scope, so the observer cannot keep the old release alive.
    if(pathname==='/pwa-observer')return res.writeHead(200,{'Content-Type':'text/html','Cache-Control':'no-store'}).end('<!doctype html><title>Anonymous lifecycle observer</title>');
    if(!pathname.startsWith('/rental-app/'))return res.writeHead(404).end();
    const file=pathname.slice('/rental-app/'.length)||'index.html';
    if(!assets.has(file))return res.writeHead(404).end();
    let body=fs.readFileSync(path.join(root,file));
    if(file==='sw.js'&&update)body=Buffer.from(body.toString().replace(`CACHE_PREFIX+'${version}'`,`CACHE_PREFIX+'${version}-test-update-${update}'`));
    res.writeHead(200,{'Content-Type':types[path.extname(file)],'Cache-Control':'no-store'});res.end(body);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`,url=origin+'/rental-app/?demo=1';
  browser=await chromium.launch({headless:true,executablePath:process.env.RENTAL_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  context=await browser.newContext({serviceWorkers:'allow',viewport:{width:1280,height:1000}});
  await context.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():(external.push(r.request().url()),r.abort()));
  let page=await context.newPage();page.on('dialog',d=>d.accept());page.on('pageerror',e=>errors.push(e.message));
  await test('PWA installs all application assets and gains control after reload',async()=>{
    await page.goto(url);await page.evaluate(()=>navigator.serviceWorker.ready);
    await page.reload();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
    const urls=await page.evaluate(async version=>{const names=await caches.keys(),name=names.find(key=>key.endsWith('-'+version));if(!name)throw Error('Current application cache was not installed');const cache=await caches.open(name);return (await cache.keys()).map(r=>r.url);},version);
    assert.equal(urls.length,15);assert.ok(urls.some(u=>u.endsWith('/assets/billing.js')));assert.ok(urls.some(u=>u.endsWith('/icons/icon-512.png')));
    await page.screenshot({path:path.join(out,'verified-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    for(const tab of ['home','tenants','history','settlement','settings']){
      await navigateV2(page,tab);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),tab+' overflow');
    }
    await navigateV2(page,'home');
    await page.screenshot({path:path.join(out,'verified-mobile.png'),fullPage:true});
    await page.setViewportSize({width:1280,height:1000});
  });
  await test('offline query navigation, edit, save and reload retain local data',async()=>{
    await context.setOffline(true);await page.goto(url+'&view=offline');
    await navigateV2(page,'home');await page.evaluate(()=>goToHistory('demo2'));
    await page.waitForTimeout(80);await page.evaluate(()=>editThisMonth());
    await page.locator('#bill-electricity').fill('43210');await page.evaluate(()=>saveBill());
    await page.waitForFunction(()=>!document.getElementById('toast').classList.contains('show'));
    await page.screenshot({path:path.join(out,'verified-bill.png'),fullPage:true});
    await page.reload();assert.equal(await page.evaluate(()=>bills[mk()].demo2.electricity),43210);
    assert.equal(await page.evaluate(()=>localStorage.getItem('rentalIndependent20261009.'+RentalCore.STATE_KEY)),null);
    await page.screenshot({path:path.join(out,'pwa-offline.png'),fullPage:true});
    await context.setOffline(false);
  });
  await test('PWA update waits for open windows and keeps unsaved drafts',async()=>{
    await page.evaluate(()=>goToHistory('demo2'));await page.waitForTimeout(80);await page.evaluate(()=>editThisMonth());
    await page.locator('#bill-electricity').fill('87654');await page.evaluate(()=>flushBillDraft());
    await page.evaluate(async()=>{await caches.open('unrelated-app-cache');await caches.open('rental-app-%2Fother%2F-1.0');await caches.open('rental-foundation-v3');});
    update=1;await page.evaluate(async()=>{const registration=await navigator.serviceWorker.getRegistration();await registration.update();});
    await page.waitForFunction(async()=>!!(await navigator.serviceWorker.getRegistration()).waiting);
    await page.locator('#app-update-notice').waitFor({state:'visible'});
    await page.screenshot({path:path.join(out,'verified-update.png'),fullPage:true});
    assert.equal(await page.locator('#bill-electricity').inputValue(),'87654');
    assert.equal(await page.evaluate(()=>Object.values(readBillDrafts())[0].fields.electricity),'87654');
  });
  await test('closing all app windows activates update and only removes related old caches',async()=>{
    const observer=await context.newPage();await observer.goto(origin+'/pwa-observer');
    assert.equal(await observer.evaluate(()=>navigator.serviceWorker.controller),null);
    await page.close();
    await observer.waitForFunction(async appUrl=>{const registration=await navigator.serviceWorker.getRegistration(appUrl);return registration?.active?.state==='activated'&&!registration.waiting;},url);
    await observer.close();page=await context.newPage();page.on('dialog',d=>d.accept());page.on('pageerror',e=>errors.push(e.message));
    await page.goto(url,{waitUntil:'domcontentloaded'});
    // Reload restores the user's last section, which was history in this flow.
    await page.waitForFunction(()=>typeof renderAll==='function'&&!!document.querySelector('.section.active'));
    await page.locator('.section.active').waitFor();
    await page.waitForFunction(async()=>!!navigator.serviceWorker.controller&&!(await navigator.serviceWorker.getRegistration()).waiting);
    // Activation also waits for asynchronous cache deletion. Observe its
    // completion before asserting the obsolete release was removed.
    await page.waitForFunction(async version=>!(await caches.keys()).includes('rental-independent-20261009-%2Frental-app%2F-'+version),version);
    const names=await page.evaluate(()=>caches.keys());
    assert.ok(names.includes('rental-independent-20261009-%2Frental-app%2F-'+version+'-test-update-1'));
    assert.ok(!names.includes('rental-independent-20261009-%2Frental-app%2F-'+version));
    assert.ok(names.includes('rental-foundation-v3'));
    assert.ok(names.includes('unrelated-app-cache'));assert.ok(names.includes('rental-app-%2Fother%2F-1.0'));
    await page.evaluate(()=>goToHistory('demo2'));await page.waitForTimeout(80);await page.evaluate(()=>editThisMonth());
    assert.equal(await page.locator('#bill-electricity').inputValue(),'87654');
  });
  await test('updated PWA remains usable offline with no application errors or cloud requests',async()=>{
    await context.setOffline(true);await page.reload();await navigateV2(page,'home');
    assert.equal(await page.locator('#home-bill-list .t-item').count(),4);
    assert.deepEqual(errors,[]);assert.equal(external.filter(u=>u.includes('script.google')).length,0);
  });
  await test('update button checks, protects other windows and applies in one click with drafts retained',async()=>{
    await context.setOffline(false);await page.evaluate(()=>goToHistory('demo2'));await page.waitForTimeout(80);await page.evaluate(()=>editThisMonth());
    await page.locator('#bill-electricity').fill('98765');await page.evaluate(()=>flushBillDraft());
    const other=await context.newPage();await other.goto(url);await other.waitForFunction(()=>!!navigator.serviceWorker.controller);
    update=2;await navigateV2(page,'settings');await page.getByRole('button',{name:'업데이트 확인',exact:true}).click();
    await page.waitForFunction(async()=>!!(await navigator.serviceWorker.getRegistration()).waiting);
    await page.locator('#app-update-notice button').click();
    await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('다른 창'));
    assert.ok(await page.evaluate(async()=>!!(await navigator.serviceWorker.getRegistration()).waiting));
    await other.close();
    await page.locator('#app-update-notice button').click();
    await page.waitForFunction(async version=>(await caches.keys()).some(key=>key.endsWith(version+'-test-update-2')),version);
    await page.waitForFunction(()=>typeof renderAll==='function'&&!!document.querySelector('.section.active'));
    await page.evaluate(()=>goToHistory('demo2'));await page.waitForTimeout(80);await page.evaluate(()=>editThisMonth());
    assert.equal(await page.locator('#bill-electricity').inputValue(),'98765');
    assert.ok((await page.evaluate(()=>caches.keys())).includes('unrelated-app-cache'));assert.deepEqual(errors,[]);
  });
})().catch(e=>{console.error(e.message);process.exitCode=1;}).finally(async()=>{
  if(results.some(row=>row.status==='fail')&&context){
    const current=context.pages().find(page=>page.url().includes('/rental-app/'));
    if(current){
      await current.screenshot({path:path.join(out,'pwa-failure.png'),fullPage:true}).catch(()=>{});
      const visible=await current.evaluate(()=>({title:document.title,readyState:document.readyState,bodyText:document.body?.innerText.slice(0,1000),scriptCount:document.scripts.length,coreAvailable:typeof RentalCore!=='undefined',appAvailable:typeof renderAll!=='undefined',homePresent:!!document.querySelector('#section-home'),controller:!!navigator.serviceWorker.controller})).catch(error=>({error:error.message}));
      fs.writeFileSync(path.join(out,'pwa-failure-results.json'),JSON.stringify({visible,errors,external},null,2));
    }
  }
  if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));
  fs.writeFileSync(path.join(out,'pwa-browser-results.json'),JSON.stringify(results,null,2));
});
