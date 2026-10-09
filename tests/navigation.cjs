async function navigate(page,tab){
 const button=page.locator('#nav-'+tab);
 if(!await button.isVisible())await page.locator('#nav-more').click();
 await button.click();await page.locator('#section-'+tab+'.active').waitFor();
}
async function applyReplacement(page){
 await page.locator('#modal-data-replacement.open').waitFor();
 await page.getByRole('button',{name:'이 백업으로 복원',exact:true}).click();
 await page.locator('#modal-data-replacement.open').waitFor({state:'hidden'});
}
async function restoreRecovery(page){
 await page.evaluate(()=>{void restoreRecovery();});
 await applyReplacement(page);
}
module.exports={navigate,applyReplacement,restoreRecovery};
