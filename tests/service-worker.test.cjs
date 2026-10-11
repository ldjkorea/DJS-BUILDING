const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('a retired worker fetch cannot recreate its deleted release cache or cache cloud data',async()=>{
 const events={},opened=[],matches=[],network=[];let response;
 const scope={URL,Response,self:{registration:{scope:'https://example.test/rental-app/'},addEventListener:(k,fn)=>events[k]=fn},caches:{open:async name=>{opened.push(name);throw Error('Retired cache reopened');},match:async(req,options)=>{matches.push(options);return undefined;}},fetch:async req=>{network.push(req.url);return new Response('network');}};
 vm.createContext(scope);vm.runInContext(fs.readFileSync('sw.js','utf8'),scope);
 events.fetch({request:{method:'GET',url:'https://example.test/rental-app/index.html?demo=1'},respondWith:r=>response=r});assert.equal(await (await response).text(),'network');assert.equal(opened.length,0);assert.equal(matches.length,1);assert.equal(matches[0].ignoreSearch,true);assert.equal(matches[0].cacheName,'rental-independent-20261009-%2Frental-app%2F-'+JSON.parse(fs.readFileSync('package.json')).version);
 response=null;events.fetch({request:{method:'POST',url:'https://script.google.com/macros/exec'},respondWith:r=>response=r});assert.equal(response,null);assert.equal(network.length,1);
});
