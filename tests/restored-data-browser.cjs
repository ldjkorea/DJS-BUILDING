/* Isolated Edge import/read/export checks. Private inputs never enter logs or screenshots. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),{chromium}=require('playwright');
const core=require('../assets/core.js'),billing=require('../assets/billing.js'),{decodeSnapshot}=require('../scripts/reconcile-data.cjs'),{navigate}=require('./navigation.cjs');
const root=path.resolve(__dirname,'..'),prefix='rentalIndependent20261009.',key=prefix+core.STATE_KEY,asOf='2026-10-10',privateInput=process.env.RENTAL_RESTORE_INPUT;
function fixture(){
 const data=core.empty();data.tenants=[{id:'saved',name:'익명 임차인',biz:'익명 사무실',unit:'201호',rent:100000,mgmt:10000,elevator:0,payday:'15일'},{id:'unissued',name:'미발행 예시',unit:'301호',rent:900000,mgmt:30000,elevator:0},{id:'archived',name:'보관 예시',unit:'401호',rent:200000,mgmt:0,elevator:0,archived:true,payday:'월말'}];
 const make=(person,extra={})=>billing.freezeBill(person,{water:10000,waste:1000,...extra},'2026-09');
 data.bills={'2026-09':{saved:make(data.tenants[0],{stampedRent:true,stampedRentDate:'2026.09.15',snapshotEstimated:['rent','name'],extra:{value:null}}),unissued:{},archived:make(data.tenants[2]),orphan:make({id:'orphan',name:'등록 없는 예시',unit:'501호',rent:50000,mgmt:0,elevator:0,payday:'15일'})},'2026-08':{}};data.extension={history:[null,{reason:'익명 추가 필드'}]};return data;
}
const input=privateInput?path.resolve(privateInput):null;if(input)assert.ok(input.startsWith(path.join(root,'.private')+path.sep),'Real snapshot must be in private storage');
const data=privateInput?decodeSnapshot(JSON.parse(fs.readFileSync(input))):fixture(),inputHash=privateInput?hash(fs.readFileSync(input)):hash(JSON.stringify(data));
function hash(value){return crypto.createHash('sha256').update(value).digest('hex');}
fs.mkdirSync(path.join(root,'.private'),{recursive:true});const folder=fs.mkdtempSync(path.join(root,'.private','restore-browser-')),backup=path.join(folder,'input-backup.json');fs.writeFileSync(backup,JSON.stringify({schemaVersion:1,...data}),{flag:'wx'});
const cases=[],results=[];let server,serverExited,browser,url=process.env.RENTAL_TEST_URL;const startedAt=new Date().toISOString();
function test(name,action){cases.push({name,action});}
function csvRows(text){
 const rows=[],row=[];let cell='',quoted=false;text=text.replace(/^\uFEFF/,'');
 for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
  else if(!quoted&&ch===','){row.push(cell);cell='';}else if(!quoted&&(ch==='\r'||ch==='\n')){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(cell);rows.push([...row]);row.length=0;cell='';}else cell+=ch;}
 if(cell||row.length){row.push(cell);rows.push([...row]);}assert.equal(quoted,false,'Unclosed CSV text');return rows;
}
async function open(width){
 const context=await browser.newContext({serviceWorkers:'block',timezoneId:'Asia/Seoul',viewport:{width,height:1000},acceptDownloads:true}),page=await context.newPage(),errors=[],external=[];
 page.on('pageerror',error=>errors.push(error.message));await context.route('**/*',route=>{if(new URL(route.request().url()).origin===new URL(url).origin)return route.continue();external.push(route.request().method());return route.abort();});
 await context.addInitScript(({prefix,key,asOf})=>{const NativeDate=Date,fixed=new NativeDate(asOf+'T12:00:00+09:00').valueOf();window.Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[fixed]));}static now(){return fixed;}};localStorage.setItem(prefix+'rentalApp.cloudEnabled','false');if(!localStorage.getItem('rentalApp.state.v1'))localStorage.setItem('rentalApp.state.v1','original remains');},{prefix,key,asOf});
 await page.goto(url);await page.locator('#section-home.active').waitFor();return {context,page,errors,external};
}
async function source(page){return page.evaluate(key=>localStorage.getItem(key),key);}
async function importBackup(view,cancel=false){
 await navigate(view.page,'settings');await view.page.locator('#import-file').setInputFiles(backup);await view.page.locator('#modal-data-replacement.open').waitFor();
 if(cancel){await view.page.keyboard.press('Escape');await view.page.locator('#modal-data-replacement.open').waitFor({state:'hidden'});return;}
 await view.page.getByRole('button',{name:'이 백업으로 복원',exact:true}).click();await view.page.locator('#modal-data-replacement.open').waitFor({state:'hidden'});await view.page.waitForFunction(()=>!persistenceBusy);assert.deepEqual(await view.page.evaluate(()=>currentData()),data);
}
async function unchanged(view,before){assert.equal(await source(view.page),before);assert.deepEqual(await view.page.evaluate(()=>currentData()),data);assert.equal(await view.page.evaluate(()=>localStorage.getItem('rentalApp.state.v1')),'original remains');assert.deepEqual(view.errors,[]);assert.deepEqual(view.external,[]);}
async function downloaded(page,action){const pending=page.waitForEvent('download');await action();const file=await pending;return fs.readFileSync(await file.path(),'utf8');}
test('backup preview cancel apply reload and JSON roundtrip preserve every domain field on PC and mobile',async()=>{
 for(const width of [1366,390]){const view=await open(width),before=await source(view.page);await importBackup(view,true);assert.equal(await source(view.page),before);assert.equal(await view.page.evaluate(()=>tenants.length),0);await importBackup(view);const restored=await source(view.page);await view.page.reload();await view.page.locator('.section.active').waitFor();await unchanged(view,restored);
  const exported=JSON.parse(await downloaded(view.page,()=>view.page.evaluate(()=>exportData())));assert.deepEqual(core.validateData(exported),data);await unchanged(view,restored);await view.context.close();}
});
test('every stored invoice renders exact charges and keeps estimated basis unconfirmed without data writes',async()=>{
 for(const width of [1366,390]){const view=await open(width);await importBackup(view);const before=await source(view.page);
  for(const [month,rows] of Object.entries(data.bills))for(const [id,bill] of Object.entries(rows)){if(!Object.keys(bill).length)continue;const tenant=data.tenants.find(t=>t.id===id)||{id,name:'Unregistered',unit:bill.unitSnapshot||'',rent:0,mgmt:0,elevator:0},state=billing.payment(tenant,bill,asOf);
   await view.page.evaluate(({id,month})=>goToBill(id,month),{id,month});await view.page.locator('.bill-document').waitFor();const amounts=await view.page.locator('#hist-content .charge-row strong').allTextContents();assert.deepEqual(amounts.map(value=>Number(value.replace(/[^0-9]/g,''))),['pay_mgmt','pay_rent','pay_elec','pay_elev','pay_water','pay_waste'].map(item=>state.items[item].na?0:state.items[item].amount));assert.equal(Number((await view.page.locator('.bill-grand strong').innerText()).replace(/[^0-9]/g,'')),state.total);
   if(!bill.receiptLedger){await view.page.locator('[data-focus-key="receipt-add"]').click();await view.page.locator('#modal-receipt-entry.open').waitFor();if(bill.snapshotEstimated?.length){assert.equal(await view.page.locator('#receipt-estimates').isVisible(),true);assert.equal(await view.page.locator('#receipt-review-estimated').isChecked(),false);}await view.page.keyboard.press('Escape');await view.page.locator('#modal-receipt-entry.open').waitFor({state:'hidden'});}
  }await unchanged(view,before);await view.context.close();}
});
test('monthly CSV contains only saved invoices including archived and orphan rows and matches exact shared totals',async()=>{
 const view=await open(1366);await importBackup(view);const before=await source(view.page);
 for(const month of Object.keys(data.bills).sort()){
  await view.page.evaluate(month=>{[cY,cM]=month.split('-').map(Number);updateMonthLabel();renderAll();},month);const rows=csvRows(await downloaded(view.page,()=>view.page.evaluate(()=>exportMonthCsv()))).slice(1),saved=Object.entries(data.bills[month]).filter(([,bill])=>Object.keys(bill).length);assert.equal(rows.length,saved.length);
  const expected=saved.map(([id,bill])=>{const tenant=data.tenants.find(t=>t.id===id)||{id,name:'Unregistered',unit:bill.unitSnapshot||'',rent:0,mgmt:0,elevator:0},state=billing.payment(tenant,bill,asOf),charges=billing.charges(tenant,bill);return [...billing.itemKeys.map(item=>charges[item]),state.exempt,state.total,state.received,state.unpaid];});
  const order=row=>JSON.stringify(row);assert.deepEqual(rows.map(row=>row.slice(4,14).map(Number)).sort((a,b)=>order(a).localeCompare(order(b))),expected.sort((a,b)=>order(a).localeCompare(order(b))));assert.ok(rows.every(row=>row[0]===month));
 }await unchanged(view,before);await view.context.close();
});
test('empty invoice placeholders remain unissued after reload and open an editor without saved-invoice actions',async()=>{
 const view=await open(390);await importBackup(view);const before=await source(view.page),gap=Object.keys(data.bills).flatMap(month=>data.tenants.filter(tenant=>!tenant.archived&&(!data.bills[month][tenant.id]||!Object.keys(data.bills[month][tenant.id]).length)).map(person=>({month,person})))[0];
 if(gap){const {month,person}=gap;await view.page.reload();await view.page.locator('.section.active').waitFor();await view.page.evaluate(({id,month})=>goToBill(id,month),{id:person.id,month});assert.equal(await view.page.locator('#bill-total-display').isVisible(),true);assert.equal(await view.page.locator('[data-focus-key="receipt-add"]').count(),0);assert.equal(await view.page.locator('#hist-chips .chip.active .chip-badge').innerText(),'미작성');await view.page.evaluate(month=>{[cY,cM]=month.split('-').map(Number);},month);const savedCount=Object.values(data.bills[month]).filter(bill=>Object.keys(bill).length).length;assert.equal(csvRows(await downloaded(view.page,()=>view.page.evaluate(()=>exportMonthCsv()))).length,savedCount+1);}
 await unchanged(view,before);await view.context.close();return {unissuedCaseAvailable:!!gap};
});
test('quarter screen and downloaded CSV match all saved quarter totals after full backup restoration',async()=>{
 const view=await open(390);await importBackup(view);const before=await source(view.page);await navigate(view.page,'tax');const quarters=[...new Set(Object.keys(data.bills).map(month=>month.slice(0,4)+'-Q'+Math.ceil(Number(month.slice(5))/3)))];
 for(const key of quarters){const [year,q]=key.split('-Q').map(Number),expected=billing.quarterlyStatement(data.tenants,data.bills,year,q,asOf);await view.page.locator('#tax-quarter-select').selectOption(key);assert.deepEqual(await view.page.evaluate(()=>currentQuarterStatement().totals),expected.totals);assert.equal(await view.page.locator('[data-quarter-row]').count(),expected.rows.length);
  const rows=csvRows(await downloaded(view.page,()=>view.page.evaluate(()=>exportTaxCsv()))).slice(1);assert.equal(rows.length,expected.rows.length);for(const [index,field] of [[7,'taxableNet'],[8,'vat'],[9,'otherCharges'],[10,'gross'],[12,'overdue'],[13,'received'],[14,'unpaid'],[16,'unknownDue']])assert.equal(rows.reduce((sum,row)=>sum+Number(row[index]),0),expected.totals[field]);assert.ok(rows.every(row=>row[18]===asOf));
 }await unchanged(view,before);await view.context.close();
});
test('restored full data keeps all seven menus within six viewport widths without source changes',async()=>{
 const view=await open(1366);await importBackup(view);const before=await source(view.page);for(const width of [360,390,412,768,1366,1920]){await view.page.setViewportSize({width,height:1000});for(const tab of ['home','building','tenants','history','settlement','tax','settings']){await navigate(view.page,tab);assert.equal(await view.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);}}await unchanged(view,before);await view.context.close();
});
(async()=>{
 if(!url){server=spawn(process.execPath,['scripts/serve.cjs'],{cwd:root,env:{...process.env,RENTAL_PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});serverExited=new Promise(resolve=>server.once('exit',resolve));url=await new Promise((resolve,reject)=>{let log='';const timeout=setTimeout(()=>reject(Error('Local server timeout')),10000);server.on('error',error=>{clearTimeout(timeout);reject(error);});server.stdout.on('data',chunk=>{log+=chunk;const match=log.match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timeout);resolve(match[0]+'/');}});});}
 browser=await chromium.launch({headless:true,executablePath:process.env.RENTAL_BROWSER||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
 for(const {name,action} of cases){try{const coverage=await action();results.push({name,status:'pass',...(coverage?{coverage}:{})});console.log('PASS '+name);}catch(error){results.push({name,status:'fail'});fs.writeFileSync(path.join(folder,'failure-'+results.length+'.json'),JSON.stringify({message:error.message,stack:error.stack}));console.error('FAIL '+name+'; details kept private');}finally{await Promise.all(browser.contexts().map(context=>context.close()));}}
 if(privateInput)assert.equal(hash(fs.readFileSync(input)),inputHash,'Source file changed');const report={appVersion:require('../package.json').version,startedAt,finishedAt:new Date().toISOString(),inputSha256:inputHash,privateInput:!!privateInput,sourceFilePreserved:true,screenshotsTaken:false,googleRequestsPerformed:false,asOf,tenantCount:data.tenants.length,billCount:Object.values(data.bills).flatMap(rows=>Object.values(rows)).filter(bill=>Object.keys(bill).length).length,monthCount:Object.keys(data.bills).length,results};
 fs.writeFileSync(path.join(folder,'results.json'),JSON.stringify(report,null,2));if(!privateInput){fs.mkdirSync(path.join(root,'test-results'),{recursive:true});fs.writeFileSync(path.join(root,'test-results/restored-data-results.json'),JSON.stringify(report,null,2));}console.log(JSON.stringify({passed:results.filter(row=>row.status==='pass').length,total:results.length,privateInput:!!privateInput,report:path.relative(root,path.join(folder,'results.json'))}));if(results.some(row=>row.status!=='pass'))process.exitCode=1;
})().catch(error=>{fs.writeFileSync(path.join(folder,'runner-error.json'),JSON.stringify({message:error.message,stack:error.stack}));console.error('Restore runner failed; details kept private');process.exitCode=1;}).finally(async()=>{await browser?.close();if(server?.exitCode===null){server.kill();await serverExited;}});
