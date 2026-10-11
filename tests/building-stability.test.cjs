const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const b=require('../assets/billing.js');
const people=()=>[1,2,3,4].map(f=>({id:'f'+f,name:'익명 '+f,unit:f+'01',contract:'2026-01-01 ~ 2026-12-31'}));
const ratio={r2:19,r3:10,r4:5},input={elec:100000,waterTotal:10003,waterUsage:50,waterF1:10,elev:150001,waste:10003};
test('current next-month and month-end rent dates retain the bill month across leap years and year rollover',()=>{
 for(const [payday,y,m,expected] of [['당월 15일',2026,9,'2026-09-15'],['당월 말일',2024,2,'2024-02-29'],['익월 31일',2026,1,'2026-02-28'],['익월 말일',2024,1,'2024-02-29'],['익월 30일',2026,12,'2027-01-30'],['익월 29일',2023,1,'2023-02-28'],['익월 28일',2024,1,'2024-02-28'],['',2026,9,''],['미등록',2026,9,'']])assert.equal(b.dueDate({payday},'pay_rent',y,m),expected);
 const tenant={id:'rent-date',unit:'201',rent:100000,payday:'익월 15일'},bill=b.freezeBill(tenant,{mgmt:0,elevator:0},'2026-12'),raw=JSON.stringify(bill);
 tenant.payday='당월 1일';assert.equal(b.historicalPayment(tenant,bill,2026,12,'2027-01-15').overdue,0);assert.equal(b.historicalPayment(tenant,bill,2026,12,'2027-01-16').overdue,110000);assert.equal(JSON.stringify(bill),raw);
 assert.equal(b.dueDate(tenant,'pay_mgmt',2026,12),'2026-12-31');
});
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
test('water validation and former fifth floor do not silently redistribute usage or common costs',()=>{
 const raw={1:{prevMeter:10.001,curMeter:15.125,usage:999},2:{usage:8}};
 assert.equal(b.normalizeWaterFloors(raw)[1].usage,5.124);assert.equal(raw[1].usage,999);
 for(const row of [{prevMeter:20,curMeter:19},{usage:-1},{usage:'NaN'}])assert.throws(()=>b.calculateBuilding(people(),{...input,waterFloors:{2:row}},ratio),/수도/);
 const tenants=[...people(),{id:'former5',unit:'501',archived:true}],r=b.calculateBuilding(tenants,input,ratio);
 assert.equal(r.ownerCandidates[0].floor,5);assert.ok(r.ownerCandidates[0].elev>0);assert.ok(r.ownerCandidates[0].waste>0);assert.equal(b.reconcile(r).balanced,true);assert.equal(b.reconcile(r).canConfirm,false);
 const first=people();first[3].contract='2026-01-01 ~ 2026-09-01';assert.equal(b.calculateBuilding(first,input,ratio,{month:'2026-09'}).reviewRequired,true);
 assert.equal(b.calculateBuilding(people(),input,ratio,{month:'2026-09',floorOperations:{4:{vacatedOn:'2026-09-30',liabilityEndOn:'2026-10-15'}}}).reviewRequired,true);
});
test('floor summary counts a vacant floor once and repair expense matching never creates or changes expenses',()=>{
 const data={tenants:people(),floorOperations:{4:{leaseStatus:'공실(정리중)'},5:{leaseStatus:'공실(정리중)'}},propertyRecords:[{id:'r1',kind:'repair',location:'401호',occurredOn:'2026-09-01',amount:30000},{id:'r2',kind:'repair',location:'옥상',occurredOn:'2026-09-01',amount:30000}],expenses:{'2026-09':[{id:'e1',name:'시설 수리',amount:30000,date:'2026.09.01'},{id:'e2',amount:30001,date:'2026.09.01'}]}};
 data.tenants[3].leaseStatus='공실(정리중)';const before=JSON.stringify(data),view=b.buildingOverview(data);assert.equal(view.vacant,2);assert.equal(view.occupied,3);assert.equal(view.floors[3].repairCount,1);assert.equal(view.floors[4].repairCount,0);
 assert.equal(b.repairExpenseCandidates(data,data.propertyRecords[0]).length,1);assert.equal(JSON.stringify(data),before);
});
test('a future contract review records only its reminder and an audit without applying future terms or snapshots',()=>{
 const data={tenants:people(),bills:{},contractChanges:[]},before=JSON.stringify(data.tenants[0]);
 b.setContractReview(data,'f1','2027-01-15','2026-09-01T00:00:00.000Z');const {contractReviewOn,audit,...current}=data.tenants[0];assert.equal(JSON.stringify(current),before);assert.equal(contractReviewOn,'2027-01-15');assert.equal(audit.length,1);assert.deepEqual(data.contractChanges,[]);assert.throws(()=>b.setContractReview(data,'f1','2027-02-30','2026-09-01T00:00:00.000Z'));assert.throws(()=>b.setContractReview(data,'unknown','2027-01-15','2026-09-01T00:00:00.000Z'));
});
test('utility periods across bill months require review for incoming leases and separate occupancy liability dates',()=>{
 const period={electricity:{start:'2026-08-15',end:'2026-09-14'},water:{start:'2026-07-15',end:'2026-09-14'}};
 const tenants=people();tenants[3].contract='2026-09-01 ~ 2027-08-31';const result=b.calculateBuilding(tenants,input,ratio,{month:'2026-09'});assert.equal(result.reviewRequired,false);b.reviewAllocationPeriods(result,input,period,tenants);assert.equal(b.reconcile(result).canConfirm,false);assert.match(result.reviewIssues.join(' '),/사용기간/);
 const normal=b.calculateBuilding(people(),input,ratio);b.reviewAllocationPeriods(normal,input,period,people());assert.equal(normal.reviewRequired,false);
 b.reviewAllocationPeriods(normal,input,period,people(),{4:{vacatedOn:'2026-08-20',liabilityEndOn:'2026-10-15'}});assert.equal(normal.reviewRequired,true);
});
test('a vacant first floor does not receive an elevator share under the unchanged exclusion rule',()=>{
 const tenants=people();tenants[0].archived=true;const inputs={elec:0,waterTotal:0,elev:150000,waste:0},result=b.calculateBuilding(tenants,inputs,ratio);assert.deepEqual(result.ownerCandidates,[]);assert.deepEqual(result.rows.map(r=>r.elev),[50000,50000,50000]);assert.equal(b.reconcile(result).canConfirm,true);
});
