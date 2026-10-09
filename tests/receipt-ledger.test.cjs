const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const b=require('../assets/billing.js'),core=require('../assets/core.js');
const tenant={id:'t1',name:'원장 검증',unit:'201호',rent:100000,mgmt:10000,elevator:0,payday:'15일'},month='2026-10',billId=month+':t1';
const openedAt='2026-10-01T00:00:00.000Z',later='2026-10-10T00:00:00.000Z';
const bill=(extra={})=>b.freezeBill(tenant,{electricity:35000,water:10000,waste:1000,...extra},month);
const open=(extra={},options)=>b.openReceiptLedger(tenant,bill(extra),billId,openedAt,options);
const receipt=(id,amount,receivedOn='2026-10-02',extra={})=>({kind:'receipt',id,billId,item:'pay_rent',amount,receivedOn,recordedAt:later,note:'확인된 입금',...extra});
const cancel=(id,reference,extra={})=>({kind:'void',id,billId,reference,recordedAt:'2026-10-11T00:00:00.000Z',reason:'입금 기록 정정',...extra});
const clone=value=>JSON.parse(JSON.stringify(value));

test('journal opens with exact legacy evidence and no invented receipt or date',()=>{
 const source=bill({stampedRent:true,paid:{pay_water:{date:'10/03',na:false,legacyExtension:{value:null}}}}),before=clone(source);
 const ledger=b.openReceiptLedger(tenant,source,billId,openedAt);assert.deepEqual(source,before);assert.equal(ledger.events.length,0);assert.deepEqual(ledger.legacy,{stampedRent:true,paid:source.paid});
 const state=b.receiptLedgerState(ledger,'2026-10-10');assert.equal(state.legacyConfirmed,120000);assert.equal(state.newReceived,0);assert.equal(state.items.pay_rent.undated,true);assert.deepEqual(state.items.pay_rent.dates,[]);assert.deepEqual(state.items.pay_water.dates,['2026-10-03']);
});

test('snapshot guards reject wrong bill tenant month missing values and unreviewed estimates',()=>{
 for(const source of [{},{...bill(),monthSnapshot:'2026-09'},{...bill(),rent:null},bill({receiptLedger:{}}),bill({snapshotEstimated:['rent']}),{...bill(),snapshotEstimated:'rent'},{...bill(),unitSnapshot:201}])assert.throws(()=>b.openReceiptLedger(tenant,source,billId,openedAt));
 assert.throws(()=>b.openReceiptLedger({...tenant,id:'other'},bill(),billId,openedAt));
 const original=bill({snapshotEstimated:['rent','name']});const ledger=b.openReceiptLedger(tenant,original,billId,openedAt,{reviewEstimated:true});assert.deepEqual(ledger.estimatedFields,['rent','name']);assert.deepEqual(original.snapshotEstimated,['rent','name']);
 for(const reviewed of ['false','true',1,null])assert.throws(()=>b.openReceiptLedger(tenant,original,billId,openedAt,{reviewEstimated:reviewed}));
});

test('multiple partial receipts sum exact won without modifying sources or marking premature completion',()=>{
 const ledger=open(),before=clone(ledger),first=b.appendReceiptEvent(ledger,receipt('r1',30000)),second=b.appendReceiptEvent(first,receipt('r2',80000,'2026-10-05'));
 assert.deepEqual(ledger,before);assert.equal(first.events.length,1);assert.equal(second.events.length,2);
 const a=b.receiptLedgerState(first,'2026-10-10').items.pay_rent,c=b.receiptLedgerState(second,'2026-10-10').items.pay_rent;
 assert.deepEqual([a.received,a.unpaid,a.partial,a.paid],[30000,80000,true,false]);assert.deepEqual([c.received,c.unpaid,c.partial,c.paid],[110000,0,false,true]);
 assert.deepEqual(c.dates,['2026-10-02','2026-10-05']);assert.equal(b.receiptLedgerState(second,'2026-10-10').complete,false);
});

