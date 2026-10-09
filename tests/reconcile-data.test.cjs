const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{execFileSync}=require('node:child_process');
const r=require('../scripts/reconcile-data.cjs'),b=require('../assets/billing.js'),core=require('../assets/core.js');
const root=path.resolve(__dirname,'..'),legacySource=execFileSync('git',['show','2b01a2e:assets/billing.js'],{cwd:root,encoding:'utf8'}),legacy=r.rulesFromSource(legacySource);
const clone=value=>JSON.parse(JSON.stringify(value));
function fixture(){const data=core.empty();data.tenants=[{id:'a',name:'Anonymous',unit:'201호',rent:100000,mgmt:10000,elevator:0,payday:'15일'}];data.bills={'2026-09':{a:{rent:100000,mgmt:10000,electricity:35000,water:10000,waste:1000,stampedRent:true,stampedRentDate:'2026.09.15',paid:{pay_water:{na:true,date:'',note:null}},extension:{value:null}}}};b.freezeBill(data.tenants[0],data.bills['2026-09'].a,'2026-09');data.extension={history:[null,{original:'kept'}]};return data;}
test('reconciliation decodes backup storage envelope and multirow JSON without dropping null extensions',()=>{
 const data=fixture(),envelope={format:'rental-sync-storage-v2',data,receipts:[]},raw=JSON.stringify(envelope),sheet={values:[[raw.slice(0,80)],[raw.slice(80)],[]]};
 for(const input of [data,envelope,sheet])assert.deepEqual(r.decodeSnapshot(input),data);
 for(const input of [{values:[]},{values:[[1]]},{values:[['x','y']]},{format:'rental-sync-storage-v2',data:null},[]])assert.throws(()=>r.decodeSnapshot(input));
});
test('reconciliation checks every saved invoice item at payment and due boundaries without modifying input',()=>{
 const data=fixture(),before=clone(data),result=r.reconcileSnapshot(data,b,b,'2026-10-10');assert.deepEqual(data,before);assert.equal(result.summary.comparisonPassed,true);assert.equal(result.summary.reviewRequired,false);
 for(const day of ['2026-09-14','2026-09-15','2026-09-16','2026-09-29','2026-09-30','2026-10-01','2026-10-10'])assert.ok(result.dates.includes(day));assert.equal(result.itemComparisons,result.dates.length*6);
});
test('reconciliation compares trusted cloned legacy billing for fully dated saved invoices',()=>{
 const result=r.reconcileSnapshot(fixture(),legacy,b,'2026-10-10');assert.equal(result.summary.comparisonPassed,true);assert.equal(result.summary.normalizationChanges,0);
});
test('reconciliation detects future undated and unknown due regressions rather than accepting equal totals only',()=>{
 const data=fixture();data.bills['2026-09'].a.stampedRentDate='2199.07.05';
 const wrong={...b,historicalPayment(...args){const state=b.historicalPayment(...args);state.items.pay_rent.date='invented';return state;}};
 const result=r.reconcileSnapshot(data,wrong,b,'2026-10-10');assert.equal(result.summary.comparisonPassed,false);assert.ok(result.summary.baselineFinancialDifferences>0);assert.ok(result.differences.some(row=>row.path==='/items/pay_rent/date'));
 assert.ok(result.dates.includes('2199-07-04'));assert.ok(result.dates.includes('2199-07-06'));
});
test('reconciliation reports core normalization separately and preserves original values and audit',()=>{
 const data=fixture();data.tenants[0].deposit='1,000';data.bills['2026-09'].a.mgmtItems=[{name:'Legacy anonymous',amount:10000}];data.bills['2026-09'].a.audit=[{at:'2026-10-01T00:00:00.000Z',action:'checked',detail:'kept'}];const before=clone(data);
 const result=r.reconcileSnapshot(data,b,b,'2026-10-10');assert.deepEqual(data,before);assert.ok(result.summary.normalizationChanges>=2);assert.equal(result.summary.normalizationFinancialDifferences,0);assert.equal(result.summary.reviewRequired,true);assert.ok(result.validationChanges.some(row=>row.path==='/tenants/0/deposit'));assert.ok(!JSON.stringify(result.validationChanges).includes('Legacy anonymous'));
});
test('reconciliation includes orphan archived and empty saved months while excluding empty invoices',()=>{
 const data=fixture();data.tenants[0].archived=true;data.bills['2026-08']={orphan:{rent:200000,mgmt:0,unitSnapshot:'301호',paydaySnapshot:'15일'},empty:{}};data.bills['2026-07']={};
 const result=r.reconcileSnapshot(data,b,b,'2026-10-10');assert.equal(result.billCount,2);assert.equal(result.monthCount,3);assert.equal(result.summary.comparisonPassed,true);assert.equal(result.basis.missingSnapshotInvoices,1);assert.equal(result.summary.reviewRequired,true);assert.equal(result.invoiceIndex.find(row=>row.id==='orphan').month,'2026-08');
});
test('reconciliation rejects malformed dates and dangerous or invalid domain records',()=>{
 const data=fixture();assert.throws(()=>r.reconcileSnapshot(data,b,b,'2026-02-29'));assert.throws(()=>r.reconcileSnapshot(data,b,b,'10/10'));data.bills['2026-09'].a.water=-1;assert.throws(()=>r.reconcileSnapshot(data,b,b,'2026-10-10'));
 const dangerous=JSON.parse('{"tenants":[],"bills":{},"extension":{"__proto__":{}}}');assert.throws(()=>r.reconcileSnapshot(dangerous,b,b,'2026-10-10'));
});
test('reconciliation rejects a baseline that silently ignores ledgers and supports compatible partial receipts',()=>{
 const data=fixture(),tenant=data.tenants[0],bill=data.bills['2026-09'].a;bill.stampedRent=false;delete bill.stampedRentDate;b.freezeBill(tenant,bill,'2026-09');bill.receiptLedger=b.openReceiptLedger(tenant,bill,'2026-09:a','2026-09-01T00:00:00.000Z');bill.receiptLedger=b.appendReceiptEvent(bill.receiptLedger,{kind:'receipt',id:'r1',billId:'2026-09:a',item:'pay_rent',amount:10000,receivedOn:'2026-09-17',recordedAt:'2026-09-17T00:00:00.000Z',note:'anonymous'});
 assert.throws(()=>r.reconcileSnapshot(data,legacy,b,'2026-10-10'),/cannot compare receipt ledgers/);const result=r.reconcileSnapshot(data,b,b,'2026-10-10');assert.equal(result.summary.comparisonPassed,true);assert.ok(result.dates.includes('2026-09-16'));assert.ok(result.dates.includes('2026-09-18'));
});
test('reconciliation detects aggregate-only drift in arrears and collection dates',()=>{
 const wrong={...b,arrears(...args){return {...b.arrears(...args),total:1};},collectionStatus(...args){return {...b.collectionStatus(...args),lastPaymentDate:'2099-01-01'};}};
 const result=r.reconcileSnapshot(fixture(),wrong,b,'2026-10-10');assert.equal(result.summary.comparisonPassed,false);assert.ok(result.aggregateDifferences.some(row=>row.kind==='arrears'));assert.ok(result.aggregateDifferences.some(row=>row.kind==='collection'));
});
test('reconciliation keeps estimated basis pending even when old and new financial projections match',()=>{
 const data=fixture();data.bills['2026-09'].a.snapshotEstimated=['rent','payday','name'];const result=r.reconcileSnapshot(data,b,b,'2026-10-10');assert.equal(result.summary.comparisonPassed,true);assert.equal(result.summary.reviewRequired,true);assert.equal(result.basis.estimatedInvoices,1);assert.equal(result.summary.basisReviewInvoices,1);assert.deepEqual(result.basisReview[0].estimatedFields,['rent','payday','name']);assert.deepEqual(data.bills['2026-09'].a.snapshotEstimated,['rent','payday','name']);
});
test('reconciliation checks generated GAS parity and independent saved-invoice quarter sums',()=>{
 const data=fixture(),gas=r.rulesFromSource(fs.readFileSync(path.join(root,'server/Billing.gs'),'utf8')),good=r.reconcileSnapshot(data,b,b,'2026-10-10',gas);assert.equal(good.gasCompared,true);assert.equal(good.summary.comparisonPassed,true);assert.equal(good.quarterComparisons,good.dates.length);
 const wrong={...b,historicalPayment(...args){const state=b.historicalPayment(...args);state.items.pay_rent.received++;return state;}};assert.ok(r.reconcileSnapshot(data,b,b,'2026-10-10',wrong).summary.gasFinancialDifferences>0);
 const badQuarter={...b,quarterlyStatement(...args){const state=b.quarterlyStatement(...args);state.totals.gross++;return state;}};assert.ok(r.reconcileSnapshot(data,b,badQuarter,'2026-10-10').aggregateDifferences.some(row=>row.kind==='quarter'&&row.field==='gross'));
});
test('reconciliation CLI enforces private new reports and never overwrites or changes input',()=>{
 const folder=fs.mkdtempSync(path.join(os.tmpdir(),'rental-reconcile-')),input=path.join(folder,'input.json');fs.writeFileSync(input,JSON.stringify(fixture()));const original=fs.readFileSync(input);
 assert.throws(()=>r.main([input,'2026-10-10','2b01a2e',path.join(folder,'public.json')]),/private/);
 const out=path.join(root,'.private','reconcile-test-'+path.basename(folder)+'.json');assert.equal(r.main([input,'2026-10-10','2b01a2e',out]),0);const first=fs.readFileSync(out);assert.throws(()=>r.main([input,'2026-10-10','2b01a2e',out]),/preserved/);assert.deepEqual(fs.readFileSync(input),original);assert.deepEqual(fs.readFileSync(out),first);
});
