package kr.henry.rental.independent

import android.os.SystemClock
import org.json.JSONObject
import java.security.MessageDigest
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.ExecutionException
import java.util.concurrent.FutureTask

/** Only server-confirmed reads are reusable, briefly and within this process.
 * Disk snapshots alone never grant permission to save. No write retries. */
class SnapshotReader(
    private val clock: () -> Long = { SystemClock.elapsedRealtime() },
    private val today: () -> String = { SimpleDateFormat("yyyy-MM-dd", Locale.KOREA).apply {
        timeZone = TimeZone.getTimeZone("Asia/Seoul")
    }.format(Date()) },
    private val transport: (JSONObject) -> JSONObject = NativeOperationsTransport::request
) {
    private data class Stamp(val digest: String, val checked: Long)
    private val stamps = LinkedHashMap<String, Stamp>()
    private val flights = mutableMapOf<String, FutureTask<JSONObject>>()
    private var generation = 0L
    private fun hash(text: String) = MessageDigest.getInstance("SHA-256")
        .digest(text.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
    private fun key(token: String, month: String) = hash(token) + ":" + month
    fun validate(value: JSONObject, month: String) {
        require(value.optString("status") == "ok" && value.optString("protocol") == "rental-native-v1" &&
            value.optString("revision").matches(Regex("sha256-[a-f0-9]{64}")) &&
            value.optString("month") == month && value.optString("today").matches(Regex("\\d{4}-\\d{2}-\\d{2}")) &&
            value.optJSONObject("summary") != null && value.optJSONArray("tenants") != null &&
            value.optJSONArray("bills") != null) { "서버 자료를 확인하지 못했습니다. 새로고침해주세요." }
    }
    @Synchronized fun invalidate() { generation++; stamps.clear() }
    @Synchronized fun remember(token: String, value: JSONObject) {
        validate(value, value.getString("month"))
        stamps[key(token, value.getString("month"))] = Stamp(hash(value.toString()), clock())
        while (stamps.size > 3) stamps.remove(stamps.keys.first())
    }
    @Synchronized fun fresh(state: JSONObject, month: String): Boolean {
        if (state.optBoolean("pending")) return false
        val value = state.optJSONObject("snapshot") ?: return false
        val stamp = stamps[key(state.optString("token"), month)] ?: return false
        val age = clock() - stamp.checked
        return age in 0 until 30_000 && value.optString("month") == month &&
            value.optString("today") == today() && stamp.digest == hash(value.toString())
    }
    fun afterSave(ack: JSONObject, state: JSONObject, month: String): JSONObject {
        require(ack.optString("status") == "ok") { "저장 결과를 먼저 확인해주세요." }
        try {
            val value = ack.optJSONObject("latest") ?: load(state, month, true)
            if (value.optString("status") == "unauthorized") return value
            validate(value, month)
            return value
        } catch (e: Exception) {
            invalidate()
            throw IllegalStateException("저장 요청은 처리됐지만 최신 자료 확인이 지연되고 있습니다. 새로고침으로 결과를 확인해주세요. 저장 요청을 다시 보내지 않습니다.", e)
        }
    }
    fun load(state: JSONObject, month: String, force: Boolean): JSONObject {
        val token = state.getString("token")
        require(token.isNotEmpty()) { "홈에서 Google 기기를 연결해주세요." }
        val cached = state.optJSONObject("snapshot")?.let { JSONObject(it.toString()) }
        val id: String
        val task: FutureTask<JSONObject>
        val owner: Boolean
        synchronized(this) {
            if (!force && fresh(state, month)) return JSONObject(cached!!.toString())
            id = key(token, month) + ":" + generation
            val existing = flights[id]
            owner = existing == null
            val started = generation
            task = existing ?: FutureTask {
                val req = JSONObject().put("action", "read").put("token", token).put("month", month)
                    .put("requireReceiptVoid", true).put("knownReceiptVoid", cached?.optJSONObject("capabilities")?.optBoolean("receiptVoid") == true)
                val usable = cached != null && runCatching { validate(cached, month) }.isSuccess
                if (usable) req.put("knownRevision", cached!!.getString("revision")).put("knownToday", cached.getString("today"))
                val response = transport(req)
                if (response.optString("status") != "ok") { invalidate(); return@FutureTask response }
                val value = if (response.optBoolean("unchanged")) {
                    require(usable && response.optString("protocol") == "rental-native-v1" &&
                        response.optString("revision") == cached!!.optString("revision") &&
                        response.optString("today") == cached.optString("today") &&
                        response.optString("month") == month) { "자료 확인 응답이 일치하지 않습니다. 새로고침해주세요." }
                    cached!!
                } else response
                validate(value, month)
                synchronized(this) {
                    require(started == generation) { "자료가 변경됐습니다. 새로고침한 뒤 다시 확인해주세요." }
                    remember(token, value)
                }
                value
            }.also { flights[id] = it }
        }
        if (owner) task.run()
        try { return JSONObject(task.get().toString()) }
        catch (e: ExecutionException) { invalidate(); throw (e.cause ?: e) }
        finally { synchronized(this) { if (flights[id] === task && task.isDone) flights.remove(id) } }
    }
}

object NativeSnapshots {
    val reader = SnapshotReader()
}
