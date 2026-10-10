/* Fail early on missing tools/history; never authenticates to Google or GitHub. */
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
function check(){
  const playwright=require('playwright');
  const edge=process.env.RENTAL_BROWSER||['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe','C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(file=>fs.existsSync(file));
  if(!edge||!fs.statSync(edge).isFile())throw Error('The browser executable required by the regression suites is missing.');
  execFileSync(process.env.RENTAL_PWSH||'pwsh',['-NoProfile','-NonInteractive','-Command','$PSVersionTable.PSVersion.Major'],{stdio:'pipe',windowsHide:true});
  const references=['a937698',JSON.parse(fs.readFileSync(path.join(root,'releases/development-bill-basis-2.1.3.json'))).sourceCommit];
  for(const ref of references)execFileSync('git',['cat-file','-e',ref+':assets/billing.js'],{cwd:root,stdio:'pipe',windowsHide:true});
  if(!playwright.chromium?.launch)throw Error('Playwright Chromium API is unavailable.');
  return {node:process.version,playwright:require('playwright/package.json').version,browser:path.basename(edge),historicalReferences:references.length,googleCallsPerformed:false};
}
if(require.main===module){try{console.log(JSON.stringify(check()));}catch(error){console.error(error.message);process.exitCode=1;}}
module.exports={check};