test('historical receipt cutoff counts only effective receipt dates and knowledge cutoff excludes later records',()=>{
 let ledger=open();ledger=b.appendReceiptEvent(ledger,receipt('r1',30000,'2026-10-02',{recordedAt:'2026-10-03T00:00:00.000Z'}));ledger=b.appendReceiptEvent(ledger,receipt('r2',50000,'2026-10-06'));
 assert.equal(b.receiptLedgerState(ledger,'2026-10-01').received,0);assert.equal(b.receiptLedgerState(ledger,'2026-10-02').received,30000);assert.equal(b.receiptLedgerState(ledger,'2026-10-05').received,30000);assert.equal(b.receiptLedgerState(ledger,'2026-10-06').received,80000);
 assert.equal(b.receiptLedgerState(ledger,'2026-10-10','2026-10-02T00:00:00.000Z').received,0);assert.equal(b.receiptLedgerState(ledger,'2026-10-10','2026-10-05T00:00:00.000Z').received,30000);
});

test('void is an append-only correction with reference and reason and preserves original receipt payload',()=>{
 const event=receipt('r1',30000),base=b.appendReceiptEvent(open(),event),before=clone(base),next=b.appendReceiptEvent(base,cancel('v1','r1'));
 assert.deepEqual(base,before);assert.deepEqual(next.events[0],event);assert.equal(next.events.length,2);assert.equal(b.receiptLedgerState(next,'2026-10-10').received,0);
 assert.equal(b.receiptLedgerState(next,'2026-10-10',later).received,30000);
 assert.throws(()=>b.appendReceiptEvent(next,cancel('v2','r1')));assert.throws(()=>b.appendReceiptEvent(next,cancel('v3','v1')));assert.throws(()=>b.appendReceiptEvent(base,cancel('v1','absent')));assert.throws(()=>b.appendReceiptEvent(base,cancel('v1','r1',{reason:'  '})));
});

test('legacy correction is explicit and never fabricates partial history or cash refund',()=>{
 const ledger=open({stampedRent:true,stampedRentDate:'2026.10.01'});assert.throws(()=>b.appendReceiptEvent(ledger,receipt('r1',1)));
 const corrected=b.appendReceiptEvent(ledger,cancel('v1','legacy:pay_rent')),next=b.appendReceiptEvent(corrected,receipt('r1',30000,'2026-10-02',{recordedAt:'2026-10-12T00:00:00.000Z'}));
 const state=b.receiptLedgerState(next,'2026-10-10');assert.equal(state.legacyConfirmed,0);assert.equal(state.newReceived,30000);assert.equal(state.received,30000);assert.equal(next.legacy.stampedRent,true);assert.equal(next.legacy.stampedRentDate,'2026.10.01');assert.equal(b.receiptLedgerState(next,'2026-10-10',openedAt).received,110000);
 assert.throws(()=>b.appendReceiptEvent(open(),cancel('v1','legacy:pay_rent')));
});

test('idempotent retry preserves one original event and rejects changed content with the same ID',()=>{
 const entry=receipt('same',10000),ledger=b.appendReceiptEvent(open(),entry),repeat=b.appendReceiptEvent(ledger,{...entry});assert.deepEqual(repeat,ledger);assert.notEqual(repeat,ledger);assert.equal(repeat.events.length,1);
 for(const change of [{amount:9999},{receivedOn:'2026-10-01'},{recordedAt:'2026-10-11T00:00:00.000Z'},{note:'변경'}])assert.throws(()=>b.appendReceiptEvent(ledger,{...entry,...change}));
 const cancelled=b.appendReceiptEvent(ledger,cancel('voidSame','same'));assert.deepEqual(b.appendReceiptEvent(cancelled,cancel('voidSame','same')),cancelled);
});

