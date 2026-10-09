/* Execute tests against ZIP readback. All server services are mocks. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict'),{spawn}=require('node:child_process');
const {verifyCandidate,hash}=require('./package-gas.cjs'),root=path.resolve(__dirname,'..');
const run=(file,env,unit=false)=>new Promise(resolve=>{
 const args=unit?['--test',path.join(root,'tests',file)]:[path.join(root,'tests',file)],child=spawn(process.execPath,args,{cwd:root,env,windowsHide:true,stdio:['ignore','pipe','pipe']});let log='';
 child.stdout.on('data',data=>{log+=data;process.stdout.write(data);});child.stderr.on('data',data=>{log+=data;process.stderr.write(data);});
 const timeout=setTimeout(()=>child.kill(),180000);child.on('error',error=>{log+=error.message;});child.on('close',exitCode=>{clearTimeout(timeout);resolve({file,exitCode,status:exitCode===0?'pass':'fail',log});});
});
(async()=>{
 const version=require('../package.json').version,manifestPath=path.join(root,'releases/gas-candidate-'+version+'.json'),manifest=JSON.parse(fs.readFileSync(manifestPath)),zip=path.join(root,'releases',manifest.archive.file),entries=verifyCandidate(zip,manifest);
 const stage=fs.mkdtempSync(path.join(os.tmpdir(),'rental-gas-test-'));for(const entry of entries)fs.writeFileSync(path.join(stage,entry.name),entry.data,{flag:'wx'});
 const html=entries.find(entry=>entry.name==='App.html').data,server=http.createServer((req,res)=>{
  if(!['GET','HEAD'].includes(req.method)||!['/','/index.html'].includes(new URL(req.url,'http://localhost').pathname)){res.writeHead(404).end();return;}
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:html);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port+'/',env={...process.env,RENTAL_TEST_URL:url,RENTAL_GAS_TEST_ROOT:stage};delete env.RENTAL_CASE;delete env.RENTAL_RESTORE_INPUT;
 const startedAt=new Date().toISOString(),results=[];
 try{
  results.push(await run('server.test.cjs',env,true));
  for(const file of ['receipt-browser.cjs','receipt-basis-browser.cjs','bill-basis-browser.cjs','quarter-browser.cjs','restored-data-browser.cjs'])results.push(await run(file,env));
 }finally{await new Promise(resolve=>server.close(resolve));}
 const out=path.join(root,'test-results');fs.mkdirSync(out,{recursive:true});for(const result of results)fs.writeFileSync(path.join(out,'gas-candidate-'+result.file+'.log'),result.log);
 assert.ok(results.every(row=>row.status==='pass'),'Candidate suite failed; inspect the saved suite logs');
 const unit=results[0].log.match(/(?:ℹ tests |# tests )(\d+)/),counts={};
 for(const [name,count] of [['receipt',11],['receipt-basis',8],['bill-basis',11],['quarter',8]]){const rows=JSON.parse(fs.readFileSync(path.join(out,name+'-browser-results.json')));assert.equal(rows.length,count);assert.ok(rows.every(row=>row.status==='pass'));counts[name]=rows.length;}
 const restored=JSON.parse(fs.readFileSync(path.join(out,'restored-data-results.json')));assert.equal(restored.appVersion,version);assert.equal(restored.privateInput,false);assert.equal(restored.results.length,6);assert.ok(restored.results.every(row=>row.status==='pass'));assert.ok(restored.startedAt>=startedAt);assert.equal(restored.sourceFilePreserved,true);assert.equal(restored.googleRequestsPerformed,false);assert.equal(restored.screenshotsTaken,false);counts['restored-data']=restored.results.length;
 const report={version,sourceCommit:manifest.sourceCommit,productValidationCommit:manifest.productValidationCommit,archiveSha256:hash(fs.readFileSync(zip)),startedAt,finishedAt:new Date().toISOString(),serverMockTests:Number(unit?.[1]),browserCases:counts,restoredData:restored,extractedAppHtmlSha256:hash(html),readFromZip:true,realGoogleWrites:false,productionDeployed:false,results:results.map(({log,...result})=>result)};
 fs.writeFileSync(path.join(out,'gas-candidate-validation.json'),JSON.stringify(report,null,2)+'\n');if(results.some(row=>row.status!=='pass'))process.exitCode=1;console.log('Archive verification: '+JSON.stringify(report));
})().catch(error=>{console.error(error);process.exitCode=1;});
