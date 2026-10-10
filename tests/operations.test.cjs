const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const b=require('../assets/billing.js'),core=require('../assets/core.js'),clone=value=>JSON.parse(JSON.stringify(value));
const tenant={id:'anonymous-op',name:'Anonymous',unit:'201호',rent:100000,mgmt:10000,elevator:0,payday:'15일',contract:'2025/01/01 ~ 2027/12/31'};
const repair=()=>({id:'repair1',kind:'repair',location:'201호',occurredOn:'2026-10-09',recordedAt:'2026-10-10T00:00:00.000Z',amount:30000,description:'익명 수리',evidenceUrl:'https://example.com/receipt'});
const change=()=>b.createContractChange(tenant,{...tenant,rent:120000},{id:'change1',effectiveOn:'2026-10-01',recordedAt:'2026-10-10T00:00:00.000Z',reason:'익명 계약 대조'});
test('contract change records exact prior terms and effective date without rewriting invoice or tenant',()=>{
 const before=clone(tenant),bill=b.freezeBill(tenant,{invoiceIssued:true},'2026-09'),raw=JSON.stringify(bill),row=change();assert.deepEqual(tenant,before);assert.equal(JSON.stringify(bill),raw);assert.equal(row.before.rent,100000);assert.equal(row.after.rent,120000);assert.equal(row.effectiveOn,'2026-10-01');assert.equal(b.createContractChange(tenant,{...tenant,rent:'100000'},{id:'same'}),null);
 assert.throws(()=>b.createContractChange(tenant,{...tenant,rent:120000},{id:'future',effectiveOn:'2026-10-11',recordedAt:'2026-10-10T00:00:00.000Z'}),/날짜/);
});
test('operational records preserve prefixes and allow reasoned repair cancellation with raw originals',()=>{
 const before={contractChanges:[change()],propertyRecords:[repair()]},after=clone(before);after.propertyRecords.push({kind:'void',id:'void1',reference:'repair1',recordedAt:'2026-10-10T01:00:00.000Z',reason:'증빙 재확인'});assert.equal(b.assertOperationsTransition(before,after),after);assert.deepEqual(after.propertyRecords[0],before.propertyRecords[0]);
 for(const key of ['contractChanges','propertyRecords']){const removed=clone(before);delete removed[key];assert.throws(()=>b.assertOperationsTransition(before,removed),/제거/);const altered=clone(before);altered[key][0].recordedAt='2026-10-10T01:00:00.000Z';assert.throws(()=>b.assertOperationsTransition(before,altered),/변경/);}
 const repeated=clone(after);repeated.propertyRecords.push({...after.propertyRecords[1],id:'void2'});assert.throws(()=>b.validateOperationsData(repeated),/취소/);
});
test('operational validation rejects unsafe evidence wrong money dates duplicate IDs and chronology',()=>{
 for(const patch of [{evidenceUrl:'javascript:alert(1)'},{evidenceUrl:'https://user:secret@example.com/receipt'},{amount:-1},{amount:1.2},{occurredOn:'2026-02-29'},{occurredOn:'2026-10-11'},{description:''},{recordedAt:'2026-99-99T00:00:00.000Z'},{unexpected:true}])assert.throws(()=>b.validateOperationsData({propertyRecords:[{...repair(),...patch}]}));
 assert.throws(()=>b.validateOperationsData({propertyRecords:[repair(),repair()]}),/중복/);assert.throws(()=>b.validateOperationsData({propertyRecords:[repair(),{...repair(),id:'repair2',recordedAt:'2026-10-09T00:00:00.000Z'}]}),/순서/);assert.throws(()=>b.validateOperationsData({contractChanges:null}));
});
test('local save and backup restore cannot erase or edit operational records; legacy data stays compatible',()=>{
 const data={...core.empty(),tenants:[tenant],contractChanges:[change()],propertyRecords:[repair()]},memory=new Map(),storage={getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)};core.persist(storage,data);const raw=storage.getItem(core.STATE_KEY),old=core.empty();assert.throws(()=>core.persist(storage,old),/제거/);assert.equal(storage.getItem(core.STATE_KEY),raw);assert.deepEqual(core.validateData(data),data);const next=clone(data);next.propertyRecords.push({kind:'void',id:'void1',reference:'repair1',recordedAt:'2026-10-10T01:00:00.000Z',reason:'대조'});core.persist(storage,next);assert.equal(core.load(storage).data.propertyRecords.length,2);assert.deepEqual(core.validateData(core.empty()),core.empty());
 memory.set(core.STATE_KEY,'{"contractChanges":[');assert.throws(()=>core.persist(storage,old),/덮어쓰기/);
});
test('income trend uses receipt dates across invoice years and observes cancellation knowledge date',()=>{
 const data={...core.empty(),tenants:[tenant],bills:{'2025-12':{[tenant.id]:b.freezeBill(tenant,{},'2025-12')}}},bill=data.bills['2025-12'][tenant.id];bill.receiptLedger=b.openReceiptLedger(tenant,bill,'2025-12:'+tenant.id,'2025-12-01T00:00:00.000Z');
 for(const event of [{kind:'receipt',id:'r1',billId:'2025-12:'+tenant.id,item:'pay_rent',amount:12000,receivedOn:'2026-01-01',recordedAt:'2026-01-01T00:00:00.000Z',note:''},{kind:'receipt',id:'r2',billId:'2025-12:'+tenant.id,item:'pay_rent',amount:8000,receivedOn:'2026-02-01',recordedAt:'2026-02-01T00:00:00.000Z',note:''},{kind:'void',id:'v1',billId:'2025-12:'+tenant.id,reference:'r1',reason:'익명 대조',recordedAt:'2026-03-01T00:00:00.000Z'}])bill.receiptLedger=b.appendReceiptEvent(bill.receiptLedger,event);
 const raw=JSON.stringify(data),feb=b.incomeTrend(data,2026,'2026-02-28'),mar=b.incomeTrend(data,2026,'2026-03-01');assert.equal(feb.rows[0].newReceipts,12000);assert.equal(feb.rows[1].newReceipts,8000);assert.equal(mar.rows[0].newReceipts,0);assert.equal(mar.rows[1].newReceipts,8000);assert.equal(JSON.stringify(data),raw);
});
test('income trend separates historical dated and undated confirmations and never invents past forecasts',()=>{
 const bill=b.freezeBill(tenant,{invoiceIssued:true,stampedRent:true,stampedRentDate:'2026-08-28',stampedMgmt:true},'2026-09'),data={...core.empty(),tenants:[{...tenant,rent:900000}],bills:{'2026-09':{[tenant.id]:bill},'2026-07':{[tenant.id]:b.freezeBill(tenant,{},'2026-07')}}};const state=b.incomeTrend(data,2026,'2026-10-10');assert.equal(state.rows[8].issued,121000);assert.equal(state.rows[6].issued,0);assert.equal(state.rows[7].legacyDated,110000);assert.equal(state.legacyUndated,11000);assert.equal(state.rows[8].plannedFixed,null);assert.equal(state.rows[9].plannedFixed,1001000);assert.equal(state.rows[9].newReceipts,0);
 data.tenants[0].contract='계약 원문 확인 필요';const uncertain=b.incomeTrend(data,2026,'2026-10-10');assert.equal(uncertain.rows[9].plannedFixed,0);assert.equal(uncertain.rows[9].plannedUncertain,1);
});
test('browser and generated GAS operational rules produce the same revenue and reject the same unsafe writes',()=>{
 const context=vm.createContext({});vm.runInContext(fs.readFileSync('server/Billing.gs','utf8'),context);const data={...core.empty(),tenants:[tenant],propertyRecords:[repair()]};assert.deepEqual(JSON.parse(JSON.stringify(context.RentalBilling.incomeTrend(data,2026,'2026-10-10'))),b.incomeTrend(data,2026,'2026-10-10'));assert.throws(()=>context.RentalBilling.assertOperationsTransition(data,core.empty()),/제거/);
});
