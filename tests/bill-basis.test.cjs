const test=require('node:test'),assert=require('node:assert/strict');
const billing=require('../assets/billing'),core=require('../assets/core');
const tenant={id:'correct-example',name:'이름 예시',biz:'상호 예시',unit:'201호',payday:'15일',rent:100000,mgmt:10000,elevator:1000},month='2026-07';
const invoice=extra=>billing.freezeBill(tenant,{electricity:35000,water:10000,waste:1000,...extra},month);
test('basis correction clones saved invoice and keeps tenant unknown fields raw unchanged values and estimate provenance',()=>{
 const bill=invoice({rent:'100000',memo:'보존 예시',paid:{pay_water:{date:null,note:null}},snapshotEstimated:['rent','contract'],custom:{text:'확장'}}),before=structuredClone(bill),originalTenant=structuredClone(tenant);
 const result=billing.correctBillBasis(tenant,bill,month,{mgmt:20000,tenantSnapshot:{name:'과거 이름 예시',contract:'2025/01/01~2027/12/31'}});
 assert.deepEqual(bill,before);assert.deepEqual(tenant,originalTenant);assert.equal(result.bill.rent,'100000');assert.equal(result.bill.mgmt,20000);assert.deepEqual(result.bill.custom,bill.custom);assert.deepEqual(result.bill.paid,bill.paid);assert.deepEqual(result.bill.snapshotEstimated,bill.snapshotEstimated);assert.equal(result.bill.tenantSnapshot.name,'과거 이름 예시');assert.deepEqual(result.changedPayments,['pay_mgmt']);
});
test('basis changed rent removes its old confirmation but retains raw payment metadata and all other dates',()=>{
 const bill=invoice({stampedRent:true,stampedRentDate:'2026/07/05',paid:{pay_rent:{date:'07/05',note:null},pay_water:{date:'07/07',note:'유지'}}});
 const result=billing.correctBillBasis(tenant,bill,month,{rent:120000});
 assert.equal(result.bill.stampedRent,false);assert.equal(result.bill.stampedRentDate,undefined);assert.deepEqual(result.bill.paid.pay_rent,{note:null});assert.deepEqual(result.bill.paid.pay_water,bill.paid.pay_water);assert.equal(billing.payment(tenant,result.bill).items.pay_rent.received,0);
});
test('basis dated management group retains unchanged future confirmations and only changed item needs review',()=>{
 const bill=invoice({stampedMgmt:true,stampedMgmtDate:'2199/07/05',paid:{pay_mgmt:{note:'유지'}}});
 const result=billing.correctBillBasis(tenant,bill,month,{mgmt:20000}),state=billing.payment(tenant,result.bill,'2026-10-10');
 assert.equal(result.bill.stampedMgmt,false);assert.equal(result.bill.paid.pay_mgmt.date,undefined);assert.equal(result.bill.paid.pay_mgmt.note,'유지');
 for(const key of ['pay_elec','pay_water','pay_elev','pay_waste'])assert.equal(result.bill.paid[key].date,'2199.07.05');
 assert.equal(state.received,0);assert.equal(billing.payment(tenant,result.bill,'2200-12-31').received,50600);
});
test('basis undated group requires whole group review without fabricating dates',()=>{
 const bill=invoice({stampedMgmt:true}),result=billing.correctBillBasis(tenant,bill,month,{mgmt:20000});
 assert.equal(result.bill.stampedMgmt,false);assert.equal(billing.payment(tenant,result.bill).received,0);assert.equal(bill.stampedMgmt,true);assert.ok(!Object.values(result.bill.paid||{}).some(item=>item.date));
});
test('basis elevator gross net and first floor use existing monetary rules',()=>{
 const bill=invoice({elevatorTotal:15001}),gross=billing.correctBillBasis(tenant,bill,month,{elevatorCharge:{mode:'gross',amount:15003}}).bill,net=billing.correctBillBasis(tenant,bill,month,{elevatorCharge:{mode:'net',amount:15000}}).bill;
 assert.equal(billing.charges(tenant,gross).pay_elev,15003);assert.equal(billing.charges(tenant,net).pay_elev,16500);assert.equal(net.elevatorTotal,undefined);
 const floor=billing.correctBillBasis(tenant,bill,month,{unitSnapshot:'101호'});assert.equal(billing.charges(tenant,floor.bill).pay_elev,0);assert.deepEqual(floor.changedPayments,['pay_elev']);assert.equal(floor.bill.elevatorTotal,15001);
});
test('basis payday contract text and explicit empty values affect only the frozen invoice',()=>{
 const bill=invoice(),result=billing.correctBillBasis(tenant,bill,month,{paydaySnapshot:'월말',tenantSnapshot:{biz:'',contract:'2026/01/01~2027/12/31',period_water_day:'20',period_water_odd:'odd'}});
 assert.equal(result.bill.tenantSnapshot.payday,'월말');assert.equal(result.bill.paydaySnapshot,'월말');assert.equal(billing.dueDate(billing.effectiveTenant(tenant,result.bill),'pay_rent',2026,7),'2026-07-31');assert.equal(result.bill.tenantSnapshot.biz,'');assert.equal(tenant.payday,'15일');assert.deepEqual(result.changedPayments,[]);
});
test('basis incomplete legacy values materialize explicitly without clearing provenance or confirmations',()=>{
 const bill={stampedRent:true,water:10000,paid:{pay_water:{date:null,note:null}}},result=billing.correctBillBasis(tenant,bill,month,{});
 assert.equal(result.bill.rent,100000);assert.equal(result.bill.stampedRent,true);assert.ok(result.bill.snapshotEstimated.includes('rent'));assert.deepEqual(result.changedPayments,[]);assert.deepEqual(result.bill.paid,bill.paid);assert.equal(bill.rent,undefined);
});
test('basis malformed patches amounts fields and ledger corrections are rejected without mutation',()=>{
 const bill=invoice(),raw=JSON.stringify(bill);
 for(const patch of [{rent:-1},{mgmt:1.5},{rent:1000000000001},{electricity:1},{tenantSnapshot:{other:'x'}},{tenantSnapshot:{name:null}},{unitSnapshot:201},{elevatorCharge:{mode:'wrong',amount:1}}])assert.throws(()=>billing.correctBillBasis(tenant,bill,month,patch));
 assert.equal(JSON.stringify(bill),raw);
 const ledger=structuredClone(bill);ledger.receiptLedger=billing.openReceiptLedger(tenant,ledger,month+':'+tenant.id,'2026-07-01T00:00:00.000Z');assert.throws(()=>billing.correctBillBasis(tenant,ledger,month,{rent:1}),/고정/);
});
test('basis correction remains schema one compatible and cannot change or open a ledger in the same transition',()=>{
 const before={...core.empty(),tenants:[tenant],bills:{[month]:{[tenant.id]:invoice()}}},after=structuredClone(before);
 after.bills[month][tenant.id]=billing.correctBillBasis(tenant,after.bills[month][tenant.id],month,{rent:120000}).bill;assert.doesNotThrow(()=>core.validateData(after));
 const bill=after.bills[month][tenant.id];bill.receiptLedger=billing.openReceiptLedger(tenant,bill,month+':'+tenant.id,'2026-07-01T00:00:00.000Z');assert.throws(()=>billing.assertReceiptDataTransition(before,after),/원장 개시와 기존 고지서/);
});
test('basis shared source runs without browser structuredClone in the generated server runtime',()=>{
 const vm=require('node:vm'),fs=require('node:fs'),context={};vm.runInNewContext(fs.readFileSync(require.resolve('../assets/billing'),'utf8'),context);
 const result=context.RentalBilling.correctBillBasis(tenant,invoice(),month,{rent:120000});assert.equal(result.bill.rent,120000);assert.deepEqual(JSON.parse(JSON.stringify(result.changedPayments)),['pay_rent']);
});
