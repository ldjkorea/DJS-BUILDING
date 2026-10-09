const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
const packaging=require('../scripts/package-gas.cjs'),root=path.resolve(__dirname,'..');
const files=packaging.sourceFiles(root),folder=fs.mkdtempSync(path.join(os.tmpdir(),'rental-package-tests-')),zip=path.join(folder,'first.zip');
const manifestFor=file=>({files:files.map(entry=>({name:entry.name,bytes:entry.data.length,sha256:packaging.hash(entry.data)})),archive:{sha256:packaging.hash(fs.readFileSync(file))}});
function recordedFixture(){
 const parent=path.join(root,'test-results');fs.mkdirSync(parent,{recursive:true});const fixture=fs.mkdtempSync(path.join(parent,'gas-proof-')),proofPath='releases/development-bill-basis-2.1.3.json',proof=JSON.parse(fs.readFileSync(path.join(root,proofPath)));
 // Pin the trusted historical commit; this synthetic proof hashes its Git bytes.
 // Windows worktree newline hashes in the real historical record remain untouched.
 for(const file of [...new Set([...Object.keys(proof.sourceHashes),...packaging.names.filter(name=>name!=='App.html').map(name=>'server/'+name),'package.json'])]){const dest=path.join(fixture,file);fs.mkdirSync(path.dirname(dest),{recursive:true});const bytes=execFileSync('git',['show',proof.sourceCommit+':'+file],{cwd:root,maxBuffer:10000000});fs.writeFileSync(dest,bytes);if(Object.hasOwn(proof.sourceHashes,file))proof.sourceHashes[file]=packaging.hash(bytes);}
 fs.mkdirSync(path.join(fixture,'releases'),{recursive:true});fs.writeFileSync(path.join(fixture,proofPath),JSON.stringify(proof));return fixture;
}
test('GAS candidate includes exact eight source bytes and reads back with independent ZIP runtime',()=>{
 packaging.createArchive(files,zip);const entries=packaging.verifyArchive(zip,manifestFor(zip));
 assert.deepEqual(entries.map(entry=>entry.name),packaging.names);for(const entry of entries)assert.deepEqual(entry.data,files.find(file=>file.name===entry.name).data);
});
test('GAS packaging is deterministic on the same runtime despite new staging paths and mtimes',()=>{
 const second=path.join(folder,'second.zip');packaging.createArchive(files,second);assert.deepEqual(fs.readFileSync(second),fs.readFileSync(zip));
});
test('GAS packaging never overwrites an existing archive and excludes secrets and unexpected entries',()=>{
 const before=fs.readFileSync(zip);assert.throws(()=>packaging.createArchive(files,zip));assert.deepEqual(fs.readFileSync(zip),before);
 assert.throws(()=>packaging.createArchive([...files,{name:'.clasp.json',data:Buffer.from('private')}],path.join(folder,'extra.zip')));assert.equal(fs.existsSync(path.join(folder,'extra.zip')),false);
 assert.throws(()=>packaging.createArchive(files.map((file,index)=>index?file:{...file,name:'../App.html'}),path.join(folder,'traversal.zip')));
});
test('GAS verification rejects corrupted archive hashes and wrong entry manifests before execution',()=>{
 const manifest=manifestFor(zip),tampered=path.join(folder,'tampered.zip'),bytes=fs.readFileSync(zip);bytes[40]^=1;fs.writeFileSync(tampered,bytes);
 assert.throws(()=>packaging.verifyArchive(tampered,manifest),/ZIP hash/);const wrong=structuredClone(manifest);wrong.files[0].sha256='0'.repeat(64);assert.throws(()=>packaging.verifyArchive(zip,wrong));
 const unsafe=structuredClone(manifest);unsafe.files[0].name='../App.html';assert.throws(()=>packaging.verifyArchive(zip,unsafe),/allowlist/);
});
test('Archived GAS bridge preserves nested null data and passes the receipt protocol to server handlers',()=>{
 const entry=packaging.verifyArchive(zip,manifestFor(zip)).find(file=>file.name==='IndependentApp.gs');let query,body;
 const context={doGet:event=>{query=event.parameter;return {getContent:()=>JSON.stringify({status:'ok',data:{nested:{value:null}}})};},doPost:event=>{body=event.postData.contents;return {getContent:()=>body};}};
 vm.runInNewContext(entry.data.toString('utf8'),context);const data={tenants:[],bills:{},extension:{nested:null}};
 assert.deepEqual(JSON.parse(context.independentRequest({method:'GET',receiptLedgerProtocol:'rental-receipts-v1'})),{status:'ok',data:{nested:{value:null}}});assert.equal(query.receiptLedgerProtocol,'rental-receipts-v1');
 assert.deepEqual(JSON.parse(context.independentRequest({method:'POST',body:JSON.stringify(data)})),data);assert.deepEqual(JSON.parse(body),data);
});
test('GAS packaging accepts the recorded product source and rejects byte drift before packaging',()=>{
 const fixture=recordedFixture();assert.equal(packaging.assertProof(fixture,'2.1.3').appVersion,'2.1.3');
 fs.appendFileSync(path.join(fixture,'assets/core.js'),'\n// unexpected drift');assert.throws(()=>packaging.assertProof(fixture,'2.1.3'),/Verified source changed: assets\/core.js/);
});
test('GAS execution gate rejects a forged ZIP and matching manifest against the recorded product',()=>{
 const fixture=recordedFixture(),verified=packaging.sourceFiles(fixture),altered=verified.map(file=>file.name==='Code.gs'?{...file,data:Buffer.concat([file.data,Buffer.from('\n// forged source\n')])}:file),forgedZip=path.join(folder,'forged.zip');
 packaging.createArchive(altered,forgedZip);
 const manifest={version:'2.1.3',productValidationCommit:packaging.assertProof(fixture,'2.1.3').sourceCommit,archive:{sha256:packaging.hash(fs.readFileSync(forgedZip))},files:altered.map(file=>({name:file.name,bytes:file.data.length,sha256:packaging.hash(file.data)}))};
 assert.equal(packaging.verifyArchive(forgedZip,manifest).length,8);assert.throws(()=>packaging.verifyCandidate(forgedZip,manifest,fixture),/Candidate entry differs from validated product source: Code.gs/);
});
test('GAS proof accepts the standard version record and refuses invalid standard proof rather than falling back',()=>{
 const fixture=recordedFixture(),legacyPath=path.join(fixture,'releases/development-bill-basis-2.1.3.json'),standard=path.join(fixture,'releases/development-2.1.3.json'),proof=JSON.parse(fs.readFileSync(legacyPath));fs.writeFileSync(standard,JSON.stringify(proof));assert.equal(packaging.assertProof(fixture,'2.1.3').sourceCommit,proof.sourceCommit);
 proof.validation.browser.results[0].status='fail';fs.writeFileSync(standard,JSON.stringify(proof));assert.throws(()=>packaging.assertProof(fixture,'2.1.3'));
});