test('invalid money dates IDs schema flags and recording order are rejected without mutation',()=>{
 const ledger=open(),before=clone(ledger);
 for(const fields of [{amount:0},{amount:-1},{amount:0.1},{amount:'1,000'},{amount:NaN},{amount:1e12+1},{amount:110001},{receivedOn:'2026-02-30'},{receivedOn:'10/02'},{receivedOn:'2026-10-11'},{item:'unknown'},{id:'constructor'},{id:'r;drop'},{billId:'2026-10:other'},{recordedAt:'2026-09-30T00:00:00.000Z'},{recordedAt:'2026-10-10T00:00:00Z'},{note:'x'.repeat(1001)},{future:undefined},{future:'unsupported'}])assert.throws(()=>b.appendReceiptEvent(ledger,receipt('r1',1,'2026-10-02',fields)));
 assert.deepEqual(ledger,before);for(const fields of [{format:'future'},{billId:'2026-13:t1'},{billId:'2026-10:__proto__'},{openedAt:'2026-02-30T00:00:00.000Z'},{events:{}},{extra:true}])assert.throws(()=>b.validateReceiptLedger({...ledger,...fields}));
 for(const event of [null,[],{}])assert.throws(()=>b.validateReceiptLedger({...ledger,events:[event]}),/입금 원장/);
});

test('received dates use Korea midnight and never infer a future actual receipt',()=>{
 const time='2026-10-01T15:00:00.000Z';assert.equal(b.appendReceiptEvent(open(),receipt('r1',1,'2026-10-02',{recordedAt:time})).events.length,1);
 assert.throws(()=>b.appendReceiptEvent(open(),receipt('r1',1,'2026-10-02',{recordedAt:'2026-10-01T14:59:59.999Z'})));
});

test('exempt zero and legacy dated or undated group confirmations preserve original classifications',()=>{
 for(const source of [{paid:{pay_rent:{na:true}}},{electricityNA:true},{waterNA:true,wasteNA:true},{stampedMgmt:true},{stampedMgmt:true,stampedMgmtDate:'2026.10.07'},{stampedRent:true,stampedRentDate:'2026.10.20'},{stampedRent:null,stampedRentDate:null,waterNA:null,paid:{pay_water:{na:null,date:null}}}]){
  const original=bill(source),ledger=b.openReceiptLedger(tenant,original,billId,openedAt);
  for(const date of ['2026-10-01','2026-10-10','2026-10-21']){
   const old=b.payment(tenant,original,date),next=b.receiptLedgerState(ledger,date);assert.deepEqual([next.total,next.received,next.unpaid,next.exempt,next.complete],[old.total,old.received,old.unpaid,old.exempt,old.complete]);
  }
 }
 const excluded=open({paid:{pay_rent:{na:true}}});assert.throws(()=>b.appendReceiptEvent(excluded,receipt('r1',1)));assert.throws(()=>b.appendReceiptEvent(open(),receipt('r1',1,'2026-10-02',{item:'pay_elev'})));
 const inconsistent=open();inconsistent.charges.pay_rent.exempt=true;assert.throws(()=>b.validateReceiptLedger(inconsistent));
});

test('all event prefixes enforce item capacity including backdated receipts and cannot borrow another item balance',()=>{
 const ledger=b.appendReceiptEvent(open(),receipt('r1',100000,'2026-10-06'));assert.throws(()=>b.appendReceiptEvent(ledger,receipt('r2',20000,'2026-10-02')));
 assert.throws(()=>b.appendReceiptEvent(open(),receipt('r1',20000,'2026-10-02',{item:'pay_mgmt'})));
 const valid=clone(ledger);valid.events.push(cancel('v1','r1'),receipt('r2',110000,'2026-10-02',{recordedAt:'2026-10-12T00:00:00.000Z'}));assert.doesNotThrow(()=>b.validateReceiptLedger(valid));
 const invalid=clone(valid);invalid.events=[invalid.events[0],invalid.events[2],invalid.events[1]];assert.throws(()=>b.validateReceiptLedger(invalid));
});

