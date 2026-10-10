/* Called through google.script.run inside the owner-only web app. */
function independentRequest(request) {
  if (!request || ['GET','POST'].indexOf(request.method) < 0) throw new Error('지원하지 않는 요청입니다.');
  var output = request.method === 'POST'
    ? doPost({postData:{contents:String(request.body || '')}})
    : doGet({parameter:{api:'1',receiptLedgerProtocol:request.receiptLedgerProtocol,operationsHistoryProtocol:request.operationsHistoryProtocol}});
  // Apps Script's object transport can omit null properties in nested objects.
  // Keep the complete JSON, including historical audit values, as a string.
  return output.getContent();
}

/* Run once in this copied project's editor to grant Google permissions. */
function initializeIndependentApp() {
  return locked_(function() {
    var target=source_(), state=read_(target.sheet);
    var props=PropertiesService.getScriptProperties();
    var document=statusDocument_(props);
    var calendar=contractCalendarTarget_();
    return {status:'ok',spreadsheetId:target.book.getId(),documentId:document.getId(),
      calendarId:calendar.getId(),revision:state.revision,tenants:state.data.tenants.length};
  });
}
