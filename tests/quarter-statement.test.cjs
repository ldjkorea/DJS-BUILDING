const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const b=require('../assets/billing.js');
const tenant={id:'quarter1',name:'분기 예시',biz:'예시 사무실',unit:'201호',rent:100000,mgmt:10000,elevator:0,payday:'15일',bizNo:'123-45-67890',deposit:1000000};
const bill=(extra={},month='2026-07',person=tenant)=>b.freezeBill(person,{water:10000,...extra},month);
test('quarter only aggregates saved invoices and never invents missing month revenue or issuance',()=>{
 const bills={'2026-07':{quarter1:bill({invoiceIssued:true})}},before=JSON.stringify(bills),r=b.quarterlyStatement([tenant],bills,2026,3,'2026-10-10');
 assert.deepEqual([r.totals.billCount,r.totals.invoiceCount,r.totals.taxableNet,r.totals.vat,r.totals.otherCharges,r.totals.gross],[1,1,110000,11000,10000,131000]);assert.equal(r.rows[0].months.length,1);assert.equal(JSON.stringify(bills),before);
 const empty=b.quarterlyStatement([tenant],{},2026,3,'2026-10-10');assert.equal(empty.rows.length,0);assert.equal(empty.totals.gross,0);assert.equal(empty.totals.billCount,0);
});
test('quarter preserves archived orphan and changed saved identity and splits distinct past occupants',()=>{
 const old={...tenant,name:'과거 이름',biz:'과거 사무실',unit:'301호'},bills={'2026-07':{quarter1:bill({},'2026-07',old)},'2026-08':{quarter1:bill({},'2026-08'),orphan:bill({},'2026-08',{...tenant,id:'orphan',name:'미등록 과거'})}};
 const r=b.quarterlyStatement([{...tenant,archived:true}],bills,2026,3,'2026-10-10');assert.equal(r.rows.length,3);assert.equal(r.totals.billCount,3);assert.ok(r.rows.some(row=>row.identity.name==='과거 이름'&&row.identity.unit==='301호'));assert.ok(r.rows.some(row=>row.orphan));assert.equal(r.rows.find(row=>row.identity.name==='과거 이름').identity.bizNo,'');
});
test('quarter adds per-invoice VAT and all payable items including waste without aggregate rerounding',()=>{
 const tiny={...tenant,rent:5,mgmt:5},bills=Object.fromEntries(['07','08','09'].map(m=>['2026-'+m,{quarter1:bill({electricity:5,water:2,waste:3,elevatorTotal:4},'2026-'+m,tiny)}]));
 const r=b.quarterlyStatement([tiny],bills,2026,3,'2026-10-10');assert.equal(r.totals.taxableNet,45);assert.equal(r.totals.vat,9);assert.equal(r.totals.otherCharges,27);assert.equal(r.totals.gross,81);assert.equal(r.totals.gross,r.totals.taxableNet+r.totals.vat+r.totals.otherCharges);
});
test('quarter excludes NA charges retains numeric strings and does not mutate raw paid metadata',()=>{
 const saved=bill({rent:'100,000',mgmt:'10,000',electricity:'35,000',waterNA:true,waste:5,paid:{pay_rent:{na:true,date:null,extra:'보존'},pay_mgmt:{na:true}}}),before=JSON.stringify(saved);
 const r=b.quarterlyStatement([tenant],{'2026-07':{quarter1:saved}},2026,3,'2026-10-10');assert.deepEqual([r.totals.taxableNet,r.totals.vat,r.totals.otherCharges,r.totals.gross],[35000,3500,5,38505]);assert.equal(JSON.stringify(saved),before);
});
test('quarter payment distinguishes partial overdue not due unknown due and full or zero confirmations',()=>{
 const saved=bill();saved.receiptLedger=b.openReceiptLedger(tenant,saved,'2026-07:quarter1','2026-07-01T00:00:00.000Z');saved.receiptLedger=b.appendReceiptEvent(saved.receiptLedger,{kind:'receipt',id:'quarter-receipt',billId:'2026-07:quarter1',item:'pay_rent',amount:30000,receivedOn:'2026-07-02',recordedAt:'2026-07-02T00:00:00.000Z',note:'예시'});
 const bills={'2026-07':{quarter1:saved}};for(const [day,received,overdue,notDue] of [['2026-07-01',0,0,131000],['2026-07-15',30000,0,101000],['2026-07-16',30000,80000,21000],['2026-08-01',30000,101000,0]]){const r=b.quarterlyStatement([tenant],bills,2026,3,day);assert.deepEqual([r.totals.received,r.totals.overdue,r.totals.notDue],[received,overdue,notDue]);assert.equal(r.totals.received+r.totals.unpaid,r.totals.gross);}
 const unknown=b.quarterlyStatement([tenant],{'2026-07':{quarter1:bill({paydaySnapshot:''})}},2026,3,'2026-08-01');assert.equal(unknown.totals.unknownDue,110000);assert.equal(unknown.totals.overdue,21000);
 const zero=b.quarterlyStatement([{...tenant,rent:0,mgmt:0}],{'2026-07':{quarter1:bill({rent:0,mgmt:0,water:0})}},2026,3,'2026-08-01');assert.equal(zero.rows[0].gross,0);assert.equal(zero.rows[0].received,0);
});
test('quarter current registration metadata is labelled and unsupported period or cutoff is rejected',()=>{
 const r=b.quarterlyStatement([tenant],{'2026-07':{quarter1:bill({snapshotEstimated:['payday']})}},2026,3,'2026-10-10');assert.equal(r.rows[0].metadataSource,'current');assert.deepEqual(r.rows[0].estimatedFields,['payday']);assert.equal(r.rows[0].identity.bizNo,tenant.bizNo);
 for(const args of [[2026,0,'2026-10-10'],[2026,5,'2026-10-10'],[1900,1,'bad'],[2201,1,'2026-10-10']])assert.throws(()=>b.quarterlyStatement([tenant],{},...args));
});
test('generated GAS and client use the same quarterly statement with preserved snapshots',()=>{
 const ctx=vm.createContext({});vm.runInContext(fs.readFileSync('server/Billing.gs','utf8'),ctx);const bills={'2026-07':{quarter1:bill({stampedRent:true})}};
 assert.deepEqual(JSON.parse(JSON.stringify(ctx.RentalBilling.quarterlyStatement([tenant],bills,2026,3,'2026-10-10'))),b.quarterlyStatement([tenant],bills,2026,3,'2026-10-10'));
});
test('quarter rejects aggregate overflow instead of silently rounding money outside safe integers',()=>{
 const massive=bill({rent:1e12,mgmt:1e12,electricity:1e12,water:0});const bills={'2026-07':Object.fromEntries(Array.from({length:3000},(_,index)=>['large'+index,massive]))};
 assert.throws(()=>b.quarterlyStatement([],bills,2026,3,'2026-10-10'),/정수 범위/);assert.equal(massive.rent,1e12);
});
