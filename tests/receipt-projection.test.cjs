const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const b=require('../assets/billing.js');
const tenant={id:'projection1',name:'입금 검증',unit:'201호',rent:100000,mgmt:10000,elevator:0,payday:'15일'};
function fixture(extra={}){const bill=b.freezeBill(tenant,{electricity:35000,water:10000,waste:1000,...extra},'2026-10');bill.receiptLedger=b.openReceiptLedger(tenant,bill,'2026-10:projection1','2026-10-01T00:00:00.000Z');return bill;}
function add(bill,id,amount,date='2026-10-02'){bill.receiptLedger=b.appendReceiptEvent(bill.receiptLedger,{kind:'receipt',id,billId:'2026-10:projection1',item:'pay_rent',amount,receivedOn:date,recordedAt:'2026-10-10T00:00:00.000Z',note:'확인'});return bill;}
test('official payment and groups count partial cash and exact remaining balances',()=>{
 const bill=add(fixture(),'one',30000),before=JSON.stringify(bill),state=b.payment(tenant,bill,'2026-10-10');assert.deepEqual([state.total,state.received,state.unpaid],[170500,30000,140500]);assert.deepEqual([state.groups.rent.received,state.groups.rent.unpaid,state.groups.rent.complete],[30000,80000,false]);assert.equal(state.items.pay_rent.partial,true);assert.equal(state.items.pay_rent.date,'2026.10.02');assert.equal(JSON.stringify(bill),before);
 add(bill,'two',80000,'2026-10-05');const complete=b.payment(tenant,bill,'2026-10-10');assert.equal(complete.groups.rent.complete,true);assert.equal(complete.complete,false);assert.equal(complete.unpaid,60500);assert.deepEqual(complete.groups.rent.dates,['2026.10.02','2026.10.05']);
});
test('historical payment classifies only remaining amounts while received plus unpaid equals charge',()=>{
 const bill=add(fixture(),'one',30000);
 for(const [asOf,received,notDue,overdue] of [['2026-10-01',0,170500,0],['2026-10-02',30000,140500,0],['2026-10-15',30000,140500,0],['2026-10-16',30000,60500,80000],['2026-11-01',30000,0,140500]]){
  const state=b.historicalPayment(tenant,bill,2026,10,asOf);assert.deepEqual([state.received,state.notDue,state.overdue],[received,notDue,overdue]);assert.equal(state.received+state.unpaid,state.total);assert.equal(state.items.pay_rent.unpaid,received?80000:110000);
 }
 const unknown=add(fixture({paydaySnapshot:''}),'one',30000);const state=b.historicalPayment({...tenant,payday:''},unknown,2026,10,'2026-11-01');assert.equal(state.unknownDue,80000);assert.equal(state.overdue,60500);
});
test('arrears collection and recent date use partial receipts without counting original gross twice',()=>{
 const bill=add(fixture(),'one',30000),bills={'2026-10':{projection1:bill}};const late=b.arrears([tenant],bills,'2026-11-01');assert.equal(late.total,140500);assert.equal(late.tenants[0].months[0].amount,140500);
 const state=b.collectionStatus(tenant,bills,'2026-10-16');assert.deepEqual([state.overdueRent,state.overdueUtilities,state.totalUnpaid,state.lastPaymentDate],[80000,0,140500,'2026-10-02']);
 add(bill,'two',80000,'2026-10-05');assert.equal(b.collectionStatus(tenant,bills,'2026-10-16').lastPaymentDate,'2026-10-05');assert.equal(b.collectionStatus(tenant,bills,'2026-10-16').overdueRent,0);
});
test('current knowledge cancellation affects every projection while retaining legacy evidence',()=>{
 const bill=add(fixture({stampedMgmt:true}),'one',30000);assert.equal(b.payment(tenant,bill,'2026-10-10').received,90500);
 bill.receiptLedger=b.appendReceiptEvent(bill.receiptLedger,{kind:'void',id:'void-one',billId:'2026-10:projection1',reference:'one',recordedAt:'2026-10-11T00:00:00.000Z',reason:'정정'});
 assert.equal(b.payment(tenant,bill,'2026-10-10').received,60500);assert.equal(b.historicalPayment(tenant,bill,2026,10,'2026-11-01').overdue,110000);assert.equal(b.collectionStatus(tenant,{'2026-10':{projection1:bill}},'2026-11-01').lastPaymentDate,'');assert.equal(bill.receiptLedger.legacy.stampedMgmt,true);assert.equal(bill.receiptLedger.events.length,2);
});
test('client and generated GAS share receipt-aware historical and collection projections',()=>{
 const bill=add(fixture(),'one',30000),ctx=vm.createContext({});vm.runInContext(fs.readFileSync('server/Billing.gs','utf8'),ctx);const same=x=>JSON.parse(JSON.stringify(x));
 assert.deepEqual(same(ctx.RentalBilling.payment(tenant,bill,'2026-10-10')),b.payment(tenant,bill,'2026-10-10'));assert.deepEqual(same(ctx.RentalBilling.historicalPayment(tenant,bill,2026,10,'2026-11-01')),b.historicalPayment(tenant,bill,2026,10,'2026-11-01'));assert.deepEqual(same(ctx.RentalBilling.collectionStatus(tenant,{'2026-10':{projection1:bill}},'2026-11-01')),b.collectionStatus(tenant,{'2026-10':{projection1:bill}},'2026-11-01'));
});
test('GAS hosted adapter forwards explicit receipt protocol and retains JSON null evidence',()=>{
 let query,body;const stored={bills:{'2026-10':{projection1:add(fixture(),'one',30000)}},nullable:null};
 const context=vm.createContext({doGet:event=>{query=event.parameter;return {getContent:()=>JSON.stringify(stored)};},doPost:event=>{body=event.postData.contents;return {getContent:()=>body};}});
 vm.runInContext(fs.readFileSync('server/IndependentApp.gs','utf8'),context);
 assert.deepEqual(JSON.parse(context.independentRequest({method:'GET',receiptLedgerProtocol:b.RECEIPT_FORMAT})),stored);assert.equal(query.receiptLedgerProtocol,b.RECEIPT_FORMAT);
 const request=JSON.stringify({protocol:'rental-sync-v2',receiptLedgerProtocol:b.RECEIPT_FORMAT,data:stored});assert.equal(context.independentRequest({method:'POST',body:request}),request);assert.equal(body,request);
});
