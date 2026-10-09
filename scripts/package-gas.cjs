/* Local packaging only. No Google API, credentials, deployment, or overwrite. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),vm=require('node:vm'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const names=['App.html','AuthorizeDocs.gs','Billing.gs','CalendarSync.gs','Code.gs','CurrentStatus.gs','IndependentApp.gs','appsscript.json'];
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8'));
function sourceFiles(directory){
 const actual=fs.readdirSync(path.join(directory,'server')).filter(name=>/\.gs$|^appsscript\.json$/.test(name)).sort();
 assert.deepEqual(actual,names.filter(name=>name!=='App.html').sort(),'Unexpected GAS source files');
 return names.map(name=>{const file=path.join(directory,name==='App.html'?'index.html':'server/'+name);assert.ok(!fs.lstatSync(file).isSymbolicLink(),'Symlink source is not allowed');return {name,data:fs.readFileSync(file)};});
}
function runArchive(args){execFileSync(process.env.RENTAL_PWSH||'pwsh',['-NoProfile','-NonInteractive','-File',path.join(__dirname,'gas-archive.ps1'),...args],{windowsHide:true,stdio:'pipe'});}
function createArchive(files,zipFile){
 assert.deepEqual(files.map(file=>file.name),names,'Exact public file allowlist is required');
 const stage=fs.mkdtempSync(path.join(os.tmpdir(),'rental-gas-pack-'));
 for(const file of files)fs.writeFileSync(path.join(stage,file.name),file.data,{flag:'wx'});
 runArchive(['-Mode','pack','-SourcePath',stage,'-ArchivePath',path.resolve(zipFile)]);return stage;
}
function inspectArchive(zipFile){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'rental-gas-inspect-')),result=path.join(directory,'entries.json');
 runArchive(['-Mode','inspect','-ArchivePath',path.resolve(zipFile),'-ResultPath',result]);
 return readJson(result).map(row=>({...row,data:Buffer.from(row.contentBase64,'base64')}));
}
function verifyArchive(zipFile,manifest){
 assert.equal(hash(fs.readFileSync(zipFile)),manifest.archive.sha256,'ZIP hash mismatch');
 assert.deepEqual(manifest.files.map(file=>file.name),names,'Manifest public file allowlist mismatch');
 const entries=inspectArchive(zipFile);assert.deepEqual(entries.map(file=>file.name),names,'ZIP file order or names mismatch');
 for(const expected of manifest.files){const actual=entries.find(file=>file.name===expected.name);assert.equal(actual.bytes,expected.bytes);assert.equal(actual.sha256,expected.sha256);assert.equal(hash(actual.data),expected.sha256);if(expected.name.endsWith('.gs'))new vm.Script(actual.data.toString('utf8'),{filename:expected.name});}
 const config=JSON.parse(entries.find(file=>file.name==='appsscript.json').data);assert.equal(config.webapp.access,'MYSELF');assert.equal(config.webapp.executeAs,'USER_DEPLOYING');assert.equal(config.timeZone,'Asia/Seoul');
 return entries;
}
function assertProof(directory,version){
 const proof=readJson(path.join(directory,'releases/development-bill-basis-'+version+'.json'));
 assert.equal(proof.appVersion,version);assert.ok(proof.validation.browser.results.every(row=>row.status==='pass'&&row.exitCode===0));assert.equal(proof.validation.unit.passed,proof.validation.unit.total);
 for(const [file,expected] of Object.entries(proof.sourceHashes))if(file!=='package.json')assert.equal(hash(fs.readFileSync(path.join(directory,file))),expected,'Verified source changed: '+file);
 assert.match(proof.sourceCommit,/^[a-f0-9]{40}$/);
 for(const name of names.filter(name=>name!=='App.html')){
  const committed=execFileSync('git',['show',proof.sourceCommit+':server/'+name],{cwd:directory,encoding:'utf8',maxBuffer:10000000});
  assert.equal(fs.readFileSync(path.join(directory,'server',name),'utf8').replaceAll('\r\n','\n'),committed.replaceAll('\r\n','\n'),'Validated GAS source changed: '+name);
 }
 return proof;
}
function packageCandidate(directory=root){
 const version=readJson(path.join(directory,'package.json')).version;assert.match(version,/^\d+\.\d+\.\d+$/);
 const proof=assertProof(directory,version),files=sourceFiles(directory),release=path.join(directory,'releases'),zipFile=path.join(release,'rental-independent-gas-'+version+'.zip'),manifestFile=path.join(release,'gas-candidate-'+version+'.json');
 if(fs.existsSync(zipFile)||fs.existsSync(manifestFile)){
  assert.ok(fs.existsSync(zipFile)&&fs.existsSync(manifestFile),'Incomplete existing candidate; preserve it and inspect before recovery');
  const existing=readJson(manifestFile);assert.equal(existing.version,version);verifyArchive(zipFile,existing);
  for(const file of files)assert.equal(hash(file.data),existing.files.find(entry=>entry.name===file.name).sha256,'Existing candidate differs from current source; use a new version');
  return {...existing,reused:true};
 }
 assert.equal(execFileSync('git',['status','--porcelain','--untracked-files=all'],{cwd:directory,encoding:'utf8'}).trim(),'','Commit source before creating a candidate');
 execFileSync(process.execPath,[path.join(directory,'scripts/build.cjs'),'--check'],{cwd:directory,stdio:'pipe'});
 const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:directory,encoding:'utf8'}).trim();
 const stage=fs.mkdtempSync(path.join(os.tmpdir(),'rental-gas-candidate-')),temporary=path.join(stage,'candidate.zip');createArchive(files,temporary);
 const manifest={version,sourceCommit,productValidationCommit:proof.sourceCommit,createdAt:new Date().toISOString(),deploymentPerformed:false,reviewCandidate:true,productionReady:false,receiptLedgerProtocol:'rental-receipts-v1',archive:{file:path.basename(zipFile),bytes:fs.statSync(temporary).size,sha256:hash(fs.readFileSync(temporary))},files:files.map(file=>({name:file.name,bytes:file.data.length,sha256:hash(file.data)})),remaining:['Opened-journal basis migration policy','Actual operating data reconciliation','Authorized Google write/readback Docs and Calendar verification','Physical phone offline update printing and screen reader checks']};
 verifyArchive(temporary,manifest);
 fs.copyFileSync(temporary,zipFile,fs.constants.COPYFILE_EXCL);fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});return manifest;
}
if(require.main===module){try{const result=packageCandidate();console.log(JSON.stringify({version:result.version,archive:result.archive,reused:result.reused===true,deploymentPerformed:false}));}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={names,hash,sourceFiles,createArchive,inspectArchive,verifyArchive,assertProof,packageCandidate};
