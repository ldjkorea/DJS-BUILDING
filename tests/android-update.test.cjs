const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {packageRelease,MAX_BYTES}=require('../scripts/package-android-update.cjs');
const signer='b25160850067d115c493fe51aca9bdce1956d999ed45cee0950bd86d33c5a2a0';
function runtime(bytes){const release=packageRelease(bytes,'4.1.0',5,signer),context={};vm.createContext(context);vm.runInContext(release.source,context);return {release,context};}
test('APK transport serves exactly the packaged bytes and binds every chunk to release hash version and index',()=>{
 const bytes=Buffer.alloc(1700000,7);bytes[0]=80;bytes[1]=75;const {release,context}=runtime(bytes),manifest=context.androidUpdateResponse_({action:'androidUpdateManifest'}).release;
 assert.deepEqual(JSON.parse(JSON.stringify(manifest)),release.manifest);
 const parts=[];for(let i=0;i<manifest.chunkCount;i++){const row=context.androidUpdateResponse_({action:'androidUpdateChunk',version:'5',sha256:manifest.sha256,index:String(i)});assert.equal(row.index,i);parts.push(Buffer.from(row.base64,'base64'));}
 assert.deepEqual(Buffer.concat(parts),bytes);
 for(const patch of [{version:'4'},{sha256:'a'.repeat(64)},{index:'-1'},{index:'0.0'},{index:'01'},{index:'99'},{index:'0;eval()'},{action:'restore'}])assert.equal(context.androidUpdateResponse_({action:'androidUpdateChunk',version:'5',sha256:manifest.sha256,index:'0',...patch}).status,'error');
});
test('APK packaging rejects oversized non-ZIP files and malformed release versions',()=>{
 const apk=Buffer.from('PKab');for(const [bytes,name,code,cert] of [[Buffer.from('html'),'4.1.0',5,signer],[Buffer.alloc(MAX_BYTES+1),'4.1.0',5,signer],[apk,'javascript:bad',5,signer],[apk,'4.1.0',0,signer],[apk,'4.1.0',5,'bad']])assert.throws(()=>packageRelease(bytes,name,code,cert));
});
test('public update GET never opens rental library or serves caller-supplied files',()=>{
 const {context}=runtime(Buffer.from('PKab'));let backend=0;
 Object.assign(context,{ContentService:{MimeType:{JSON:'json'},createTextOutput:text=>({setMimeType:()=>text})},RentalBackend:{getAppUpdateInfo(){backend++;return {androidVersionCode:5}}}});
 vm.runInContext(fs.readFileSync(require('node:path').join(__dirname,'../server/native-api/Code.gs'),'utf8'),context);
 assert.equal(JSON.parse(context.doGet({parameter:{action:'androidUpdateManifest'}})).status,'ok');assert.equal(backend,0);
 assert.equal(JSON.parse(context.doGet({parameter:{action:'androidUpdateChunk',version:'5',sha256:'a'.repeat(64),index:'0',fileId:'private-sheet'}})).status,'error');assert.equal(backend,0);
 assert.equal(JSON.parse(context.doGet({parameter:{action:'read'}})).androidVersionCode,5);assert.equal(backend,1);
});
