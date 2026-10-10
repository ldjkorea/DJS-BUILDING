const core=require('../assets/core.js'),billing=require('../assets/billing.js');
const month='2026-09',person={id:'pdf-example',name:'출력 검증 임차인',biz:'익명 출력 사무실',unit:'201호',rent:1234560,mgmt:50000,elevator:0,payday:'15일'};
function fixtures(){
 const invoice=()=>billing.freezeBill(person,{electricity:35000,water:12000,waste:1000,elevatorTotal:20000},month);
 const legacy={...core.empty(),tenants:[person],bills:{[month]:{[person.id]:invoice()}}};legacy.bills[month][person.id].paid={pay_mgmt:{paid:true,date:'2026.09.02'}};
 const journal=structuredClone(legacy),bill=journal.bills[month][person.id];bill.receiptLedger=billing.openReceiptLedger(person,bill,month+':'+person.id,'2026-09-01T00:00:00.000Z');
 for(let n=1;n<=24;n++)bill.receiptLedger=billing.appendReceiptEvent(bill.receiptLedger,{kind:'receipt',id:'pdf-receipt-event-'+String(n).padStart(4,'0'),billId:month+':'+person.id,item:'pay_rent',amount:1000,receivedOn:'2026-09-02',recordedAt:'2026-09-02T00:00:00.000Z',note:'출력 검증 기록 '+n+' · 긴 메모가 다음 줄과 다음 페이지에서도 누락되지 않는지 확인하는 익명 내용입니다.'});
 bill.receiptLedger=billing.appendReceiptEvent(bill.receiptLedger,{kind:'void',id:'pdf-correction-event-0001',billId:month+':'+person.id,reference:'pdf-receipt-event-0024',recordedAt:'2026-09-03T00:00:00.000Z',reason:'출력 검증 정정 사유 · 기존 기록을 남기며 실제 환급을 뜻하지 않습니다.'});
 const quarter=core.empty();for(let n=1;n<=36;n++){const tenant={...person,id:'pdf-quarter-'+n,name:'익명 임차인 '+n,biz:'분기 출력 예시 사무실 '+String(n).padStart(2,'0'),unit:String(200+n)+'호'};quarter.tenants.push(tenant);for(const m of ['2026-07','2026-08','2026-09']){quarter.bills[m]??={};quarter.bills[m][tenant.id]=billing.freezeBill(tenant,{electricity:35000,water:12000,waste:1000,elevatorTotal:20000},m);}}
 return {legacy,journal,quarter,empty:core.empty()};
}
module.exports={fixtures,month,person};
