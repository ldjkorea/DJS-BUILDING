/* Monetary and payment rules. No DOM, network, or persistence dependencies. */
(function (root) {
  'use strict';
  const won = value => {
    const n = Number(value);
    if (!Number.isSafeInteger(n) || n < 0 || n > 1e12) throw new Error('금액은 0 이상의 원 단위 정수로 입력해주세요.');
    return n;
  };
  const amount = value => Number(typeof value === 'string' ? value.replace(/,/g,'').trim() : value || 0);
  const withVat = value => amount(value) + Math.round(amount(value) / 10);
  const floorOf = unit => { const n = Number(String(unit || '').match(/^\d+/)?.[0] || 0); return n >= 100 ? Math.floor(n / 100) : n; };
  function distribute(total, weights) {
    total = won(total);
    if (!weights.length || weights.some(w => !Number.isFinite(w) || w < 0) || weights.reduce((a,b) => a+b,0) <= 0)
      throw new Error('배분 대상과 비율을 확인해주세요.');
    const sum = weights.reduce((a,b) => a+b,0);
    const exact = weights.map(w => total * w / sum);
    const amounts = exact.map(Math.floor);
    const order = exact.map((v,i) => ({i, rest: v-amounts[i]})).sort((a,b) => b.rest-a.rest || a.i-b.i);
    let left = total - amounts.reduce((a,b) => a+b,0);
    for (let i=0; i<left; i++) amounts[order[i % order.length].i]++;
    return amounts;
  }
  function calculate(tenants, inputs, ratio) {
    if (!tenants.length) throw new Error('세입자를 먼저 등록해주세요.');
    const elec = won(inputs.elec), water = won(inputs.waterTotal), elev = won(inputs.elev), waste = won(inputs.waste);
    if (!elec && !water && !elev && !waste) throw new Error('최소 한 항목을 입력해주세요.');
    const rows = tenants.map(t => ({id:t.id, name:t.biz||t.name, unit:t.unit, floor:floorOf(t.unit), elec:null, water:null, elev:null, waste:0}));
    const floors = new Map();
    for (const row of rows) {
      if (row.floor < 1 || row.floor > 5 || floors.has(row.floor)) throw new Error('현재 배분 기준은 1~5층, 층별 세입자 1명입니다. 호수를 확인해주세요.');
      floors.set(row.floor, row);
    }
    if (elec) {
      if (![2,3,4].every(f => floors.has(f))) throw new Error('전기 배분에는 2·3·4층 세입자가 필요합니다.');
      if (elec < 70000) throw new Error('전기 공급가가 70,000원보다 작습니다. 2·3층 고정액과 원본 청구서를 확인해주세요.');
      rows.forEach(r => r.elec = r.floor === 2 || r.floor === 3 ? 35000 : r.floor === 4 ? elec-70000 : 0);
    }
    if (water) {
      const usage = Number(inputs.waterUsage);
      const f1Usage = (inputs.waterFloors?.[1]?.usage !== undefined && inputs.waterFloors[1].usage !== '')
        ? Number(inputs.waterFloors[1].usage)
        : Number(inputs.waterF1);
      if (![1,2,3,4].every(f => floors.has(f))) throw new Error('수도 배분에는 1~4층 세입자가 필요합니다.');
      if (!Number.isFinite(usage) || usage <= 0 || !Number.isFinite(f1Usage) || f1Usage < 0 || f1Usage > usage)
        throw new Error('건물 총 사용량과 1층 사용량을 확인해주세요.');
      const firstAmount = Math.round(water * f1Usage / usage);
      floors.get(1).water = firstAmount;

      const remWater = water - firstAmount;
      const upperFloors = [2, 3, 4, 5].filter(f => floors.has(f));
      const upperUsages = upperFloors.map(f => {
        const u = inputs.waterFloors?.[f]?.usage;
        return (u !== undefined && u !== '' && !isNaN(Number(u))) ? Number(u) : 0;
      });
      const sumUpperUsage = upperUsages.reduce((a, b) => a + b, 0);

      if (inputs.waterFloors && sumUpperUsage > 0) {
        const amounts = distribute(remWater, upperUsages);
        upperFloors.forEach((f, i) => floors.get(f).water = amounts[i]);
      } else {
        const amounts = distribute(remWater, [ratio.r2, ratio.r3, ratio.r4].map(Number));
        [2, 3, 4].forEach((f, i) => { if (floors.has(f)) floors.get(f).water = amounts[i]; });
      }
    }
    const elevatorTotal = inputs.elevMode === 'net' ? withVat(elev) : elev;
    if (elev) {
      const eligible = rows.filter(r => r.floor > 1).sort((a,b) => a.floor-b.floor);
      const amounts = distribute(elevatorTotal, eligible.map(() => 1));
      rows.forEach(r => r.elev = 0);
      eligible.forEach((r,i) => r.elev = amounts[i]);
    }
    if (waste) {
      const sorted = [...rows].sort((a,b) => a.floor-b.floor);
      const amounts = distribute(waste, sorted.map(() => 1));
      sorted.forEach((r,i) => r.waste = amounts[i]);
    }
    return {rows, expected:{elec:elec ? withVat(elec):0, water, elev:elevatorTotal, waste}};
  }
  function reconcile(result) {
    const totals = {elec:0, water:0, elev:0, waste:0};
    result.rows.forEach(row => {
      for (const key of Object.keys(totals)) {
        const value = row[key] === null ? 0 : won(row[key]);
        totals[key] += key === 'elec' ? withVat(value) : value;
      }
    });
    return {totals, balanced:Object.keys(totals).every(key => totals[key] === result.expected[key])};
  }
  function charges(tenant, bill = {}) {
    const firstFloor = floorOf(bill.unitSnapshot ?? tenant.unit) === 1;
    return {
      pay_rent:withVat(bill.rent ?? tenant.rent), pay_mgmt:withVat(bill.mgmt ?? tenant.mgmt),
      pay_elec:bill.electricityNA?0:withVat(bill.electricity), pay_water:bill.waterNA?0:amount(bill.water),
      pay_elev:firstFloor?0:bill.elevatorTotal!=null?amount(bill.elevatorTotal):withVat(bill.elevator??tenant.elevator),
      pay_waste:bill.wasteNA?0:amount(bill.waste),
    };
  }
  const itemKeys = ['pay_rent','pay_mgmt','pay_elec','pay_water','pay_elev','pay_waste'];
  const naFields = {pay_elec:'electricityNA',pay_water:'waterNA',pay_waste:'wasteNA'};
  // Receipt journals and legacy confirmations share the same public payment projection.
  const RECEIPT_FORMAT='rental-receipts-v1';
  const journalId=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value)
    &&!['__proto__','constructor','prototype','toString','valueOf','hasOwnProperty'].includes(value);
  const journalError=message=>{throw new Error('입금 원장: '+message);};
  function receiptWon(value){
    // Existing charge inputs allow 1e12 net; VAT-inclusive receipts must retain that boundary.
    if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>withVat(1e12))journalError('금액은 유효한 원 단위 정수여야 합니다.');
    return value;
  }
  const journalObject=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  function journalFields(value,required,optional=[]){
    if(!journalObject(value)||required.some(key=>!Object.hasOwn(value,key))||Object.keys(value).some(key=>!required.includes(key)&&!optional.includes(key)))journalError('지원하지 않는 항목 형식입니다.');
  }
  function journalJSON(value,depth=0){
    if(depth>15)journalError('자료 중첩이 너무 깊습니다.');
    if(value===null||['string','boolean'].includes(typeof value))return;
    if(typeof value==='number'&&Number.isFinite(value))return;
    if(!value||typeof value!=='object'||!Array.isArray(value)&&Object.prototype.toString.call(value)!=='[object Object]')journalError('JSON 자료만 기록할 수 있습니다.');
    for(const [key,child] of Object.entries(value)){if(['__proto__','constructor','prototype'].includes(key))journalError('안전하지 않은 자료 키입니다.');journalJSON(child,depth+1);}
  }
  function journalTime(value){
    if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)||!dateISO(value.slice(0,10))||Number.isNaN(Date.parse(value))||new Date(value).toISOString()!==value)journalError('기록 시각은 유효한 UTC ISO 시각이어야 합니다.');
    return value;
  }
  const journalKoreaDate=value=>new Date(Date.parse(value)+9*60*60*1000).toISOString().slice(0,10);
  function journalBillId(value){
    if(typeof value!=='string')journalError('고지서 식별자를 확인해주세요.');
    const [month,id,...extra]=value.split(':');
    if(extra.length||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||!dateISO(month+'-01')||!journalId(id))journalError('고지서 식별자는 월:임차인ID 형식이어야 합니다.');
    return {month,id};
  }
  function legacyReceiptSource(bill){
    const source={};
    for(const key of ['stampedRent','stampedRentDate','stampedMgmt','stampedMgmtDate','paid','electricityNA','waterNA','wasteNA'])
      if(Object.hasOwn(bill,key))source[key]=JSON.parse(JSON.stringify(bill[key]));
    return source;
  }
  function journalLegacy(ledger){
    const year=Number(ledger.billId.slice(0,4)),source=ledger.legacy;
    journalFields(source,[],['stampedRent','stampedRentDate','stampedMgmt','stampedMgmtDate','paid','electricityNA','waterNA','wasteNA']);
    for(const key of ['stampedRent','stampedMgmt','electricityNA','waterNA','wasteNA'])if(source[key]!=null&&typeof source[key]!=='boolean')journalError('과거 확인 표시는 참/거짓이어야 합니다.');
    for(const key of ['stampedRentDate','stampedMgmtDate'])if(source[key]!=null&&(typeof source[key]!=='string'||source[key]&&!dateISO(source[key],year)))journalError('과거 확인 날짜를 확인해주세요.');
    if(source.paid!==undefined){
      journalFields(source.paid,[],itemKeys);
      for(const item of Object.values(source.paid)){
        if(!journalObject(item)||Object.hasOwn(item,'__proto__')||Object.hasOwn(item,'constructor')||Object.hasOwn(item,'prototype'))journalError('과거 항목별 확인 형식을 확인해주세요.');
        if(item.na!=null&&typeof item.na!=='boolean')journalError('과거 제외 표시는 참/거짓이어야 합니다.');
        if(item.date!=null&&(typeof item.date!=='string'||item.date&&!dateISO(item.date,year)))journalError('과거 항목별 확인 날짜를 확인해주세요.');
      }
    }
    return Object.fromEntries(itemKeys.map(key=>{
      const snapshot=ledger.charges[key],item=source.paid?.[key]||{},rent=key==='pay_rent';
      if(snapshot.exempt!==(item.na===true||source[naFields[key]]===true||snapshot.amount===0))journalError('과거 확인 근거와 청구 제외 상태가 다릅니다.');
      const stamped=(rent?source.stampedRent:source.stampedMgmt)===true;
      const rawDate=stamped?(rent?source.stampedRentDate:source.stampedMgmtDate)||item.date||'':item.date||'';
      const date=dateISO(rawDate,year),confirmed=!snapshot.exempt&&((stamped&&!rawDate)||!!date);
      return [key,{amount:confirmed?snapshot.amount:0,date,undated:confirmed&&!date,rawDate}];
    }));
  }
  function validateReceiptLedger(ledger){
    journalJSON(ledger);
    journalFields(ledger,['format','billId','openedAt','charges','legacy','estimatedFields','events']);
    if(ledger.format!==RECEIPT_FORMAT)journalError('지원하지 않는 원장 버전입니다.');
    journalBillId(ledger.billId);journalTime(ledger.openedAt);
    if(!Array.isArray(ledger.estimatedFields)||ledger.estimatedFields.some(field=>typeof field!=='string'||!field||field.length>100)||new Set(ledger.estimatedFields).size!==ledger.estimatedFields.length)journalError('추정 snapshot 항목을 확인해주세요.');
    journalFields(ledger.charges,itemKeys);
    for(const key of itemKeys){const item=ledger.charges[key];journalFields(item,['amount','exempt']);receiptWon(item.amount);if(typeof item.exempt!=='boolean'||item.amount===0&&!item.exempt)journalError('청구 제외 상태를 확인해주세요.');}
    if(!Array.isArray(ledger.events))journalError('입금 기록 목록을 확인해주세요.');
    const legacy=journalLegacy(ledger),seen=new Map(),cancelled=new Set(),active=Object.fromEntries(itemKeys.map(key=>[key,legacy[key].amount]));
    let last=ledger.openedAt;
    for(const event of ledger.events){
      journalFields(event,['kind','id','billId','recordedAt'],event?.kind==='receipt'?['item','amount','receivedOn','note']:['reference','reason']);
      if(!journalId(event.id)||seen.has(event.id)||event.billId!==ledger.billId)journalError('기록 ID 중복 또는 다른 고지서 참조입니다.');
      journalTime(event.recordedAt);if(event.recordedAt<last)journalError('기록 시각 순서를 확인해주세요.');last=event.recordedAt;
      if(event.kind==='receipt'){
        if(!itemKeys.includes(event.item)||receiptWon(event.amount)<=0||typeof event.receivedOn!=='string'||dateISO(event.receivedOn)!==event.receivedOn||event.receivedOn>journalKoreaDate(event.recordedAt)||typeof event.note!=='string'||event.note.length>1000)journalError('입금 항목·금액·실제 날짜·메모를 확인해주세요.');
        if(ledger.charges[event.item].exempt)journalError('제외 항목에는 입금을 기록할 수 없습니다.');
        active[event.item]+=event.amount;
      }else if(event.kind==='void'){
        if(typeof event.reference!=='string'||typeof event.reason!=='string'||!event.reason.trim()||event.reason.length>1000||cancelled.has(event.reference))journalError('취소 참조·중복·사유를 확인해주세요.');
        const target=seen.get(event.reference),legacyKey=event.reference.startsWith('legacy:')?event.reference.slice(7):'';
        if(target?.kind==='receipt')active[target.item]-=target.amount;
        else if(itemKeys.includes(legacyKey)&&legacy[legacyKey].amount>0)active[legacyKey]-=legacy[legacyKey].amount;
        else journalError('취소할 앞선 입금 또는 과거 확인이 없습니다.');
        cancelled.add(event.reference);
      }else journalError('지원하지 않는 입금 기록 종류입니다.');
      for(const key of itemKeys)if(!Number.isSafeInteger(active[key])||active[key]<0||active[key]>ledger.charges[key].amount)journalError('청구액을 초과하는 입금 또는 잔액 오류입니다.');
      seen.set(event.id,event);
    }
    return ledger;
  }
  function openReceiptLedger(tenant,bill,billId,openedAt,{reviewEstimated=false}={}){
    const {month,id}=journalBillId(billId);journalTime(openedAt);
    if(typeof reviewEstimated!=='boolean')journalError('추정 snapshot 검토 여부는 참/거짓이어야 합니다.');
    if(!journalObject(bill)||tenant?.id!==id||bill.monthSnapshot!==month||bill.receiptLedger!==undefined)journalError('해당 월과 임차인의 저장된 snapshot 고지서를 확인해주세요.');
    journalJSON(bill);
    if(['rent','mgmt','unitSnapshot','paydaySnapshot','tenantSnapshot'].some(key=>bill[key]==null)||bill.elevator==null&&bill.elevatorTotal==null)journalError('청구 기준 snapshot이 필요합니다.');
    if(typeof bill.unitSnapshot!=='string'||typeof bill.paydaySnapshot!=='string'||!journalObject(bill.tenantSnapshot))journalError('청구 기준 snapshot 형식을 확인해주세요.');
    if(bill.snapshotEstimated!=null&&!Array.isArray(bill.snapshotEstimated))journalError('추정 snapshot 목록을 확인해주세요.');
    const estimatedFields=[...(bill.snapshotEstimated||[])];
    if(estimatedFields.length&&!reviewEstimated)journalError('추정된 과거 고지서 snapshot을 먼저 검토해주세요.');
    const state=payment(tenant,bill,'2200-12-31',Number(month.slice(0,4)));
    const ledger={format:RECEIPT_FORMAT,billId,openedAt,charges:Object.fromEntries(itemKeys.map(key=>[key,{amount:state.items[key].amount,exempt:state.items[key].na}])),legacy:legacyReceiptSource(bill),estimatedFields,events:[]};
    return validateReceiptLedger(ledger);
  }
  function appendReceiptEvent(ledger,event){
    validateReceiptLedger(ledger);
    journalJSON(event);
    const next=JSON.parse(JSON.stringify(ledger)),entry=JSON.parse(JSON.stringify(event)),prior=next.events.find(row=>row.id===entry.id);
    if(prior){const keys=new Set([...Object.keys(prior),...Object.keys(entry)]);if([...keys].some(key=>JSON.stringify(prior[key])!==JSON.stringify(entry[key])))journalError('같은 기록 ID에 다른 내용을 사용할 수 없습니다.');return next;}
    next.events.push(entry);return validateReceiptLedger(next);
  }
  function receiptLedgerState(ledger,asOf,knownAt){
    validateReceiptLedger(ledger);const cutoff=typeof asOf==='string'&&dateISO(asOf)===asOf?asOf:'';if(!cutoff)journalError('입금 집계 기준일은 YYYY-MM-DD 실제 날짜여야 합니다.');
    const knowledge=knownAt===undefined?ledger.events.at(-1)?.recordedAt||ledger.openedAt:journalTime(knownAt);
    if(knowledge<ledger.openedAt)journalError('원장 개시 이전의 조회입니다. 과거 확인 원본을 조회해주세요.');
    const events=ledger.events.filter(event=>event.recordedAt<=knowledge),cancelled=new Set(events.filter(event=>event.kind==='void').map(event=>event.reference));
    const legacy=journalLegacy(ledger),items={};let total=0,received=0,legacyConfirmed=0,newReceived=0,exempt=0;
    for(const key of itemKeys){
      const charge=ledger.charges[key],base=legacy[key],opening=!cancelled.has('legacy:'+key)&&(base.undated||base.date&&base.date<=cutoff)?base.amount:0;
      const receipts=events.filter(event=>event.kind==='receipt'&&event.item===key&&!cancelled.has(event.id)&&event.receivedOn<=cutoff);
      const actual=receipts.reduce((sum,event)=>sum+event.amount,0),settled=opening+actual,due=charge.exempt?0:charge.amount;
      const dates=[...new Set([...(opening&&base.date?[base.date]:[]),...receipts.map(event=>event.receivedOn)])].sort();
      items[key]={amount:charge.amount,na:charge.exempt,legacyConfirmed:opening,newReceived:actual,received:settled,unpaid:due-settled,paid:due>0&&due===settled,partial:settled>0&&settled<due,undated:opening>0&&base.undated,dates};
      total+=due;received+=settled;legacyConfirmed+=opening;newReceived+=actual;if(charge.exempt)exempt+=charge.amount;
    }
    return {billId:ledger.billId,asOf:cutoff,knownAt:knowledge,items,total,received,legacyConfirmed,newReceived,unpaid:total-received,exempt,complete:total>0&&total===received};
  }
  function receiptEqual(left,right){
    if(left===right)return true;
    if(!left||!right||typeof left!=='object'||typeof right!=='object'||Array.isArray(left)!==Array.isArray(right))return false;
    const keys=Object.keys(left);return keys.length===Object.keys(right).length&&keys.every(key=>Object.hasOwn(right,key)&&receiptEqual(left[key],right[key]));
  }
  const receiptAnchorKeys=['monthSnapshot','rent','mgmt','elevator','elevatorTotal','electricity','water','waste',
    'electricityNA','waterNA','wasteNA','unitSnapshot','paydaySnapshot','tenantSnapshot','snapshotEstimated','mgmtItems',
    'stampedRent','stampedRentDate','stampedMgmt','stampedMgmtDate','paid'];
  const receiptAnchor=bill=>Object.fromEntries(receiptAnchorKeys.filter(key=>Object.hasOwn(bill,key)).map(key=>[key,bill[key]]));
  function hasReceiptLedgers(data){
    return Object.values(data?.bills||{}).some(rows=>Object.values(rows||{}).some(bill=>bill&&typeof bill==='object'&&Object.hasOwn(bill,'receiptLedger')));
  }
  function validateReceiptBill(tenant,bill,billId){
    if(!journalObject(bill)||!Object.hasOwn(bill,'receiptLedger'))journalError('고지서의 원장 필드가 필요합니다.');
    const ledger=validateReceiptLedger(bill.receiptLedger);
    if(ledger.billId!==billId)journalError('원장과 고지서 식별자가 다릅니다.');
    const original={...bill};delete original.receiptLedger;
    const opening=openReceiptLedger(tenant,original,billId,ledger.openedAt,{reviewEstimated:true});
    if(!receiptEqual(opening.charges,ledger.charges)||!receiptEqual(opening.legacy,ledger.legacy)||!receiptEqual(opening.estimatedFields,ledger.estimatedFields))journalError('고지서 금액·제외 상태·과거 확인 근거와 원장 snapshot이 다릅니다.');
    return ledger;
  }
  function receiptOwner(data,bill,id){
    return (data.tenants||[]).find(tenant=>tenant.id===id)||{id,name:bill.tenantSnapshot?.name||'',unit:bill.unitSnapshot||'',rent:0,mgmt:0,elevator:0};
  }
  function assertReceiptDataTransition(before,after){
    // Persistence boundaries call this against the actual stored preimage, never a cached view.
    for(const [month,rows] of Object.entries(after?.bills||{}))for(const [id,bill] of Object.entries(rows||{})){
      if(!bill||!Object.hasOwn(bill,'receiptLedger'))continue;
      validateReceiptBill(receiptOwner(after,bill,id),bill,month+':'+id);
      const prior=before?.bills?.[month]?.[id];
      if(prior&&!Object.hasOwn(prior,'receiptLedger')&&!receiptEqual(receiptAnchor(prior),receiptAnchor(bill)))journalError('원장 개시와 기존 고지서 금액·확인 근거 변경을 함께 저장할 수 없습니다.');
    }
    for(const [month,rows] of Object.entries(before?.bills||{}))for(const [id,bill] of Object.entries(rows||{})){
      if(!bill||!Object.hasOwn(bill,'receiptLedger'))continue;
      validateReceiptBill(receiptOwner(before,bill,id),bill,month+':'+id);
      const next=after?.bills?.[month]?.[id];
      if(!next||!Object.hasOwn(next,'receiptLedger'))journalError('기존 입금 원장 또는 고지서를 제거할 수 없습니다.');
      if(!receiptEqual(receiptAnchor(bill),receiptAnchor(next)))journalError('원장 고지서의 청구 기준 또는 과거 확인을 변경할 수 없습니다.');
      const oldLedger=bill.receiptLedger,newLedger=next.receiptLedger;
      const header=value=>Object.fromEntries(Object.entries(value).filter(([key])=>key!=='events'));
      if(!receiptEqual(header(oldLedger),header(newLedger))||newLedger.events.length<oldLedger.events.length||oldLedger.events.some((event,index)=>!receiptEqual(event,newLedger.events[index])))journalError('기존 원장 snapshot이나 입금 기록을 삭제·변경할 수 없습니다. 취소 기록을 추가해주세요.');
    }
    return after;
  }
  function payment(tenant, bill = {}, asOf = new Date(), year) {
    if(Object.hasOwn(bill,'receiptLedger')){
      validateReceiptBill(tenant,bill,bill.monthSnapshot+':'+tenant.id);
      const state=receiptLedgerState(bill.receiptLedger,asOfKey(asOf)),items={},groups={};
      for(const [key,item] of Object.entries(state.items))items[key]={...item,date:item.undated?'날짜 미지정':item.dates.at(-1)?.replaceAll('-','.')||'',dates:item.dates.map(date=>date.replaceAll('-','.'))};
      for(const group of ['rent','mgmt']){
        const keys=group==='rent'?['pay_rent']:itemKeys.filter(key=>key!=='pay_rent'),payable=keys.map(key=>items[key]).filter(item=>!item.na);
        const total=payable.reduce((sum,item)=>sum+item.amount,0),received=payable.reduce((sum,item)=>sum+item.received,0);
        groups[group]={total,received,unpaid:total-received,complete:total>0&&total===received,exempt:total===0,dates:[...new Set(payable.flatMap(item=>[...item.dates,...(item.undated?['날짜 미지정']:[])]))].sort()};
      }
      return {...state,items,groups};
    }
    const amounts=charges(tenant,bill), items={}, cutoff=asOfKey(asOf);
    const paymentYear=year || Number(bill.monthSnapshot?.slice(0,4)) || Number(cutoff.slice(0,4));
    let total=0,received=0,exempt=0;
    for(const [key,amount] of Object.entries(amounts)) {
      const item=bill.paid?.[key]||{},rent=key==='pay_rent';
      const stamped=(rent?bill.stampedRent:bill.stampedMgmt)===true;
      const stampDate=rent?bill.stampedRentDate:bill.stampedMgmtDate;
      const rawDate=stamped?stampDate||item.date||'':item.date||'';
      const iso=dateISO(rawDate,paymentYear);
      const na=item.na===true || bill[naFields[key]]===true || amount===0;
      const paid=!na && ((stamped&&!rawDate) || (!!iso&&iso<=cutoff));
      items[key]={amount,paid,na,date:paid?(iso?iso.replaceAll('-','.'): '날짜 미지정'):rawDate,
        undated:paid&&!iso,received:paid?amount:0,unpaid:na||paid?0:amount,partial:false,
        dates:paid&&iso?[iso.replaceAll('-','.')]:[]};
      total+=amount;
      if(na)exempt+=amount;else if(paid)received+=amount;
    }
    const due=total-exempt;
    const groups={};
    for(const group of ['rent','mgmt']) {
      const keys=group==='rent'?['pay_rent']:itemKeys.filter(k=>k!=='pay_rent');
      const payable=keys.map(k=>items[k]).filter(i=>!i.na);
      const amount=payable.reduce((sum,i)=>sum+i.amount,0);
      const paidAmount=payable.filter(i=>i.paid).reduce((sum,i)=>sum+i.amount,0);
      groups[group]={total:amount,received:paidAmount,unpaid:amount-paidAmount,
        complete:amount>0&&amount===paidAmount,exempt:amount===0,
        dates:[...new Set(payable.filter(i=>i.paid).map(i=>i.date))]};
    }
    return {items,groups,total:due,received,unpaid:Math.max(0,due-received),exempt,complete:due>0&&due===received};
  }
  function materializeGroup(tenant,bill,key) {
    const flag=key==='pay_rent'?'stampedRent':'stampedMgmt';
    if(!bill[flag])return;
    // Materialize stored dates even when they are later than today. The date
    // remains future evidence; the current payment projection still excludes it.
    const state=payment(tenant,bill,'2200-12-31');
    if (bill.paid == null) bill.paid = {};
    for(const itemKey of itemKeys.filter(k=>(k==='pay_rent')===(key==='pay_rent'))) {
      const item=state.items[itemKey];
      // Preserve dated confirmations for unchanged items. Undated legacy groups require review.
      if(item.paid&&!item.undated)bill.paid[itemKey]={...bill.paid[itemKey],date:item.date};
    }
    bill[flag]=false;delete bill[flag+'Date'];
  }
  function invalidateChangedPayments(tenant,before,after) {
    const oldState=payment(tenant,before),newState=payment(tenant,after),changed=[];
    for(const key of itemKeys) {
      const old=oldState.items[key],next=newState.items[key];
      if(old.amount===next.amount&&old.na===next.na)continue;
      changed.push(key);
      materializeGroup(tenant,after,key);
      if(after.paid?.[key])delete after.paid[key].date;
    }
    if(changed.length)after.invoiceIssued=false;
    return changed;
  }
  const snapshotFields=['name','biz','contract','contract_first','payday','renew','paytype',
    'period_mgmt','period_rent','period_elec','period_elev','period_waste','period_water_day','period_water_odd'];
  function freezeBill(tenant,bill,month,legacy=false) {
    const estimated=new Set(bill.snapshotEstimated||[]);
    for(const key of ['rent','mgmt','elevator'])if(bill[key]==null) {
      bill[key]=Number(tenant[key])||0;if(legacy)estimated.add(key);
    }
    if(bill.unitSnapshot==null){bill.unitSnapshot=tenant.unit||'';if(legacy)estimated.add('unit');}
    if(bill.paydaySnapshot==null){bill.paydaySnapshot=tenant.payday||'';if(legacy)estimated.add('payday');}
    if (bill.tenantSnapshot == null) bill.tenantSnapshot = {};
    for(const key of snapshotFields)if(!Object.hasOwn(bill.tenantSnapshot,key)) {
      bill.tenantSnapshot[key]=String(tenant[key]??'');if(legacy)estimated.add(key);
    }
    if(month)bill.monthSnapshot=month;
    if(estimated.size)bill.snapshotEstimated=[...estimated];
    return bill;
  }
  function effectiveTenant(tenant,bill={}) {
    return {...tenant,...bill.tenantSnapshot,unit:bill.unitSnapshot??tenant.unit,
      payday:bill.paydaySnapshot??tenant.payday,rent:bill.rent??tenant.rent,
      mgmt:bill.mgmt??tenant.mgmt,elevator:bill.elevator??tenant.elevator,
      mgmtItems:bill.mgmtItems??tenant.mgmtItems};
  }
  function correctBillBasis(tenant,bill,month,patch={}) {
    if(Object.hasOwn(bill,'receiptLedger'))throw new Error('원장 고지서의 청구 기준은 고정되어 있습니다.');
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new Error('고지서 월을 확인해주세요.');
    const allowed=['rent','mgmt','elevatorCharge','unitSnapshot','paydaySnapshot','tenantSnapshot'];
    if(!patch||typeof patch!=='object'||Array.isArray(patch)||Object.keys(patch).some(key=>!allowed.includes(key)))throw new Error('청구 기준 정정 항목을 확인해주세요.');
    const next=JSON.parse(JSON.stringify(bill));freezeBill(tenant,next,month,true);
    for(const key of ['rent','mgmt'])if(Object.hasOwn(patch,key))next[key]=won(patch[key]);
    if(Object.hasOwn(patch,'elevatorCharge')){
      const charge=patch.elevatorCharge;
      if(!charge||!['net','gross'].includes(charge.mode))throw new Error('승강기 금액의 공급가·청구액 구분을 확인해주세요.');
      const value=won(charge.amount);
      if(charge.mode==='gross')next.elevatorTotal=value;
      else{next.elevator=value;delete next.elevatorTotal;}
    }
    for(const key of ['unitSnapshot','paydaySnapshot'])if(Object.hasOwn(patch,key)){
      if(typeof patch[key]!=='string')throw new Error('호실·납기는 문자열로 입력해주세요.');next[key]=patch[key];
    }
    if(Object.hasOwn(patch,'tenantSnapshot')){
      const values=patch.tenantSnapshot;
      if(!values||typeof values!=='object'||Array.isArray(values)||Object.keys(values).some(key=>!snapshotFields.includes(key)||typeof values[key]!=='string'))throw new Error('계약 정보 정정 항목을 확인해주세요.');
      Object.assign(next.tenantSnapshot,values);
    }
    if(Object.hasOwn(patch,'paydaySnapshot'))next.tenantSnapshot.payday=patch.paydaySnapshot;
    else if(Object.hasOwn(patch.tenantSnapshot||{},'payday'))next.paydaySnapshot=patch.tenantSnapshot.payday;
    const changedPayments=invalidateChangedPayments(tenant,bill,next);
    // Estimate provenance stays intact, including fields explicitly corrected.
    return {bill:next,changedPayments};
  }
  function dateISO(value, year = new Date().getFullYear()) {
    if(!/^(?:\d{4}[./-])?\d{1,2}[./-]\d{1,2}$/.test(String(value||'')))return '';
    const parts = String(value||'').split(/[./-]/).map(Number);
    if (parts.length === 2) parts.unshift(year);
    if (parts.length !== 3) return '';
    const [y,m,d] = parts;
    if (!Number.isInteger(y)||y<1900||y>2200||!Number.isInteger(m)||m<1||m>12||!Number.isInteger(d)||d<1||d>new Date(y,m,0).getDate()) return '';
    return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }
  function contractEndDate(contract) {
    const end=String(contract||'').split('~')[1]?.trim();
    return dateISO(end||'');
  }
  function contractDeadline(contract, todayKey) {
    const endDate=contractEndDate(contract),today=dateISO(todayKey||'');
    if(!endDate||!today)return null;
    const utc=value=>{const [y,m,d]=value.split('-').map(Number);return Date.UTC(y,m-1,d);};
    const days=Math.round((utc(endDate)-utc(today))/86400000);
    const label=days>0?`D-${days}`:days===0?'오늘 만료':`D+${Math.abs(days)} 경과`;
    const level=days<0?'overdue':days<=30?'imminent':days<=45?'check':'none';
    return {endDate,days,label,level};
  }
  function period(day, year, month, span = 1) {
    day = Number(day);
    if (!Number.isInteger(day)||day<1||day>31) return '';
    const endStart = new Date(year,month-1,Math.min(day,new Date(year,month,0).getDate()));
    const startMonth = new Date(year,month-1-span,1);
    const start = new Date(startMonth.getFullYear(),startMonth.getMonth(),Math.min(day,new Date(startMonth.getFullYear(),startMonth.getMonth()+1,0).getDate()));
    const end = new Date(endStart); end.setDate(end.getDate()-1);
    const format = d => `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}`;
    return `${format(start)}~${format(end)}`;
  }
  function monthKey(year, month) {
    const y = Number(year), m = Number(month);
    if (!Number.isInteger(y) || y < 1900 || y > 2200 || !Number.isInteger(m) || m < 1 || m > 12) return '';
    return `${y}-${String(m).padStart(2, '0')}`;
  }
  function dateKey(year, month, day) {
    const mk = monthKey(year, month);
    if (!mk) return '';
    const last = new Date(Number(year), Number(month), 0).getDate();
    const d = Number(day);
    if (!Number.isInteger(d) || d < 1 || d > last) return '';
    return `${mk}-${String(d).padStart(2, '0')}`;
  }
  function asOfKey(value = new Date()) {
    if (value instanceof Date && !Number.isNaN(value.valueOf())) {
      return dateKey(value.getFullYear(), value.getMonth() + 1, value.getDate());
    }
    return dateISO(value);
  }
  function paydayOf(tenant) {
    const raw=String(tenant?.payday??'').trim();
    if(/^(?:매월\s*|매달\s*|당월\s*|익월\s*)?(?:말일|월말|말)$/.test(raw))return 31;
    const match=raw.match(/^(?:매월\s*|매달\s*|당월\s*|익월\s*)?(0?[1-9]|[12]\d|3[01])\s*일?$/);
    const day=match?Number(match[1]):0;
    return Number.isInteger(day) && day >= 1 && day <= 31 ? day : 0;
  }
  function dueDate(tenant, itemKey, year, month) {
    if (itemKey === 'pay_rent') {
      const day = paydayOf(tenant);
      return day ? dateKey(year, month, Math.min(day, new Date(Number(year), Number(month), 0).getDate())) : '';
    }
    const mk = monthKey(year, month);
    return mk ? dateKey(year, month, new Date(Number(year), Number(month), 0).getDate()) : '';
  }
  function historicalPayment(tenant, bill = {}, year, month, asOf = new Date()) {
    const base = payment(tenant,bill,asOf,year);
    tenant=effectiveTenant(tenant,bill);
    const cutoff = asOfKey(asOf);
    const items = {};
    let notDue = 0, overdue = 0, paid = 0, exempt = 0, unknownDue = 0;
    for (const [key, item] of Object.entries(base.items)) {
      const itemDueDate = dueDate(tenant, key, year, month);
      let status;
      if (item.na) {
        status = 'exempt';
        exempt += item.amount;
      } else if (item.paid) {
        status = 'paid';
        paid += item.received;
      } else if (!itemDueDate || !cutoff || itemDueDate >= cutoff) {
        // 지급일이 설정되지 않은 월세도 임의로 체납으로 만들지 않는다.
        status = 'notDue';
        paid += item.received;
        notDue += item.unpaid;
        if(!itemDueDate)unknownDue+=item.unpaid;
      } else {
        status = 'overdue';
        paid += item.received;
        overdue += item.unpaid;
      }
      items[key] = {...item, status, dueDate: itemDueDate};
    }
    return {...base, items, notDue, overdue, paid, received:paid, exempt, unknownDue,
      due: paid + overdue, unpaid: notDue + overdue,
      complete: base.total > 0 && notDue === 0 && overdue === 0};
  }
  function arrears(tenants = [], bills = {}, asOf = new Date()) {
    const cutoff = asOfKey(asOf);
    const cutoffMonth = cutoff.slice(0, 7);
    const byTenant = new Map();
    const months = new Set();
    for (const [mk, rows] of Object.entries(bills || {})) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mk) || (cutoffMonth && mk > cutoffMonth) || !rows || typeof rows !== 'object') continue;
      const [year, month] = mk.split('-').map(Number);
      for (const [id,bill] of Object.entries(rows)) {
        const tenant=tenants.find(t=>t.id===id)||{id,name:bill?.tenantSnapshot?.name||'세입자 정보 없음 ('+id+')',unit:bill?.unitSnapshot||'',rent:0,mgmt:0,elevator:0};
        if (!bill || typeof bill !== 'object' || Array.isArray(bill) || !Object.keys(bill).length) continue;
        const state = historicalPayment(tenant, bill, year, month, asOf);
        if (state.overdue <= 0) continue;
        const current = byTenant.get(tenant.id) || {
          id: tenant.id, name: effectiveTenant(tenant,bill).biz || effectiveTenant(tenant,bill).name, unit: bill.unitSnapshot??tenant.unit, overdue: 0, months: []
        };
        const items = Object.entries(state.items)
          .filter(([, item]) => item.status === 'overdue' && item.amount > 0)
          .map(([key]) => key);
        current.overdue += state.overdue;
        current.months.push({month: mk, amount: state.overdue, items});
        byTenant.set(tenant.id, current);
        months.add(mk);
      }
    }
    const tenantRows = [...byTenant.values()]
      .map(row => ({...row, months: row.months.sort((a, b) => b.month.localeCompare(a.month))}))
      .sort((a, b) => b.overdue - a.overdue || String(a.name).localeCompare(String(b.name)));
    return {
      total: tenantRows.reduce((sum, row) => sum + row.overdue, 0),
      tenantCount: tenantRows.length,
      monthCount: months.size,
      tenants: tenantRows,
    };
  }
  function collectionStatus(tenant, bills = {}, asOf = new Date()) {
    const cutoff = asOfKey(asOf);
    if (!cutoff) throw new Error('수납상태 기준일을 확인해주세요.');
    const cutoffMonth = cutoff.slice(0, 7);
    let overdueRent = 0, overdueUtilities = 0, totalUnpaid = 0, unknownDue = 0, notDue = 0;
    let lastPaymentDate = '', billCount = 0;
    for (const [month, rows] of Object.entries(bills || {})) {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || month > cutoffMonth) continue;
      const bill = rows?.[tenant.id];
      // An unsaved month is not a charge. Preserve the existing billing boundary.
      if (!bill || typeof bill !== 'object' || Array.isArray(bill) || !Object.keys(bill).length) continue;
      const [year, monthNumber] = month.split('-').map(Number);
      const paymentState = historicalPayment(tenant, bill, year, monthNumber, asOf);
      billCount++;
      totalUnpaid += paymentState.unpaid;
      unknownDue += paymentState.unknownDue;
      notDue += paymentState.notDue;
      for (const [key, item] of Object.entries(paymentState.items)) {
        if (item.status === 'overdue') {
          if (key === 'pay_rent') overdueRent += item.unpaid;
          else overdueUtilities += item.unpaid;
        }
        const paidDate = item.dates?.at(-1)?dateISO(item.dates.at(-1),year):item.paid&&!item.undated?dateISO(item.date,year):'';
        if (paidDate && paidDate > lastPaymentDate) lastPaymentDate = paidDate;
      }
    }
    const status = overdueRent > 0 && overdueUtilities > 0 ? '월차임·공과금 연체'
      : overdueRent > 0 ? '월차임 연체' : overdueUtilities > 0 ? '공과금 연체' : '정상';
    return {status, overdueRent, overdueUtilities, totalOverdue:overdueRent + overdueUtilities,
      totalUnpaid, lastPaymentDate, unknownDue, notDue, billCount};
  }
  function quarterlyStatement(tenants, bills, year, quarter, asOf = new Date()) {
    if(!Number.isInteger(year)||!monthKey(year,1)||!Number.isInteger(quarter)||quarter<1||quarter>4)
      throw new Error('집계 연도와 분기를 확인해주세요.');
    const cutoff=asOfKey(asOf);if(!cutoff)throw new Error('수납 집계 기준일을 확인해주세요.');
    const months=[0,1,2].map(offset=>monthKey(year,(quarter-1)*3+1+offset));
    const people=new Map(tenants.map(tenant=>[tenant.id,tenant])),groups=new Map();
    const fields=['rentNet','mgmtNet','elecNet','taxableNet','vat','otherCharges','gross','received','unpaid','overdue','notDue','unknownDue','billCount','invoiceCount'];
    const zeros=()=>Object.fromEntries(fields.map(key=>[key,0]));
    const add=(target,values)=>{for(const key of fields){const next=target[key]+values[key];if(!Number.isSafeInteger(next)||next<0)throw new Error('분기 집계 금액의 정수 범위를 확인해주세요.');target[key]=next;}};
    for(const month of months)for(const [id,bill] of Object.entries(bills[month]||{})) {
      if(!bill||!Object.keys(bill).length)continue;
      const registered=people.get(id),tenant=registered||{id,name:'미등록 임차인',unit:'',rent:0,mgmt:0,elevator:0};
      const saved=effectiveTenant(tenant,bill),state=historicalPayment({...saved,id},bill,year,Number(month.slice(5)),cutoff);
      const sameIdentity=!!registered&&['unit','name','biz'].every(key=>String(saved[key]||'')===String(registered[key]||''));
      // Older invoices do not snapshot registration/deposit metadata. Only use
      // current registration when the saved occupant identity still matches.
      const identity={id,unit:String(saved.unit||''),name:String(saved.name||''),biz:String(saved.biz||''),
        bizNo:sameIdentity?String(registered.bizNo||''):'',repName:sameIdentity?String(registered.repName||registered.name||''):'',
        deposit:sameIdentity?won(amount(registered.deposit)):0};
      const key=JSON.stringify([id,identity.unit,identity.name,identity.biz]);
      if(!groups.has(key))groups.set(key,{...zeros(),identity,months:[],estimatedFields:[],orphan:!registered,archived:registered?.archived===true,metadataSource:sameIdentity?'current':'unavailable'});
      const row=groups.get(key),items=state.items;
      const rentNet=items.pay_rent.na?0:won(amount(saved.rent)),mgmtNet=items.pay_mgmt.na?0:won(amount(saved.mgmt)),elecNet=items.pay_elec.na?0:won(amount(bill.electricity));
      const taxableNet=rentNet+mgmtNet+elecNet;
      const taxableGross=['pay_rent','pay_mgmt','pay_elec'].reduce((sum,key)=>sum+(items[key].na?0:items[key].amount),0);
      const otherCharges=['pay_water','pay_elev','pay_waste'].reduce((sum,key)=>sum+(items[key].na?0:items[key].amount),0);
      const values={rentNet,mgmtNet,elecNet,taxableNet,vat:taxableGross-taxableNet,otherCharges,gross:taxableGross+otherCharges,
        received:state.received,unpaid:state.unpaid,overdue:state.overdue,notDue:state.notDue,unknownDue:state.unknownDue,billCount:1,invoiceCount:bill.invoiceIssued===true?1:0};
      add(row,values);row.months.push(month);row.estimatedFields=[...new Set([...row.estimatedFields,...(bill.snapshotEstimated||[])])];
    }
    const rows=[...groups.values()].sort((a,b)=>a.identity.unit.localeCompare(b.identity.unit,'ko',{numeric:true})||a.identity.name.localeCompare(b.identity.name,'ko'));
    const totals=zeros();for(const row of rows)add(totals,row);
    return {year,quarter,months,asOf:cutoff,rows,totals};
  }
  root.RentalBilling = {won, withVat, floorOf, distribute, calculate, reconcile, charges, payment, quarterlyStatement,
    dateISO, contractEndDate, contractDeadline, period, dueDate, historicalPayment, arrears, itemKeys, naFields,
    materializeGroup, invalidateChangedPayments, freezeBill, effectiveTenant, correctBillBasis, collectionStatus,
    RECEIPT_FORMAT,openReceiptLedger,validateReceiptLedger,appendReceiptEvent,receiptLedgerState,
    hasReceiptLedgers,validateReceiptBill,assertReceiptDataTransition};
  if (typeof module !== 'undefined') module.exports = root.RentalBilling;
})(globalThis);
