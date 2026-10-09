/* Preserved original authorization helper, limited to the copied document. */
function authorizeCurrentStatusDocumentAccess() {
  var doc=statusDocument_(PropertiesService.getScriptProperties());
  return {status:'ok',documentId:doc.getId(),name:doc.getName()};
}
