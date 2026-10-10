/* Read-only review queue. Private source data never reaches stdout or Git. */
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {decodeSnapshot,reconcileSnapshot}=require('./reconcile-data.cjs'),billing=require('../assets/billing.js');
const root=path.resolve(__dirname,'..'),hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function prepare(snapshot,asOf){
  const data=decodeSnapshot(snapshot),result=reconcileSnapshot(snapshot,billing,billing,asOf);
  const entries=result.basisReview.map(row=>{
    const index=result.invoiceIndex.find(item=>item.token===row.invoice),bill=data.bills[index.month][index.id];
    return {...row,month:index.month,tenantId:index.id,storedBillSha256:hash(JSON.stringify(bill)),status:'needs_source',sourceEvidence:[],checkedFields:[],reviewNote:''};
  });
  return {format:'rental-basis-review-v1',asOf,sourceDomainSha256:hash(JSON.stringify(data)),entries,summary:{savedInvoices:result.billCount,reviewInvoices:entries.length,estimatedInvoices:result.basis.estimatedInvoices,missingSnapshotInvoices:result.basis.missingSnapshotInvoices,confirmedInvoices:0,sourcePreserved:true,googleWritesPerformed:false},scope:'Review preparation only. A matching calculation is not evidence of the original issued amount. This queue never changes snapshots, estimated markers or receipt ledgers.'};
}
function writeQueue(input,asOf,directory){
  const output=path.resolve(directory),privateRoot=path.join(root,'.private');
  assert.ok(output.startsWith(privateRoot+path.sep),'Review output must stay under this repository .private directory');
  assert.ok(!fs.existsSync(output),'Existing review output must be preserved');
  // Check the real parent before creating output, including Windows junctions.
  const parent=fs.realpathSync(path.dirname(output)),actualPrivate=fs.realpathSync(privateRoot);
  assert.ok(parent===actualPrivate||parent.startsWith(actualPrivate+path.sep),'Review output parent resolves outside .private');
  const bytes=fs.readFileSync(input),queue=prepare(JSON.parse(bytes),asOf);
  assert.deepEqual(fs.readFileSync(input),bytes,'Source input changed during preparation');
  fs.mkdirSync(output);
  fs.writeFileSync(path.join(output,'queue.json'),JSON.stringify({...queue,inputSha256:hash(bytes),preparedAt:new Date().toISOString()},null,2)+'\n',{flag:'wx'});
  const lines=['# 과거 고지서 원자료 대조 목록','','계산이 일치해도 원래 발행 금액을 입증하지 않습니다. 원래 고지서 또는 계약 원문을 확인하기 전에는 추정 표시를 유지합니다. 이 목록은 앱이나 Google 자료에 쓰지 않습니다.','','입력 SHA-256: `'+hash(bytes)+'`','','| 검토 번호 | 고지서 월 | 추정 필드 | 누락 필드 | 상태 |','|---|---|---|---|---|',...queue.entries.map(row=>'| '+row.invoice+' | '+row.month+' | '+row.estimatedFields.join(', ')+' | '+row.missingFields.join(', ')+' | 원자료 필요 |'),'','각 건의 원자료 위치·발행일·페이지/항목·실제 확인 값·검토 사유는 queue.json에 기록합니다. 값이 다르면 앱의 기존 청구 기준 정정 화면에서 전후 금액과 원문을 별도로 확인합니다. 이 파일을 채워도 자동으로 확정되거나 운영 자료에 반영되지 않습니다.',''];
  fs.writeFileSync(path.join(output,'README.md'),lines.join('\n'),{flag:'wx'});
  return queue.summary;
}
if(require.main===module){try{assert.equal(process.argv.length,5,'Usage: node scripts/prepare-basis-review.cjs INPUT AS_OF PRIVATE_DIRECTORY');console.log(JSON.stringify(writeQueue(...process.argv.slice(2))));}catch{console.error('Review preparation failed. Verify input, explicit date and a new directory under .private. Source data was not written.');process.exitCode=1;}}
module.exports={prepare,writeQueue};
