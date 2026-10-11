const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const b=require('../assets/billing.js');
const people=()=>[1,2,3,4].map(f=>({id:'f'+f,name:'익명 '+f,unit:f+'01',contract:'2026-01-01 ~ 2026-12-31'}));
const ratio={r2:19,r3:10,r4:5},input={elec:100000,waterTotal:10003,waterUsage:50,waterF1:10,elev:150001,waste:10003};
test('fully occupied building and empty fifth floor preserve every original allocation',()=>{
 for(const waterFloors of [undefined,{1:{usage:10},2:{usage:8},3:{usage:6},4:{usage:4},5:{usage:''}}]){
  const inputs={...input,waterFloors},legacy=b.calculate(people(),inputs,ratio),next=b.calculateBuilding(people(),inputs,ratio,{month:'2026-09',floorOperations:{5:{leaseStatus:'공실(정리중)'}}});
  assert.deepEqual(next.rows,legacy.rows);assert.deepEqual(next.expected,legacy.expected);assert.equal(b.reconcile(next).canConfirm,true);assert.deepEqual(next.ownerCandidates,[]);
 }
});
test('archived fourth floor retains 30000 net candidate without redistributing or billing a fake tenant',()=>{
 const tenants=people();tenants[3].archived=true;const before=JSON.stringify(tenants);
 const next=b.calculateBuilding(tenants,input,ratio,{month:'2026-09'}),check=b.reconcile(next);
 assert.deepEqual(next.rows.map(row=>row.elec),[0,35000,35000]);assert.equal(next.ownerCandidates[0].elec,30000);assert.equal(next.ownerCandidates[0].id,undefined);
 assert.equal(check.ownerTotals.elec,33000);assert.equal(check.tenantTotals.elec,77000);assert.equal(check.totals.elec,110000);assert.equal(check.balanced,true);assert.equal(check.canConfirm,false);assert.equal(JSON.stringify(tenants),before);
 next.rows[1].water++;assert.equal(b.reconcile(next).balanced,false);
});
test('still occupied eviction states keep liability while vacancy flags require review',()=>{
 for(const leaseStatus of ['명도소송중','강제집행중']){const tenants=people();tenants[3].leaseStatus=leaseStatus;assert.deepEqual(b.calculateBuilding(tenants,input,ratio).rows,b.calculate(tenants,input,ratio).rows);}
 const tenants=people();tenants[3].leaseStatus='공실(정리중)';assert.equal(b.calculateBuilding(tenants,input,ratio).rows.length,3);
});
test('midmonth change and vacancy fifth floor measured usage never auto-confirm',()=>{
 const tenants=people();tenants[3].contract='2026-01-01 ~ 2026-09-15';assert.equal(b.reconcile(b.calculateBuilding(tenants,input,ratio,{month:'2026-09'})).canConfirm,false);
 const next=b.calculateBuilding(people(),{...input,waterFloors:{1:{usage:10},2:{usage:8},3:{usage:6},4:{usage:4},5:{usage:2}}},ratio);assert.equal(next.ownerCandidates[0].floor,5);assert.ok(next.ownerCandidates[0].water>0);assert.equal(b.reconcile(next).canConfirm,false);
});
test('all vacant structural floors remain reviewable and archived historical ledger stays unchanged',()=>{
 const tenants=people().map(t=>({...t,archived:true})),bill=b.freezeBill({...tenants[3],rent:100000,payday:'15일'},{},'2026-08');bill.receiptLedger=b.openReceiptLedger(tenants[3],bill,'2026-08:f4','2026-09-01T00:00:00.000Z');const before=JSON.stringify(bill);
 const next=b.calculateBuilding(tenants,input,ratio);assert.equal(next.rows.length,0);assert.equal(next.ownerCandidates.length,4);assert.equal(b.reconcile(next).balanced,true);assert.equal(b.reconcile(next).canConfirm,false);assert.equal(JSON.stringify(bill),before);assert.ok(b.arrears(tenants,{'2026-08':{f4:bill}},'2026-10-01').total>0);
});
test('generated GAS has exactly the same vacancy result and total projection',()=>{
 const scope={};vm.createContext(scope);vm.runInContext(fs.readFileSync('server/Billing.gs','utf8'),scope);const tenants=people();tenants[3].archived=true;
 const web=b.calculateBuilding(tenants,input,ratio),gas=scope.RentalBilling.calculateBuilding(tenants,input,ratio);assert.deepEqual(JSON.parse(JSON.stringify(gas)),web);assert.deepEqual(JSON.parse(JSON.stringify(scope.RentalBilling.reconcile(gas))),b.reconcile(web));
});
