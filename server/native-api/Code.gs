/* JSON-only gateway. The owner-only web app remains a separate deployment.
 * Authentication, Script Properties, locks and billing execute in its library. */
function doGet() {
  return ContentService.createTextOutput(JSON.stringify(RentalBackend.getAppUpdateInfo()))
    .setMimeType(ContentService.MimeType.JSON);
}
function doPost(e) {
  var result;
  try {
    var raw = e && e.postData && e.postData.contents || '';
    if (!raw || raw.length > 2000000) throw new Error('요청 형식을 확인해주세요.');
    result = RentalBackend.nativeAppRequest(raw);
  } catch (ignored) {
    result = JSON.stringify({status:'error',message:'연결 요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.'});
  }
  return ContentService.createTextOutput(result).setMimeType(ContentService.MimeType.JSON);
}
