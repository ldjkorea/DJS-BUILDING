/* Local QA only. Restore the exact Gradle source even if a build fails.
 * Existing private signing configuration is used, never read or printed here.
 * Run before instrumentation after increasing the installed version code. */
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),grade=path.join(root,'android/app/build.gradle.kts'),original=fs.readFileSync(grade),text=original.toString('utf8');
const code=Number(text.match(/versionCode = (\d+)/)?.[1]),name=text.match(/versionName = "([^"]+)"/)?.[1];
assert.ok(Number.isSafeInteger(code)&&code>0&&name,'Existing version is required');
assert.match(name,/^\d+\.\d+\.\d+$/);const parts=name.split('.').map(Number),nextName=[parts[0],parts[1],parts[2]+1].join('.');
execFileSync('git',['diff','--exit-code','--','android/app/build.gradle.kts'],{cwd:root,stdio:'pipe'});
const directory=path.join(root,'.private/android-update-fixture'),fixture=path.join(root,'android/app/src/androidTest/assets/update-fixtures/valid-next.apk');fs.mkdirSync(directory,{recursive:true});
fs.writeFileSync(path.join(directory,'build.gradle.original.kts'),original);
function build(tasks,label){
 try{const output=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command','& ./android/gradlew.bat -p android '+tasks+' --console=plain; exit $LASTEXITCODE'],{cwd:root,windowsHide:true,maxBuffer:10000000});fs.writeFileSync(path.join(directory,label+'.log'),output);}
 catch(error){fs.writeFileSync(path.join(directory,label+'.log'),Buffer.concat([error.stdout||Buffer.alloc(0),error.stderr||Buffer.alloc(0)]));throw Error('Fixture build failed; inspect private '+label+'.log');}
}
try{
 fs.writeFileSync(grade,text.replace('versionCode = '+code,'versionCode = '+(code+1)).replace('versionName = "'+name+'"','versionName = "'+nextName+'"'));
 build(':app:assembleRelease','future');fs.mkdirSync(path.dirname(fixture),{recursive:true});fs.copyFileSync(path.join(root,'android/app/build/outputs/apk/release/app-release.apk'),fixture);
}finally{fs.writeFileSync(grade,original);}
build(':app:assembleRelease :app:assembleDebugAndroidTest','restored');
assert.deepEqual(fs.readFileSync(grade),original,'Gradle source must be restored exactly');
console.log('Signed QA fixture code '+(code+1)+' prepared. Product remains '+name+' / '+code+'. No deployment or installation performed.');
