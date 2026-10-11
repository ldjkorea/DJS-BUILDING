package kr.henry.rental.independent

import org.json.JSONObject

/** Anonymous instrumentation transport. This override is absent from release. */
internal object NativeOperationsTransport {
    @Volatile var testRequest: ((JSONObject) -> JSONObject)? = null
    fun request(body: JSONObject): JSONObject = testRequest?.invoke(body) ?: NativeApi.request(body)
}
