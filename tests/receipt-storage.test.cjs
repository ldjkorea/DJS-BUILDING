const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const b=require('../assets/billing.js'),core=require('../assets/core.js');
const tenant={id:'t1',name:'저장 검증',unit:'201호',rent:100000,mgmt:10000,elevator:0,payday:'15일'},month='2026-10';
const clone=x=>JSON.parse(JSON.stringify(x));
function fixture(){const bill=b.freezeBill(tenant,{electricity:35000,water:10000,waste:1000,stampedMgmt:true,paid:{pay_water:{na:null,date:null,extension:{value:null}}}},month);return {...core.empty(),tenants:[clone(tenant)],bills:{[month]:{t1:bill}}};}
function adopted(){const data=fixture(),bill=data.bills[month].t1;bill.receiptLedger=b.openReceiptLedger(tenant,bill,month+':t1','2026-10-01T00:00:00.000Z');return data;}
function append(data,id='r1',amount=30000){const next=clone(data),bill=next.bills[month].t1;bill.receiptLedger=b.appendReceiptEvent(bill.receiptLedger,{kind:'receipt',id,billId:month+':t1',item:'pay_rent',amount,receivedOn:'2026-10-02',recordedAt:'2026-10-10T00:00:00.000Z',note:'확인'});return next;}
function storage(initial={}){const values=new Map(Object.entries(initial));let writes=0;return {getItem:key=>values.get(key)??null,setItem:(key,value)=>{writes++;values.set(key,value);},values,writes:()=>writes};}
test('official receipt field binds parent ID charges legacy and estimates without normalization',()=>{
 const data=append(adopted()),before=clone(data);assert.deepEqual(core.validateData(data),before);assert.deepEqual(data,before);
 for(const change of [bill=>bill.receiptLedger=null,bill=>bill.receiptLedger.billId='2026-09:t1',bill=>bill.rent++,bill=>bill.stampedMgmt=false,bill=>bill.receiptLedger.charges.pay_water.exempt=true,bill=>bill.snapshotEstimated=['rent']]){const bad=clone(data);change(bad.bills[month].t1);assert.throws(()=>core.validateData(bad));}
 const numericString=clone(data);numericString.bills[month].t1.rent='100,000';assert.equal(core.validateData(numericString).bills[month].t1.rent,'100,000');
 const orphan=clone(data);orphan.tenants=[];assert.deepEqual(core.validateData(orphan).bills,orphan.bills);
});
test('actual preimage protects adoption, later append and void in atomic local storage',()=>{
 const s=storage();core.persist(s,fixture());let token=core.storageToken(s);const data=adopted();token=core.persistChecked(s,data,token);const next=append(data);token=core.persistChecked(s,next,token);
 const cancelled=clone(next),bill=cancelled.bills[month].t1;bill.receiptLedger=b.appendReceiptEvent(bill.receiptLedger,{kind:'void',id:'v1',billId:month+':t1',reference:'r1',recordedAt:'2026-10-11T00:00:00.000Z',reason:'오입력 정정'});core.persistChecked(s,cancelled,token);
 assert.deepEqual(core.load(s).data,cancelled);assert.equal(s.writes(),4);assert.equal(b.receiptLedgerState(bill.receiptLedger,'2026-10-10').received,60500);
});
test('removing a ledger bill, old backup, prefix edits and header changes never write',()=>{
 const data=append(adopted()),s=storage({[core.STATE_KEY]:JSON.stringify(data)}),before=core.storageToken(s);
 const changes=[x=>delete x.bills[month].t1.receiptLedger,x=>delete x.bills[month],x=>x.bills={},x=>x.bills[month].t1.receiptLedger.events=[],x=>x.bills[month].t1.receiptLedger.events[0].note='변경',x=>x.bills[month].t1.receiptLedger.openedAt='2026-09-30T00:00:00.000Z',x=>x.bills[month].t1.paydaySnapshot='20일',x=>x.bills[month].t1.tenantSnapshot.name='변경',x=>{const bill=x.bills[month].t1;bill.rent++;bill.receiptLedger.charges.pay_rent.amount++;}];
 for(const change of changes){const next=clone(data);change(next);assert.throws(()=>core.persistChecked(s,next,before));assert.equal(core.storageToken(s),before);assert.equal(s.writes(),0);}
 assert.throws(()=>core.persist(s,fixture()));assert.equal(s.writes(),0);
});
test('adoption cannot hide simultaneous snapshot legacy or price changes',()=>{
 const before=fixture(),after=adopted();assert.equal(b.assertReceiptDataTransition(before,after),after);
 for(const key of ['rent','paydaySnapshot','stampedMgmt']){const altered=clone(before);altered.bills[month].t1[key]=key==='rent'?90000:key==='stampedMgmt'?false:'20일';assert.throws(()=>b.assertReceiptDataTransition(altered,after));}
 const legacy=clone(before);delete legacy.bills[month].t1.monthSnapshot;assert.throws(()=>b.assertReceiptDataTransition(legacy,after));
});
test('key order, unrelated domain edits and orphan preservation allow append but no history erase',()=>{
 const before=append(adopted()),after=append(before,'r2',20000);after.bills[month].t1.audit=[{at:'2026-10-10',note:'확인'}];after.tenants[0].name='현재 계약 이름';after.bills[month].t1.invoiceIssued=true;
 const ledger=after.bills[month].t1.receiptLedger;ledger.events[0]=Object.fromEntries(Object.entries(ledger.events[0]).reverse());assert.equal(b.assertReceiptDataTransition(before,after),after);
 const orphan=clone(after);orphan.tenants=[];assert.equal(b.assertReceiptDataTransition(after,orphan),orphan);
 const reordered=clone(after);reordered.bills[month].t1.receiptLedger.events.reverse();assert.throws(()=>b.assertReceiptDataTransition(after,reordered));
});
test('stale local token, quota failure and malformed receipt preimage preserve original bytes',()=>{
 const original=append(adopted()),raw=JSON.stringify(original),s=storage({[core.STATE_KEY]:raw});assert.throws(()=>core.persistChecked(s,append(original,'r2',1),'stale'));assert.equal(s.writes(),0);
 const broken='{\n"bills":{"2026-10":{"t1":{"receiptLedger":';const damaged=storage({[core.STATE_KEY]:broken});assert.throws(()=>core.persist(damaged,fixture()));assert.equal(damaged.getItem(core.STATE_KEY),broken);assert.equal(damaged.writes(),0);
 const legacy=storage({bills:JSON.stringify(original.bills)});assert.throws(()=>core.persist(legacy,fixture()));assert.equal(legacy.writes(),0);
 s.setItem=()=>{throw Error('quota');};assert.throws(()=>core.persist(s,append(original,'r2',1)),/quota/);assert.equal(s.getItem(core.STATE_KEY),raw);
});
test('browser core fails closed if receipt rules unavailable while legacy data remains supported',()=>{
 const context=vm.createContext({});vm.runInContext(fs.readFileSync(require.resolve('../assets/core.js'),'utf8'),context);assert.equal(context.RentalCore.validateData(fixture()).tenants.length,1);assert.throws(()=>context.RentalCore.validateData(adopted()),/입금 원장/);
});
