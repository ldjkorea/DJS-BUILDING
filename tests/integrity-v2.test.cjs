const {test}=require('node:test');
const assert=require('node:assert/strict');
const core=require('../assets/core.js'),billing=require('../assets/billing.js');

test('unknown historical root fields survive backup and local round trip without metadata pollution',()=>{
  const data={...core.empty(),historicalExtension:{audit:[{from:null,to:0}],note:''}};
  const parsed=core.validateData({...data,exportedAt:'2026-10-10',localMeta:{cloudPending:true},localDrafts:{x:{}}});
  assert.deepEqual(parsed,data);
  assert.deepEqual(core.validateData(core.envelope(data)),data);
});
test('invalid management amounts are rejected rather than silently becoming zero',()=>{
  for(const amount of [-1,'broken',0.2]){
    const data={...core.empty(),tenants:[{id:'t1',name:'검증',unit:'201',mgmtItems:[{key:'m1',amount}]}]};
    assert.throws(()=>core.validateData(data));assert.equal(data.tenants[0].mgmtItems[0].amount,amount);
  }
});
test('comma numeric strings calculate correctly without altering stored values',()=>{
  const tenant={id:'t1',name:'검증',unit:'201',rent:'1,000,000',mgmt:'100,000',elevator:'0'};
  const source={...core.empty(),tenants:[tenant],bills:{'2026-10':{t1:{rent:'1,000,000',water:'10,000',electricity:'30,000'}}}};
  const validated=core.validateData(source);
  assert.equal(billing.charges(tenant,source.bills['2026-10'].t1).pay_rent,1100000);
  assert.equal(billing.charges(tenant,source.bills['2026-10'].t1).pay_water,10000);
  assert.equal(validated.tenants[0].rent,'1,000,000');
});
