const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');

function server(options={}) {
  let held=false,fail='',writes=0,maxRows=1000;
  const initialRaw=options.raw||JSON.stringify({tenants:[],bills:{}});
  const targetRows=[];
  for(let i=0;i<initialRaw.length;i+=35000)targetRows.push([initialRaw.slice(i,i+35000)]);
  if(!targetRows.length)targetRows.push(['']);
  const backupRows=[];
  const props=new Map(Object.entries(options.properties||{}));
  function sheet(id,rows,isBackup=false){
    return {
      getSheetId:()=>id,
      getLastRow:()=>{for(let i=rows.length-1;i>=0;i--)if((rows[i]||[]).some(v=>v!==''&&v!=null))return i+1;return 0;},
      getMaxRows:()=>maxRows,insertRowsAfter:(_after,count)=>{maxRows+=count;},
      getRange:(row,column,numRows=1,numColumns=1)=>({
        getValue:()=>rows[row-1]?.[column-1]??'',
        getValues:()=>{if(isBackup&&fail==='backup-read')throw Error('backup read quota');const values=Array.from({length:numRows},(_,r)=>Array.from({length:numColumns},(_,c)=>rows[row-1+r]?.[column-1+c]??''));if(isBackup&&fail==='backup-hash'&&values.length)values[0][2]+='bad';return values;},
        setValue:value=>{if(fail===(isBackup?'backup':'write'))throw Error((isBackup?'backup':'write')+' failed');rows[row-1]??=[];rows[row-1][column-1]=value;if(!isBackup)writes++;},
        setValues:values=>{if(fail===(isBackup?'backup':'write'))throw Error((isBackup?'backup':'write')+' failed');values.forEach((source,r)=>{if(!isBackup&&((fail==='partial-write'&&r>0)||(fail==='last-write'&&r===values.length-1)))throw Error('partial write');source.forEach((value,c)=>{rows[row-1+r]??=[];rows[row-1+r][column-1+c]=value;});});if(!isBackup)writes++;},
        clearContent:()=>{if(!isBackup&&fail==='clear')throw Error('clear quota');for(let r=0;r<numRows;r++)for(let c=0;c<numColumns;c++)if(rows[row-1+r])rows[row-1+r][column-1+c]='';}
      })
    };
  }
  const target=sheet(0,targetRows),backup=sheet(8,backupRows,true);
  const book={getActiveSheet:()=>target,getSheetById:id=>id===0?target:null,getSheetByName:name=>name==='_RentalSyncRecovery'?backup:null,insertSheet:()=>backup};
  class Paragraph {constructor(value){this.value=String(value);}getText(){return this.value;}getType(){return 'PARAGRAPH';}setHeading(){return this;}}
  class Body {
    constructor(texts=[]){this.children=texts.map(text=>new Paragraph(text));}
    getNumChildren(){return this.children.length;}getChild(index){return this.children[index];}
    appendParagraph(text){const p=new Paragraph(text);this.children.push(p);return p;}
    insertParagraph(index,text){const p=new Paragraph(text);this.children.splice(index,0,p);return p;}
    removeChild(child){const index=this.children.indexOf(child);if(index>=0)this.children.splice(index,1);}
  }
  const docId='1YjTZPiRA2vnfAuWp1UTBci8F4yUNozQjYhE9QwMdtuQ';
  const body=new Body(options.documentTexts||['사용자 메모 위','[RENTAL_CURRENT_STATUS_BEGIN]','이전 자동 내용','[RENTAL_CURRENT_STATUS_END]','사용자 메모 아래']);
  const document={getId:()=>docId,getUrl:()=>`https://docs.google.com/document/d/${docId}/edit`,getBody:()=>body,saveAndClose:()=>{}};
  const defaultStatusDocumentId='1YjTZPiRA2vnfAuWp1UTBci8F4yUNozQjYhE9QwMdtuQ';
  const DocumentApp={ElementType:{PARAGRAPH:'PARAGRAPH'},ParagraphHeading:{HEADING1:'HEADING1',HEADING2:'HEADING2'},openById:id=>{if(fail==='docs'||(id!==docId&&id!==defaultStatusDocumentId))throw Error('document unavailable');return document;},create:()=>{throw Error('unexpected document creation');}};
  const DriveApp={getFilesByName:()=>{throw Error('unexpected filename lookup');}};
  const calendarEvents=new Map();let calendarSequence=0;
  const dateKey=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  class CalendarEvent {
    constructor(title,date,description){this.id='event-'+(++calendarSequence);this.title=title;this.date=dateKey(date);this.description=description||'';}
    getTitle(){return this.title;}getDescription(){return this.description;}getId(){if(fail==='calendar-id')throw Error('event ID acknowledgement failed');return this.id;}setTitle(value){this.title=value;return this;}setDescription(value){this.description=value;return this;}
    setAllDayDate(value){this.date=dateKey(value);return this;}
  }
  const calendar={getId:()=>'independent-calendar',
    getEvents:(_start,_end,config)=>[...calendarEvents.values()].filter(event=>!config?.search||event.description.includes(config.search)),
    getEventById:id=>{if(fail==='calendar')throw Error('calendar unavailable');return calendarEvents.get(id)||null;},
    createAllDayEvent:(title,date,config)=>{if(fail==='calendar'||fail==='calendar-permission')throw Error('calendar permission denied');const event=new CalendarEvent(title,date,config?.description);calendarEvents.set(event.id,event);if(fail==='calendar-after-create')throw Error('creation acknowledgement lost');return event;}
  };
  const CalendarApp={getDefaultCalendar:()=>{throw Error('original calendar must never be used');},createCalendar:()=>{if(fail==='calendar-permission')throw Error('calendar permission denied');return calendar;},getCalendarById:id=>{if(fail==='calendar-permission')throw Error('calendar permission denied');return id==='missing'?null:calendar;}};
  if(options.existingDocument!==false&&!props.has('RENTAL_STATUS_DOCUMENT_ID'))props.set('RENTAL_STATUS_DOCUMENT_ID',docId);
  const c=vm.createContext({
    Date:options.now?class extends Date {constructor(...args){super(...(args.length?args:[options.now]));}}:Date,
    ContentService:{MimeType:{JSON:'json'},createTextOutput:s=>({setMimeType:()=>s})},
    Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(a,s)=>[...crypto.createHash('sha256').update(s).digest()],getUuid:()=>crypto.randomUUID(),formatDate:(date,_zone,format)=>format==='yyyy-MM-dd'?date.toISOString().slice(0,10):date.toISOString().replace('T',' ').slice(0,19)},
    LockService:{getScriptLock:()=>({tryLock:()=>!held&&(held=true),releaseLock:()=>{held=false;}})},SpreadsheetApp:{openById:id=>{assert.equal(id,'1E9YcSQSNTLTC41fqWBYHMNpSRKQrDlvAXeF9AxdDFb8');return book;},flush:()=>{}},DocumentApp,DriveApp,CalendarApp,
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>props.get(key)??null,deleteProperty:key=>props.delete(key),setProperty:(key,value)=>{if(fail==='calendar-map'&&key==='INDEPENDENT_CONTRACT_CALENDAR_EVENTS_V1')throw Error('mapping write failed');return props.set(key,value);}})}
  });
  for(const file of ['Billing.gs','CurrentStatus.gs','CalendarSync.gs','Code.gs'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../server',file),'utf8'),c,{filename:file});
  c.INDEPENDENT_CONTRACT_CALENDAR_ID='independent-calendar';
  const get=(params={})=>JSON.parse(c.doGet({parameter:{api:'1',...params}})),post=req=>JSON.parse(c.doPost({postData:{contents:JSON.stringify(req)}}));
  const request=(data={tenants:[],bills:{}})=>({protocol:'rental-sync-v2',expectedRevision:get({receiptLedgerProtocol:'rental-receipts-v1'}).revision,requestId:crypto.randomUUID(),data});
  return {get,post,request,writes:()=>writes,backupRows,body,props,dropEvent:id=>calendarEvents.delete(id),loseMarker:()=>calendarEvents.forEach(event=>{event.description=event.description.split('\n[RENTAL_INDEPENDENT_CONTRACT:')[0];}),events:()=>[...calendarEvents.values()].map(event=>({...event})),raw:()=>targetRows.map(row=>String(row[0]||'')).join(''),fail:value=>{fail=value;},hold:value=>{held=value;},corrupt:value=>{targetRows.splice(0,targetRows.length,[value]);}};
}

const receiptBilling=require('../assets/billing.js');
const receiptProtocol={receiptLedgerProtocol:receiptBilling.RECEIPT_FORMAT};
const receiptClone=x=>JSON.parse(JSON.stringify(x));
function receiptFixture(adopt=true){
 const tenant={id:'receipt1',name:'원장 서버 검증',unit:'201호',rent:100000,mgmt:10000,elevator:0,payday:'15일'},bill=receiptBilling.freezeBill(tenant,{water:10000,paid:{pay_water:{date:null,na:null,extension:{nullable:null}}}},'2026-10');
 if(adopt)bill.receiptLedger=receiptBilling.openReceiptLedger(tenant,bill,'2026-10:receipt1','2026-10-01T00:00:00.000Z');return {tenants:[tenant],bills:{'2026-10':{receipt1:bill}}};
}
function receiptAppend(data,id='r1',amount=30000){const next=receiptClone(data),bill=next.bills['2026-10'].receipt1;bill.receiptLedger=receiptBilling.appendReceiptEvent(bill.receiptLedger,{kind:'receipt',id,billId:'2026-10:receipt1',item:'pay_rent',amount,receivedOn:'2026-10-02',recordedAt:'2026-10-10T00:00:00.000Z',note:'검증 입금'});return next;}
test('receipt Docs render remaining cash arrears and partial recent date from verified storage',()=>{
 const data=receiptAppend(receiptFixture()),s=server({raw:JSON.stringify(data),now:'2026-11-01T03:00:00.000Z'});
 const result=s.post({...s.request(),action:'regenerateCurrentStatus',data:undefined});assert.equal(result.docs.status,'ok');const text=s.body.children.map(p=>p.value).join('\n');assert.match(text,/총 미납금액: 101,000원 \/ 연체금액: 101,000원/);assert.match(text,/월차임 연체: 80,000원 \/ 공과금 연체: 21,000원/);assert.match(text,/최근 납부일: 2026-10-02/);assert.match(text,/부분입금/);assert.equal(s.writes(),0);
});
test('receipt server requires explicit reader and writer support before exposing or replacing journals',()=>{
 const data=receiptFixture(),s=server({raw:JSON.stringify(data)}),raw=s.raw();assert.equal(s.get().status,'unsupported');assert.equal(s.get().data,undefined);assert.equal(s.get({receiptLedgerProtocol:'future'}).data,undefined);assert.deepEqual(s.get(receiptProtocol).data,data);
 for(const candidate of [data,receiptFixture(false),{tenants:[],bills:{}}]){assert.equal(s.post(s.request(candidate)).status,'unsupported');assert.equal(s.raw(),raw);assert.equal(s.writes(),0);assert.equal(s.backupRows.length,0);}
 const old=server({raw:JSON.stringify(receiptFixture(false))});assert.equal(old.post(old.request(data)).status,'unsupported');assert.equal(old.writes(),0);
});
test('receipt adoption append cancellation readback and request retries preserve exact history and nullable evidence',()=>{
 const original=receiptFixture(false),s=server({raw:JSON.stringify(original)}),docs=s.body.children.map(p=>p.value);let data=receiptFixture();let req={...s.request(data),...receiptProtocol};let ack=s.post(req);assert.equal(ack.status,'ok');assert.equal(ack.docs.status,'ok');assert.deepEqual(s.get(receiptProtocol).data,data);assert.equal(s.body.children[0].value,docs[0]);assert.equal(s.body.children.at(-1).value,docs.at(-1));
 data=receiptAppend(data);req={...s.request(data),...receiptProtocol};ack=s.post(req);const count=s.backupRows.length;const retry=s.post(req);assert.equal(retry.status,'ok');assert.equal(retry.duplicate,true);assert.equal(s.writes(),2);assert.equal(s.backupRows.length,count);assert.equal(s.get(receiptProtocol).revision,ack.revision);
 const corrected=receiptClone(data),bill=corrected.bills['2026-10'].receipt1;bill.receiptLedger=receiptBilling.appendReceiptEvent(bill.receiptLedger,{kind:'void',id:'v1',billId:'2026-10:receipt1',reference:'r1',recordedAt:'2026-10-11T00:00:00.000Z',reason:'오입력'});assert.equal(s.post({...s.request(corrected),...receiptProtocol}).status,'ok');assert.deepEqual(s.get(receiptProtocol).data,corrected);assert.equal(s.writes(),3);
 const result=s.post({...s.request(),action:'regenerateCurrentStatus',data:undefined});assert.equal(result.status,'ok');assert.equal(result.docs.status,'ok');assert.equal(s.body.children[0].value,docs[0]);assert.equal(s.body.children.at(-1).value,docs.at(-1));
});
test('typed receipt writer rejects history removal snapshot changes and valid-but-mutated prefixes before recovery writes',()=>{
 const original=receiptAppend(receiptFixture()),mutations=[x=>delete x.bills['2026-10'].receipt1.receiptLedger,x=>x.bills={},x=>x.bills['2026-10'].receipt1.receiptLedger.events=[],x=>x.bills['2026-10'].receipt1.receiptLedger.events[0].note='변경',x=>x.bills['2026-10'].receipt1.receiptLedger.openedAt='2026-09-30T00:00:00.000Z',x=>x.bills['2026-10'].receipt1.paydaySnapshot='20일',x=>{const bill=x.bills['2026-10'].receipt1;bill.rent=200000;bill.receiptLedger.charges.pay_rent.amount=220000;}];
 for(const mutate of mutations){const s=server({raw:JSON.stringify(original)}),data=receiptClone(original);mutate(data);const before=s.raw();assert.equal(s.post({...s.request(data),...receiptProtocol}).status,'error');assert.equal(s.writes(),0);assert.equal(s.backupRows.length,0);assert.equal(s.props.has('INDEPENDENT_SYNC_WRITE_JOURNAL'),false);assert.equal(s.raw(),before);}
});
test('receipt concurrency stale revision and altered retry enforce one acknowledged append',()=>{
 const original=receiptFixture(),s=server({raw:JSON.stringify(original)}),a={...s.request(receiptAppend(original,'a')),...receiptProtocol},other={...s.request(receiptAppend(original,'b',40000)),...receiptProtocol};assert.equal(s.post(a).status,'ok');assert.equal(s.post(other).status,'conflict');assert.equal(s.post({...a,data:receiptAppend(original,'a',29999)}).status,'error');assert.equal(s.post(a).duplicate,true);assert.equal(s.writes(),1);
});
test('receipt invalid binding malformed ledgers and simultaneous adoption changes never touch DB or recovery',()=>{
 for(const mutate of [x=>x.bills['2026-10'].receipt1.receiptLedger=null,x=>x.bills['2026-10'].receipt1.receiptLedger.billId='2026-10:other',x=>x.bills['2026-10'].receipt1.receiptLedger.format='future',x=>x.bills['2026-10'].receipt1.rent=200000]){const s=server(),data=receiptFixture();mutate(data);assert.equal(s.post({...s.request(data),...receiptProtocol}).status,'error');assert.equal(s.writes(),0);assert.equal(s.backupRows.length,0);}
 const before=receiptFixture(false);before.bills['2026-10'].receipt1.stampedRent=true;const s=server({raw:JSON.stringify(before)});assert.equal(s.post({...s.request(receiptFixture()),...receiptProtocol}).status,'error');assert.equal(s.writes(),0);
});
test('large receipt payload and storage failure retain full recovery and reject silent historical overwrite',()=>{
 const original={...receiptFixture(),extra:'보관'.repeat(20000)},s=server({raw:JSON.stringify(original)}),data=receiptAppend(original);const raw=s.raw();const ack=s.post({...s.request(data),...receiptProtocol});assert.equal(ack.status,'ok');assert.equal(s.backupRows.map(row=>row[2]).join(''),raw);assert.deepEqual(s.get(receiptProtocol).data,data);
 const failure=server({raw:JSON.stringify(original)});failure.fail('write');assert.equal(failure.post({...failure.request(data),...receiptProtocol}).status,'error');assert.equal(failure.raw(),raw);assert.equal(failure.get(receiptProtocol).status,'ok');
});
test('GET is read-only and advertises conditional writes, current status and contract calendar',()=>{const s=server(),before=s.raw(),result=s.get();assert.equal(result.capabilities.conditionalWrite,true);assert.equal(result.capabilities.currentStatus,true);assert.equal(result.capabilities.contractCalendar,true);assert.equal(s.raw(),before);assert.equal(s.writes(),0);});
test('save writes a complete recovery set and returns persisted revision and docs result',()=>{const s=server(),before=s.raw(),r=s.request({tenants:[],bills:{},expenses:{},historical:'preserve'}),ack=s.post(r);assert.equal(ack.status,'ok');assert.equal(ack.requestId,r.requestId);assert.equal(ack.docs.status,'ok');assert.equal(s.get().revision,ack.revision);assert.deepEqual(s.get().data,r.data);assert.equal(s.backupRows.map(row=>row[2]).join(''),before);assert.equal(s.backupRows[0][6],'rental-recovery-v2');});
test('optional empty-floor operations round-trip without creating a tenant',()=>{const s=server(),data={tenants:[],bills:{},floorOperations:{5:{leaseStatus:'공실(정리중)'}}},ack=s.post(s.request(data));assert.equal(ack.status,'ok');assert.deepEqual(s.get().data,data);assert.equal(s.get().data.tenants.length,0);for(const floorOperations of [{6:{leaseStatus:'공실(정리중)'}},{5:{leaseStatus:'추정 상태'}}]){const invalid=server(),result=invalid.post(invalid.request({tenants:[],bills:{},floorOperations}));assert.equal(result.status,'error');assert.equal(invalid.writes(),0);}});
test('two clients sharing a version allow exactly one write',()=>{const s=server(),a=s.request(),b=s.request();assert.equal(s.post(a).status,'ok');assert.equal(s.post(b).status,'conflict');assert.equal(s.writes(),1);});
test('same request retry does not write or back up twice',()=>{const s=server(),r=s.request(),ack=s.post(r),backupCount=s.backupRows.length,retry=s.post(r);assert.equal(retry.revision,ack.revision);assert.equal(retry.duplicate,true);assert.equal(s.writes(),1);assert.equal(s.backupRows.length,backupCount);});
test('ID reuse with different contents fails and old retry after later write conflicts',()=>{const s=server(),r=s.request();s.post(r);assert.equal(s.post({...r,data:{tenants:[],bills:{},loans:[]}}).status,'error');s.post(s.request());assert.equal(s.post(r).status,'conflict');assert.equal(s.writes(),2);});
test('legacy unconditional POST never mutates storage',()=>{const s=server(),before=s.raw();assert.equal(s.post({tenants:[],bills:{}}).status,'unsupported');assert.equal(s.raw(),before);});
test('backup failure and write failure preserve original data',()=>{for(const fault of ['backup','write']){const s=server(),r=s.request(),before=s.raw();s.fail(fault);assert.equal(s.post(r).status,'error');assert.equal(s.raw(),before);assert.equal(s.get().status,'ok');}});
test('invalid and oversized payloads fail before backup or mutation',()=>{for(const data of [{tenants:[],bills:[]},{tenants:[],bills:{},extra:'x'.repeat(5000001)},JSON.parse('{"tenants":[],"bills":{},"__proto__":{}}')]){const s=server(),r=s.request(data);assert.equal(s.post(r).status,'error');assert.equal(s.writes(),0);assert.equal(s.backupRows.length,0);}});
test('77k+ payloads save in chunks and recovery retains the complete prior source',()=>{const oldData={tenants:[],bills:{},old:'o'.repeat(78000)},s=server({raw:JSON.stringify(oldData)}),before=s.raw(),largeData={tenants:[],bills:{},next:'x'.repeat(85000)},ack=s.post(s.request(largeData));assert.equal(ack.status,'ok');assert.equal(s.get().revision,ack.revision);assert.deepEqual(s.get().data,largeData);assert.equal(s.backupRows.length,Math.ceil(before.length/35000));assert.equal(s.backupRows.map(row=>row[2]).join(''),before);});
test('Docs failure is reported separately and never rolls back a verified DB save',()=>{const s=server(),r=s.request({tenants:[],bills:{},marker:'saved'});s.fail('docs');const ack=s.post(r);assert.equal(ack.status,'ok');assert.equal(ack.docs.status,'error');assert.equal(s.get().data.marker,'saved');assert.equal(s.writes(),1);});
test('manual status regeneration uses saved DB, preserves revision and does not write DB',()=>{const s=server(),remote=s.get(),before=s.raw(),ack=s.post({protocol:'rental-sync-v2',action:'regenerateCurrentStatus',expectedRevision:remote.revision,requestId:crypto.randomUUID()});assert.equal(ack.status,'ok');assert.equal(ack.revision,remote.revision);assert.equal(ack.docs.status,'ok');assert.equal(s.raw(),before);assert.equal(s.writes(),0);});
test('stale manual regeneration conflicts and payload injection is rejected',()=>{const s=server(),base={protocol:'rental-sync-v2',action:'regenerateCurrentStatus',requestId:crypto.randomUUID()};assert.equal(s.post({...base,expectedRevision:'sha256-stale'}).status,'conflict');assert.equal(s.post({...base,expectedRevision:s.get().revision,data:{tenants:[],bills:{}}}).status,'error');});
test('Calendar sync creates eligible contract events once and never mutates DB',()=>{
  const data={tenants:[
    {id:'t1',name:'김임차',biz:'가게',unit:'301호',leaseStatus:'재계약예정',contract:'2026/01/01 ~ 2026/12/31'},
    {id:'t2',name:'공실',unit:'501호',leaseStatus:'공실(정리중)',contract:'2026/01/01 ~ 2026/11/30'},
    {id:'t3',name:'날짜없음',unit:'201호',leaseStatus:'임대중',contract:''},
    {id:'old',name:'과거',unit:'401호',archived:true,contract:'2025/01/01 ~ 2025/12/31'}
  ],bills:{}};
  const s=server({raw:JSON.stringify(data)}),remote=s.get(),before=s.raw();
  const request=()=>({protocol:'rental-sync-v2',action:'syncContractCalendar',expectedRevision:remote.revision,requestId:crypto.randomUUID()});
  const first=s.post(request());assert.equal(first.status,'ok');assert.deepEqual({created:first.calendar.created,updated:first.calendar.updated,skipped:first.calendar.skipped,total:first.calendar.total},{created:1,updated:0,skipped:2,total:1});
  assert.equal(s.events().length,1);assert.match(s.events()[0].title,/3층 가게 계약 만료/);assert.equal(s.events()[0].date,'2026-12-31');
  const second=s.post(request());assert.deepEqual({created:second.calendar.created,updated:second.calendar.updated},{created:0,updated:1});assert.equal(s.events().length,1);
  assert.equal(s.raw(),before);assert.equal(s.writes(),0);
});
test('Calendar sync updates the same event after contract and identity changes',()=>{
  const original={tenants:[{id:'t1',name:'이전이름',biz:'이전상호',unit:'201호',contract:'2026/01/01 ~ 2026/10/01'}],bills:{}};
  const s=server({raw:JSON.stringify(original)}),firstRemote=s.get();
  const sync=remote=>s.post({protocol:'rental-sync-v2',action:'syncContractCalendar',expectedRevision:remote.revision,requestId:crypto.randomUUID()});
  assert.equal(sync(firstRemote).calendar.created,1);const eventId=s.events()[0].id;
  const changed={tenants:[{...original.tenants[0],name:'새이름',biz:'새상호',contract:'2026/01/01 ~ 2027/01/15'}],bills:{}};
  const save=s.post({...s.request(changed),data:changed});assert.equal(save.status,'ok');
  const result=sync(s.get());assert.equal(result.calendar.updated,1);assert.equal(s.events().length,1);assert.equal(s.events()[0].id,eventId);assert.equal(s.events()[0].date,'2027-01-15');assert.match(s.events()[0].title,/새상호/);assert.match(s.events()[0].description,/새이름/);
});
test('Calendar permission and API failures are isolated from DB and reject stale or injected requests',()=>{
  const data={tenants:[{id:'t1',name:'임차인',unit:'101호',contract:'2026/01/01 ~ 2026/12/31'}],bills:{}},s=server({raw:JSON.stringify(data)}),remote=s.get(),before=s.raw();
  const base={protocol:'rental-sync-v2',action:'syncContractCalendar',requestId:crypto.randomUUID()};
  assert.equal(s.post({...base,expectedRevision:'sha256-stale'}).status,'conflict');
  assert.equal(s.post({...base,requestId:crypto.randomUUID(),expectedRevision:remote.revision,data}).status,'error');
  for(const fault of ['calendar-permission','calendar']){s.fail(fault);const ack=s.post({...base,requestId:crypto.randomUUID(),expectedRevision:remote.revision});assert.equal(ack.status,'ok');assert.equal(ack.calendar.status,'error');assert.match(ack.calendar.message,/Calendar/);}
  assert.equal(s.raw(),before);assert.equal(s.writes(),0);
  s.fail('calendar-permission');const saved=s.post(s.request({...data,marker:'db-safe'}));assert.equal(saved.status,'ok');assert.equal(s.get().data.marker,'db-safe');
});
test('generated document replaces only marked region and preserves user text',()=>{const s=server(),r=s.request({tenants:[{id:'t1',name:'임차인',unit:'201호',payday:'15일',rent:100000,mgmt:10000}],bills:{}});assert.equal(s.post(r).docs.status,'ok');const values=s.body.children.map(child=>child.getText());assert.equal(values[0],'사용자 메모 위');assert.equal(values.at(-1),'사용자 메모 아래');assert.ok(values.includes('201호 · 임차인'));assert.ok(!values.includes('이전 자동 내용'));});
test('current status omits archived historical tenants',()=>{const s=server(),r=s.request({tenants:[{id:'old',name:'이전 임차인',unit:'201호',archived:true}],bills:{}});assert.equal(s.post(r).docs.status,'ok');assert.ok(!s.body.children.some(child=>child.getText().includes('이전 임차인')));});
test('missing configured document ID reports an error without creating a replacement',()=>{const s=server({properties:{RENTAL_STATUS_DOCUMENT_ID:'missing-doc'}}),ack=s.post(s.request());assert.equal(ack.status,'ok');assert.equal(ack.docs.status,'error');assert.equal(s.props.get('RENTAL_STATUS_DOCUMENT_ID'),'missing-doc');});
test('missing document property uses only the copied document ID and ignores document title',()=>{const s=server({existingDocument:false}),ack=s.post(s.request());assert.equal(ack.status,'ok');assert.equal(ack.docs.status,'ok');assert.equal(s.props.get('RENTAL_STATUS_DOCUMENT_ID'),'1YjTZPiRA2vnfAuWp1UTBci8F4yUNozQjYhE9QwMdtuQ');});
test('corrupt persisted data is never replaced and busy lock prevents writes',()=>{const s=server(),r=s.request();s.corrupt('{broken');assert.equal(s.post(r).status,'error');assert.equal(s.raw(),'{broken');const busy=server();busy.hold(true);assert.equal(busy.post(busy.request()).status,'busy');assert.equal(busy.writes(),0);});


test('calendar creation followed by mapping failure does not duplicate on retry',()=>{
 const s=server({raw:JSON.stringify({tenants:[{id:'t1',name:'검증용',unit:'201',contract:'2025.01.01 ~ 2027.01.01'}],bills:{}})});
 const req={protocol:'rental-sync-v2',action:'syncContractCalendar',requestId:crypto.randomUUID(),expectedRevision:s.get().revision};
 s.fail('calendar-map');assert.equal(s.post(req).calendar.status,'error');assert.equal(s.events().length,1);
 s.fail('');assert.equal(s.post(req).calendar.status,'ok');assert.equal(s.events().length,1);assert.equal(s.writes(),0);
});
test('server rejects negative and fractional bill amounts before any mutation',()=>{
 for(const amount of [-1,0.1,1e13]){const s=server(),before=s.raw();const ack=s.post(s.request({tenants:[],bills:{'2026-10':{t1:{rent:amount}}}}));
 assert.equal(ack.status,'error');assert.equal(s.raw(),before);assert.equal(s.writes(),0);assert.equal(s.backupRows.length,0);}
});

test('valid JSON from an interrupted mixed write is blocked by its journal',()=>{const s=server();s.props.set('INDEPENDENT_SYNC_WRITE_JOURNAL',JSON.stringify({before:'sha256-before',after:'sha256-after'}));assert.equal(s.get().status,'error');assert.equal(s.post({protocol:'rental-sync-v2',expectedRevision:'sha256-before',requestId:crypto.randomUUID(),data:{tenants:[],bills:{}}}).status,'error');assert.equal(s.writes(),0);});

test('backup read and hash failure prevent every active-sheet write',()=>{
 for(const fault of ['backup-read','backup-hash']){const s=server(),req=s.request({tenants:[],bills:{},extra:'x'.repeat(80000)}),before=s.raw();s.fail(fault);assert.equal(s.post(req).status,'error');assert.equal(s.raw(),before);assert.equal(s.writes(),0);}
});
test('partial and final chunk failures block corrupt state and retain verified recovery',()=>{
 for(const fault of ['partial-write','last-write']){const s=server({raw:JSON.stringify({tenants:[],bills:{},extra:'old'.repeat(30000)})}),req=s.request({tenants:[],bills:{},next:'new'.repeat(30000)}),before=s.raw();s.fail(fault);assert.equal(s.post(req).status,'error');assert.equal(s.get().status,'error');assert.equal(s.backupRows.map(r=>r[2]).join(''),before);s.fail('');const report=s.post({protocol:'rental-sync-v2',action:'inspectRecovery',expectedRevision:req.expectedRevision,requestId:crypto.randomUUID()});assert.equal(report.status,'ok');assert.equal(report.recovery.revision,req.expectedRevision);assert.equal(s.get().status,'error');}
});
test('remaining-row clear failure never acknowledges an incomplete replacement',()=>{
 const s=server({raw:JSON.stringify({tenants:[],bills:{},extra:'x'.repeat(78000)})}),req=s.request(),before=s.raw();s.fail('clear');assert.equal(s.post(req).status,'error');assert.equal(s.get().status,'error');assert.equal(s.backupRows.map(r=>r[2]).join(''),before);
});
test('recovery inspection rejects changed raw, wrong order and incomplete chunks',()=>{
 for(const damage of ['raw','order','count']){const s=server({raw:JSON.stringify({tenants:[],bills:{},text:'x'.repeat(78000)})});s.post(s.request());if(damage==='raw')s.backupRows[0][2]+='x';if(damage==='order')s.backupRows[0][4]=2;if(damage==='count')s.backupRows.pop();const before=s.raw();assert.equal(s.post({protocol:'rental-sync-v2',action:'inspectRecovery',expectedRevision:s.get().revision,requestId:crypto.randomUUID()}).status,'error');assert.equal(s.raw(),before);}
});
test('same and different tenant writes share revision protection with complete domain fidelity',()=>{
 const data={tenants:[{id:'t1',name:'익명',rent:'1,000',audit:[{changes:{deposit:{from:null,to:0}}}],waterHistory:[]},{id:'t2',name:'익명2'}],bills:{'2024-02':{orphan:{rent:0,water:null,history:[{from:'',to:null}],paid:{pay_rent:{paid:false,date:''}}}}},loans:[],expenses:{},renewalDone:{},settInputs:{},waterRatio:{r2:0,r3:1,r4:2},floorOperations:{5:{leaseStatus:'공실(정리중)'}},futureExtension:{missing:null,empty:'',zero:0}};
 for(const id of ['t1','t2']){const s=server({raw:JSON.stringify(data)}),a=s.request(structuredClone(data)),b=s.request(structuredClone(data));a.data.tenants[0].name='첫 수정';b.data.tenants.find(t=>t.id===id).name='나중 수정';assert.equal(s.post(a).status,'ok');assert.equal(s.post(b).status,'conflict');assert.deepEqual(s.get().data,a.data);}
});
test('Docs missing or duplicate markers stop without changing surrounding content',()=>{
 for(const documentTexts of [['메모','[RENTAL_CURRENT_STATUS_BEGIN]','내용'],['위','[RENTAL_CURRENT_STATUS_BEGIN]','[RENTAL_CURRENT_STATUS_BEGIN]','[RENTAL_CURRENT_STATUS_END]','아래']]){const s=server({documentTexts}),before=s.body.children.map(c=>c.getText()),ack=s.post(s.request());assert.equal(ack.status,'ok');assert.equal(ack.docs.status,'error');assert.deepEqual(s.body.children.map(c=>c.getText()),before);assert.equal(s.writes(),1);}
});
test('Calendar creation acknowledgement and ID lookup failure retry without duplication',()=>{
 for(const fault of ['calendar-after-create','calendar-id']){const s=server({raw:JSON.stringify({tenants:[{id:'t1',name:'익명',unit:'201호',contract:'2025/01/01 ~ 2027/01/01'}],bills:{}})}),req={protocol:'rental-sync-v2',action:'syncContractCalendar',expectedRevision:s.get().revision,requestId:crypto.randomUUID()};s.fail(fault);assert.equal(s.post(req).calendar.status,'error');assert.equal(s.events().length,1);s.fail('');assert.equal(s.post(req).calendar.status,'ok');assert.equal(s.events().length,1);}
});
test('Calendar mapping loss reidentifies marker events and deleted events are recreated once',()=>{
 const s=server({raw:JSON.stringify({tenants:[{id:'t1',name:'익명',unit:'201호',contract:'2025/01/01 ~ 2027/01/01'}],bills:{}})}),req=()=>({protocol:'rental-sync-v2',action:'syncContractCalendar',expectedRevision:s.get().revision,requestId:crypto.randomUUID()});s.post(req());const id=s.events()[0].id;s.props.delete('INDEPENDENT_CONTRACT_CALENDAR_EVENTS_V1');assert.equal(s.post(req()).calendar.updated,1);assert.equal(s.events()[0].id,id);s.dropEvent(id);assert.equal(s.post(req()).calendar.created,1);assert.equal(s.post(req()).calendar.updated,1);assert.equal(s.events().length,1);
});
test('legacy Calendar event without marker is reused after mapping loss',()=>{
 const s=server({raw:JSON.stringify({tenants:[{id:'t1',name:'익명',unit:'201호',contract:'2025/01/01 ~ 2027/01/01'}],bills:{}})}),req=()=>({protocol:'rental-sync-v2',action:'syncContractCalendar',expectedRevision:s.get().revision,requestId:crypto.randomUUID()});s.post(req());const id=s.events()[0].id;s.loseMarker();s.props.delete('INDEPENDENT_CONTRACT_CALENDAR_EVENTS_V1');assert.equal(s.post(req()).calendar.updated,1);assert.equal(s.events().length,1);assert.equal(s.events()[0].id,id);
});
test('wrong independent Calendar target never writes to personal or original calendars',()=>{
 const s=server({properties:{INDEPENDENT_CALENDAR_ID:'original-calendar'},raw:JSON.stringify({tenants:[{id:'t1',name:'익명',unit:'201호',contract:'2025/01/01 ~ 2027/01/01'}],bills:{}})});const result=s.post({protocol:'rental-sync-v2',action:'syncContractCalendar',expectedRevision:s.get().revision,requestId:crypto.randomUUID()});assert.equal(result.calendar.status,'error');assert.equal(s.events().length,0);assert.equal(s.writes(),0);
});

test('wrong tenant event mapping is blocked before modifying that event',()=>{
 const data={tenants:[{id:'t1',name:'익명1',unit:'201',contract:'2025/01/01 ~ 2027/01/01'},{id:'t2',name:'익명2',unit:'301',contract:'2025/01/01 ~ 2027/02/01'}],bills:{}};
 const s=server({raw:JSON.stringify(data)}),req=()=>({protocol:'rental-sync-v2',action:'syncContractCalendar',expectedRevision:s.get().revision,requestId:crypto.randomUUID()});s.post(req());const before=s.events();s.props.set('INDEPENDENT_CONTRACT_CALENDAR_EVENTS_V1',JSON.stringify({t1:before[1].id,t2:before[1].id}));assert.equal(s.post(req()).calendar.status,'error');assert.deepEqual(s.events(),before);assert.equal(s.writes(),0);
});
