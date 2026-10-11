package kr.henry.rental.independent

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** No web renderer. JSON only, pinned HTTPS hosts, bounded responses, no retries. */
object NativeApi {
    fun request(body: JSONObject?): JSONObject = exchange(body, "")
    fun updateManifest(): JSONObject = exchange(null, "?action=androidUpdateManifest")
    fun updateChunk(version: Int, hash: String, index: Int): JSONObject {
        require(version > 0 && hash.matches(Regex("[a-f0-9]{64}")) && index in 0..63)
        return exchange(null, "?action=androidUpdateChunk&version=$version&sha256=$hash&index=$index")
    }
    private fun exchange(body: JSONObject?, query: String): JSONObject {
        var next = URL(AppDestination.NATIVE_API + query)
        var post = body != null
        repeat(5) {
            require(next.protocol == "https" && next.host in setOf("script.google.com", "script.googleusercontent.com")) { "연결 주소를 확인해주세요." }
            val connection = next.openConnection() as HttpURLConnection
            try {
                connection.instanceFollowRedirects = false
                connection.connectTimeout = 20000; connection.readTimeout = 60000
                connection.setRequestProperty("Accept", "application/json")
                if (post) {
                    connection.requestMethod = "POST"; connection.doOutput = true
                    connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                    connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
                }
                val status = connection.responseCode
                if (status in listOf(301, 302, 303)) {
                    val location = connection.getHeaderField("Location") ?: error("연결 응답을 확인해주세요.")
                    next = URL(next, location); post = false
                } else {
                    require(status == 200) { "서버에 연결하지 못했습니다. ($status)" }
                    val output = java.io.ByteArrayOutputStream()
                    connection.inputStream.use { input ->
                        val buffer = ByteArray(8192)
                        while (true) {
                            val count = input.read(buffer); if (count < 0) break
                            require(output.size() + count <= 5000000) { "자료 크기를 확인해주세요." }
                            output.write(buffer, 0, count)
                        }
                    }
                    val raw = output.toString("UTF-8")
                    require(raw.trimStart().startsWith("{")) { "Google 연결이 준비되지 않았습니다. 기기 연결을 확인해주세요." }
                    return JSONObject(raw)
                }
            } finally { connection.disconnect() }
        }
        error("서버 연결이 지연되고 있습니다.")
    }
}
