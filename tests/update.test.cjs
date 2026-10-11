const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('release metadata requires no Google data services and matches the web and Android versions',()=>{
  const context={};vm.createContext(context);vm.runInContext(fs.readFileSync('server/IndependentApp.gs','utf8'),context);
  const info=JSON.parse(JSON.stringify(context.getAppUpdateInfo()));
  assert.equal(info.appVersion,JSON.parse(fs.readFileSync('package.json')).version);
  assert.equal(info.androidVersion,'4.1.0');assert.equal(info.androidVersionCode,5);
  assert.equal(info.androidReleaseUrl,'https://github.com/ldjkorea/NEW-RENT-STORE/releases/latest');
  const gradle=fs.readFileSync('android/app/build.gradle.kts','utf8');
  assert.ok(gradle.includes('versionName = "'+info.androidVersion+'"'));assert.ok(gradle.includes('versionCode = '+info.androidVersionCode));
});
