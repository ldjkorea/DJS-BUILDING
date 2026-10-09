async function navigate(page,tab){
 const button=page.locator('#nav-'+tab);
 if(!await button.isVisible())await page.locator('#nav-more').click();
 await button.click();await page.locator('#section-'+tab+'.active').waitFor();
}
module.exports={navigate};
