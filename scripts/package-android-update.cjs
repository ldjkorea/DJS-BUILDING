/* A self-contained APK transport for the existing GAS gateway. No credentials,
 * Drive sharing, or rental resources are needed by an update download. */
const fs=require('node:fs'),crypto=require('node:crypto'),vm=require('node:vm');
const CHUNK=524288,MAX_BYTES=16*1024*1024;
function packageRelease(bytes,version,versionCode,signerSha256){
  if(!Buffer.isBuffer(bytes)||bytes.length<4||bytes.length>MAX_BYTES||bytes[0]!==80||bytes[1]!==75)throw Error('APK byte bounds or ZIP header invalid');
  if(!/^\d+\.\d+\.\d+$/.test(version)||!Number.isSafeInteger(versionCode)||versionCode<1||! /^[a-f0-9]{64}$/.test(signerSha256))throw Error('Release metadata invalid');
  const base64=bytes.toString('base64'),chunks=[];
  for(let i=0;i<base64.length;i+=CHUNK)chunks.push(base64.slice(i,i+CHUNK));
  const manifest={protocol:'rental-apk-update-v1',packageName:'kr.henry.rental.independent',versionName:version,versionCode,size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),signerSha256,chunkCount:chunks.length,chunkEncodedSize:CHUNK};
  const source='/* Generated signed APK only. Rebuild with scripts/package-android-update.cjs. */\n'+
    'var ANDROID_UPDATE_RELEASE_='+JSON.stringify({manifest,chunks})+';\n'+
    `function androidUpdateResponse_(p) {
      var r=ANDROID_UPDATE_RELEASE_,m=r.manifest;
      if(p.action==='androidUpdateManifest')return {status:'ok',release:m};
      if(p.action!=='androidUpdateChunk'||String(p.version)!==String(m.versionCode)||p.sha256!==m.sha256||! /^(0|[1-9][0-9]*)$/.test(String(p.index)))return {status:'error',message:'배포 버전이 변경됐습니다. 업데이트를 다시 확인해주세요.'};
      var index=Number(p.index);
      if(index>=r.chunks.length)return {status:'error',message:'다운로드 범위를 확인해주세요.'};
      return {status:'ok',versionCode:m.versionCode,sha256:m.sha256,index:index,base64:r.chunks[index]};
    }\n`;
  new vm.Script(source);
  return {manifest,source};
}
module.exports={packageRelease,CHUNK,MAX_BYTES};
if(require.main===module){
  const [apk,version,code,signer,out]=process.argv.slice(2);
  if(!out)throw Error('Usage: apk version code signerSha256 output.gs');
  const release=packageRelease(fs.readFileSync(apk),version,Number(code),signer);
  fs.writeFileSync(out,release.source);fs.writeFileSync(out+'.manifest.json',JSON.stringify(release.manifest,null,2)+'\n');
  console.log(JSON.stringify(release.manifest));
}
