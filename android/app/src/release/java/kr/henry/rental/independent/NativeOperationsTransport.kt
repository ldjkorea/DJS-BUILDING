package kr.henry.rental.independent

import org.json.JSONObject

/** Release operations use only the existing authenticated, pinned gateway. */
internal object NativeOperationsTransport {
    fun request(body: JSONObject): JSONObject = NativeApi.request(body)
}
