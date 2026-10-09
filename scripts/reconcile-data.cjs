/* Read-only financial comparison. Detailed reports stay in .private; no cloud calls. */
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const core=require('../assets/core.js'),billing=require('../assets/billing.js');
const root=path.resolve(__dirname,'..'),clone=value=>JSON.parse(JSON.stringify(value));
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function decodeSnapshot(value){
 if(object(value)&&Object.hasOwn(value,'values')){
  assert.ok(Array.isArray(value.values)&&value.values.length>0,'Empty spreadsheet snapshot');
  const chunks=value.values.map(row=>{assert.ok(Array.isArray(row)&&row.length<=1,'Expected one JSON column');assert.ok(row.length===0||typeof row[0]==='string','JSON chunks must be strings');return row[0]||'';});
  value=JSON.parse(chunks.join(''));
 }
 if(object(value)&&value.format==='rental-sync-storage-v2'){assert.ok(object(value.data),'Missing stored domain data');return clone(value.data);}
 assert.ok(object(value)&&Array.isArray(value.tenants)&&object(value.bills),'Unsupported snapshot format');return clone(value);
}
function changes(before,after,pointer=''){
 if(JSON.stringify(before)===JSON.stringify(after))return [];
 if(object(before)&&object(after)||Array.isArray(before)&&Array.isArray(after)){
  return [...new Set([...Object.keys(before),...Object.keys(after)])].flatMap(key=>changes(before[key],after[key],pointer+'/'+key.replaceAll('~','~0').replaceAll('/','~1')));
 }
 return [{path:pointer,changeType:before===undefined?'added':after===undefined?'removed':'changed',beforeHash:before===undefined?null:hash(JSON.stringify(before)),afterHash:after===undefined?null:hash(JSON.stringify(after))}];
}
function rulesFromSource(source){
 const context=vm.createContext({});new vm.Script(source,{filename:'trusted-billing.js'}).runInContext(context,{timeout:5000});
 assert.ok(context.RentalBilling?.historicalPayment&&context.RentalBilling?.collectionStatus,'Missing billing comparison API');return context.RentalBilling;
}
function project(rules,tenant,bill,month,asOf){
 const state=rules.historicalPayment(clone(tenant),clone(bill),Number(month.slice(0,4)),Number(month.slice(5)),asOf),items={};
 for(const key of billing.itemKeys){const item=state.items[key];assert.ok(item,'Missing payment item');const received=item.received??(item.paid?item.amount:0);
  items[key]={amount:item.amount,received,unpaid:item.unpaid??(item.na?0:item.amount-received),paid:item.paid,na:item.na,date:item.date||'',status:item.status,dueDate:item.dueDate||''};
 }
 const totals=Object.fromEntries(['total','received','unpaid','exempt','overdue','notDue','unknownDue','complete'].map(key=>[key,state[key]]));return {items,totals};
}
function tenantFor(data,id,bill){return data.tenants.find(row=>row.id===id)||{id,name:'Unregistered',unit:bill.unitSnapshot||'',rent:0,mgmt:0,elevator:0};}
function neighbor(date,offset){const [y,m,d]=date.split('-').map(Number),value=new Date(Date.UTC(y,m-1,d+offset)).toISOString().slice(0,10);return /^\d{4}/.test(value)&&value>='1900-01-01'&&value<='2200-12-31'?value:null;}
function cutoffs(data,asOf){
 assert.equal(billing.dateISO(asOf),asOf,'Explicit YYYY-MM-DD comparison date required');const result=new Set([asOf]);
 for(const [month,rows] of Object.entries(data.bills))for(const [id,bill] of Object.entries(rows)){
  if(!Object.keys(bill).length)continue;const tenant=tenantFor(data,id,bill),effective=billing.effectiveTenant(tenant,bill),year=Number(month.slice(0,4));
  const dates=[...billing.itemKeys.map(key=>billing.dueDate(effective,key,year,Number(month.slice(5)))),bill.stampedRentDate,bill.stampedMgmtDate,...Object.values(bill.paid||{}).map(item=>item.date),...(bill.receiptLedger?.events||[]).flatMap(event=>[event.receivedOn,event.recordedAt?.slice(0,10)])].filter(Boolean).map(date=>billing.dateISO(date,year)).filter(Boolean);
  for(const date of dates)for(const offset of [-1,0,1]){const cutoff=neighbor(date,offset);if(cutoff)result.add(cutoff);}
 }
 return [...result].sort();
}
function reconcileSnapshot(snapshot,baseline,current=billing,asOf,mirror){
 const original=JSON.stringify(snapshot),data=decodeSnapshot(snapshot),raw=JSON.stringify(data),validated=core.validateData(data);
 if(core.hasReceiptLedgers(data)&&baseline.RECEIPT_FORMAT!==billing.RECEIPT_FORMAT)throw Error('Baseline cannot compare receipt ledgers; use a ledger-compatible baseline.');
 const dates=cutoffs(data,asOf),differences=[],validationChanges=changes(data,validated),billRows=[],basisReview=[];
 for(const month of Object.keys(data.bills).sort())for(const id of Object.keys(data.bills[month]).sort()){
  const bill=data.bills[month][id];if(!Object.keys(bill).length)continue;const token='invoice-'+String(billRows.length+1).padStart(4,'0'),tenant=tenantFor(data,id,bill);
  billRows.push({token,month,id});
  const missingFields=['rent','mgmt','unitSnapshot','paydaySnapshot','tenantSnapshot','monthSnapshot'].filter(key=>bill[key]==null),estimatedFields=[...(bill.snapshotEstimated||[])];if(bill.elevator==null&&bill.elevatorTotal==null)missingFields.push('elevator/elevatorTotal');
  if(missingFields.length||estimatedFields.length)basisReview.push({invoice:token,missingFields,estimatedFields});
  for(const cutoff of dates){const previous=project(baseline,tenant,bill,month,cutoff),next=project(current,tenant,bill,month,cutoff),normalized=project(current,tenantFor(validated,id,validated.bills[month][id]),validated.bills[month][id],month,cutoff);
   const comparisons=[['baseline',previous,next],['validation',next,normalized]];if(mirror)comparisons.push(['gas',next,project(mirror,tenant,bill,month,cutoff)]);
   for(const [kind,before,after] of comparisons)for(const delta of changes(before,after))differences.push({invoice:token,asOf:cutoff,kind,...delta});
  }
 }
 const aggregateDifferences=[],quarters=[...new Set(billRows.map(row=>row.month.slice(0,4)+'-'+Math.ceil(Number(row.month.slice(5))/3)))];let quarterComparisons=0;
 for(const cutoff of dates){
  const prior=baseline.arrears(clone(data.tenants),clone(data.bills),cutoff),next=current.arrears(clone(data.tenants),clone(data.bills),cutoff);
  for(const key of ['total','tenantCount','monthCount'])if(prior[key]!==next[key])aggregateDifferences.push({kind:'arrears',asOf:cutoff,field:key});
  for(const [index,tenant] of data.tenants.entries())for(const delta of changes(baseline.collectionStatus(clone(tenant),clone(data.bills),cutoff),current.collectionStatus(clone(tenant),clone(data.bills),cutoff)))aggregateDifferences.push({kind:'collection',tenant:'tenant-'+String(index+1).padStart(4,'0'),asOf:cutoff,...delta});
  for(const key of quarters){
   const [year,quarter]=key.split('-').map(Number),statement=current.quarterlyStatement(clone(data.tenants),clone(data.bills),year,quarter,cutoff),expected={gross:0,received:0,unpaid:0,overdue:0,notDue:0,unknownDue:0,billCount:0,invoiceCount:0};
   for(const row of billRows.filter(row=>statement.months.includes(row.month))){const bill=data.bills[row.month][row.id],state=project(current,tenantFor(data,row.id,bill),bill,row.month,cutoff).totals;
    expected.gross+=state.total;for(const field of ['received','unpaid','overdue','notDue','unknownDue'])expected[field]+=state[field];expected.billCount++;if(bill.invoiceIssued===true)expected.invoiceCount++;
   }
   for(const field of Object.keys(expected))if(expected[field]!==statement.totals[field])aggregateDifferences.push({kind:'quarter',asOf:cutoff,quarter:key,field});
   quarterComparisons++;
  }
 }
 assert.equal(JSON.stringify(snapshot),original,'Input snapshot mutated');assert.equal(JSON.stringify(data),raw,'Domain source mutated');
 const normalizationFinancialDifferences=differences.filter(row=>row.kind==='validation').length;
 return {asOf,dates,billCount:billRows.length,monthCount:Object.keys(data.bills).length,tenantCount:data.tenants.length,invoiceIndex:billRows,invoiceDateComparisons:billRows.length*dates.length,itemComparisons:billRows.length*dates.length*billing.itemKeys.length,quarterComparisons,gasCompared:!!mirror,validationChanges,differences,aggregateDifferences,basisReview,
  basis:{estimatedInvoices:basisReview.filter(row=>row.estimatedFields.length).length,missingSnapshotInvoices:basisReview.filter(row=>row.missingFields.length).length,receiptLedgerInvoices:billRows.filter(row=>Object.hasOwn(data.bills[row.month][row.id],'receiptLedger')).length},
  summary:{sourcePreserved:true,normalizationChanges:validationChanges.length,normalizationFinancialDifferences,baselineFinancialDifferences:differences.filter(row=>row.kind==='baseline').length,gasFinancialDifferences:differences.filter(row=>row.kind==='gas').length,aggregateDifferences:aggregateDifferences.length,basisReviewInvoices:basisReview.length,comparisonPassed:differences.length===0&&aggregateDifferences.length===0,reviewRequired:basisReview.length>0||validationChanges.length>0||differences.length>0||aggregateDifferences.length>0},
  scope:'In-memory core validation and billing comparison only; no UI initialization, migration, write, deployment or production readiness proof'};
}
function main(argv){
 assert.equal(argv.length,4,'Usage: node scripts/reconcile-data.cjs INPUT AS_OF BASELINE_REF PRIVATE_REPORT');
 const [input,asOf,ref,report]=argv,output=path.resolve(report),privateRoot=path.join(root,'.private')+path.sep;
 assert.ok(output.startsWith(privateRoot),'Detailed report must stay under this repository .private directory');assert.ok(!fs.existsSync(output),'Existing report must be preserved');
 assert.match(ref,/^[a-zA-Z0-9._/-]+$/,'Invalid Git reference');const baselineCommit=execFileSync('git',['rev-parse','--verify',ref+'^{commit}'],{cwd:root,encoding:'utf8'}).trim();
 const baselineSource=execFileSync('git',['show',baselineCommit+':assets/billing.js'],{cwd:root,encoding:'utf8',maxBuffer:10000000}),gasSource=fs.readFileSync(path.join(root,'server/Billing.gs'),'utf8'),bytes=fs.readFileSync(input),result=reconcileSnapshot(JSON.parse(bytes),rulesFromSource(baselineSource),billing,asOf,rulesFromSource(gasSource));
 assert.equal(hash(fs.readFileSync(input)),hash(bytes),'Input file changed during comparison');
 fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify({recordedAt:new Date().toISOString(),inputSha256:hash(bytes),baselineCommit,baselineBillingSha256:hash(baselineSource),candidateBillingSha256:hash(fs.readFileSync(path.join(root,'assets/billing.js'))),candidateGasBillingSha256:hash(gasSource),...result},null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({billCount:result.billCount,monthCount:result.monthCount,dateCount:result.dates.length,itemComparisons:result.itemComparisons,quarterComparisons:result.quarterComparisons,gasCompared:result.gasCompared,...result.summary}));return result.summary.reviewRequired?2:0;
}
if(require.main===module){try{process.exitCode=main(process.argv.slice(2));}catch{console.error('Comparison failed. This command never writes input files. Check arguments, format, trusted baseline and private report path.');process.exitCode=1;}}
module.exports={decodeSnapshot,changes,rulesFromSource,project,cutoffs,reconcileSnapshot,main};