test('conservation and nonnegative balance hold across reproducible fragmented receipts cancellations and item exemptions',()=>{
 for(let trial=0;trial<120;trial++){
  let ledger=open(trial%2?{waterNA:true}:{}),counter=0;const expected=Object.fromEntries(b.itemKeys.map(key=>[key,0]));
  for(let n=0;n<18;n++){
   const state=b.receiptLedgerState(ledger,'2026-10-10'),item=b.itemKeys[(trial+n)%6],left=state.items[item].unpaid;
   if(left>0){const amount=Math.min(left,(trial*17+n*13)%25001+1);ledger=b.appendReceiptEvent(ledger,receipt('r'+(++counter),amount,'2026-10-02',{item}));expected[item]+=amount;}
   const after=b.receiptLedgerState(ledger,'2026-10-10');assert.equal(after.total,after.received+after.unpaid);assert.equal(after.received,after.legacyConfirmed+after.newReceived);
   for(const [key,row] of Object.entries(after.items)){assert.ok(row.unpaid>=0);assert.equal(row.na?0:row.amount,row.received+row.unpaid);assert.equal(row.received,expected[key]);}
  }
  if(ledger.events.length){const target=ledger.events[0];ledger=b.appendReceiptEvent(ledger,cancel('cancelFinal',target.id));expected[target.item]-=target.amount;const after=b.receiptLedgerState(ledger,'2026-10-10');assert.equal(after.total,after.received+after.unpaid);assert.equal(after.received,Object.values(expected).reduce((sum,value)=>sum+value,0));}
 }
});

test('journal survives JSON and core unknown-field round trip without modifying existing confirmations',()=>{
 const original=bill({stampedMgmt:true,stampedMgmtDate:'2026.10.05'}),ledger=b.appendReceiptEvent(b.openReceiptLedger(tenant,original,billId,openedAt),receipt('r1',30000));
 const source={...core.empty(),tenants:[tenant],bills:{[month]:{t1:{...original,futureReceiptFoundation:ledger}}}};
 const restored=core.validateData(core.envelope(source));assert.deepEqual(restored,source);assert.deepEqual(b.receiptLedgerState(restored.bills[month].t1.futureReceiptFoundation,'2026-10-10'),b.receiptLedgerState(ledger,'2026-10-10'));
 assert.deepEqual(b.payment(tenant,restored.bills[month].t1,'2026-10-10'),b.payment(tenant,original,'2026-10-10'));
});

test('generated GAS and client produce identical ledger validation and projection results',()=>{
 const context=vm.createContext({});vm.runInContext(fs.readFileSync('server/Billing.gs','utf8'),context);
 const ledger=b.appendReceiptEvent(open({paid:{pay_water:{date:'10/03'}}}),receipt('r1',30000)),state=b.receiptLedgerState(ledger,'2026-10-10');
 assert.deepEqual(JSON.parse(JSON.stringify(context.RentalBilling.receiptLedgerState(ledger,'2026-10-10'))),state);
 const invalid=clone(ledger);invalid.events[0].amount=999999;assert.throws(()=>context.RentalBilling.validateReceiptLedger(invalid));
});

test('VAT-inclusive upper charge boundary stays exact while invalid legacy sources and implicit cutoffs fail',()=>{
 const maximum=b.freezeBill({...tenant,rent:1e12},{rent:1e12,mgmt:0,elevator:0},month),ledger=b.openReceiptLedger(tenant,maximum,billId,openedAt),paid=b.appendReceiptEvent(ledger,receipt('maximum',1100000000000));
 assert.equal(b.receiptLedgerState(paid,'2026-10-10').received,1100000000000);assert.equal(b.receiptLedgerState(paid,'2026-10-10').unpaid,0);assert.throws(()=>b.won(1100000000000));
 for(const source of [{stampedRent:'yes'},{stampedMgmtDate:'2026-02-30'},{paid:{pay_rent:{na:'yes'}}},{paid:{unknown:{date:'2026-10-02'}}},{paid:{pay_water:{date:'2026-02-30'}}}])assert.throws(()=>open(source));
 const dangerous=open();dangerous.legacy.paid=JSON.parse('{"pay_rent":{"constructor":{"value":1}}}');assert.throws(()=>b.validateReceiptLedger(dangerous));
 for(const date of [undefined,'10/02','2026-02-30',new Date()])assert.throws(()=>b.receiptLedgerState(open(),date));
});
