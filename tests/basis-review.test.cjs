const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {prepare,writeQueue}=require('../scripts/prepare-basis-review.cjs'),billing=require('../assets/billing.js'),core=require('../assets/core.js');
const root=path.resolve(__dirname,'..');
function fixture(){const data=core.empty(),tenant={id:'anonymous-review',name:'Anonymous',unit:'201호',rent:100000,mgmt:10000,elevator:0,payday:'15일'};data.tenants=[tenant];data.bills={'2026-09':{[tenant.id]:billing.freezeBill(tenant,{snapshotEstimated:['rent','name'],extension:{value:null}},'2026-09')}};return data;}
test('basis review preserves raw source and leaves estimated matching invoices unresolved',()=>{
 const data=fixture(),raw=JSON.stringify(data),queue=prepare(data,'2026-10-10');assert.equal(JSON.stringify(data),raw);assert.equal(queue.summary.reviewInvoices,1);assert.equal(queue.summary.confirmedInvoices,0);assert.equal(queue.entries[0].status,'needs_source');assert.deepEqual(queue.entries[0].sourceEvidence,[]);assert.deepEqual(queue.entries[0].estimatedFields,['rent','name']);assert.match(queue.entries[0].storedBillSha256,/^[a-f0-9]{64}$/);
 const stored=queue.entries[0].storedBillSha256;data.bills['2026-09']['anonymous-review'].rent++;assert.notEqual(prepare(data,'2026-10-10').entries[0].storedBillSha256,stored);
});
test('basis review includes incomplete orphan invoices and excludes complete stored bills',()=>{
 const data=fixture();delete data.bills['2026-09']['anonymous-review'].snapshotEstimated;data.bills['2026-08']={orphan:{rent:0,mgmt:0}};const queue=prepare(data,'2026-10-10');assert.equal(queue.summary.savedInvoices,2);assert.equal(queue.entries.length,1);assert.equal(queue.entries[0].tenantId,'orphan');assert.equal(queue.summary.missingSnapshotInvoices,1);
});
test('basis review rejects corrupted snapshots and ambiguous dates before output',()=>{
 assert.throws(()=>prepare(fixture(),'2026-02-29'));assert.throws(()=>prepare({values:[]},'2026-10-10'));const data=fixture();data.bills['2026-09']['anonymous-review'].rent=-1;assert.throws(()=>prepare(data,'2026-10-10'));
});
test('basis review writes only new private output and preserves source and existing review',()=>{
 const privateRoot=path.join(root,'.private');fs.mkdirSync(privateRoot,{recursive:true});const folder=fs.mkdtempSync(path.join(privateRoot,'basis-review-test-')),input=path.join(folder,'input.json'),output=path.join(folder,'queue');fs.writeFileSync(input,JSON.stringify(fixture()));const source=fs.readFileSync(input);assert.equal(writeQueue(input,'2026-10-10',output).reviewInvoices,1);const original=fs.readFileSync(path.join(output,'queue.json'));assert.throws(()=>writeQueue(input,'2026-10-10',output),/preserved/);assert.throws(()=>writeQueue(input,'2026-10-10',path.join(os.tmpdir(),'review-public-'+path.basename(folder))),/private/);assert.deepEqual(fs.readFileSync(input),source);assert.deepEqual(fs.readFileSync(path.join(output,'queue.json')),original);
});
