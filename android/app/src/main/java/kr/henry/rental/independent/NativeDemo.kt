package kr.henry.rental.independent

import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/** Clearly marked synthetic preview. It has no token and cannot save. */
object NativeDemo {
    fun snapshot(month: String): JSONObject {
        val today = SimpleDateFormat("yyyy-MM-dd", Locale.KOREA).format(Date())
        val tenants = JSONArray()
        val bills = JSONArray()
        val names = listOf("스튜디오 여백", "모던 오피스", "작은 연구실")
        names.forEachIndexed { index, name ->
            val paid = index == 0
            val collection = JSONObject().put("status", if (paid) "정상" else "월차임 연체").put("totalOverdue", if (paid) 0 else 1100000)
            tenants.put(JSONObject().put("id", "demo-$index").put("name", "예시 임차인 ${index + 1}").put("biz", name).put("unit", "${index + 2}01호")
                .put("leaseStatus", "임대중").put("contract", "2025.11.01 ~ 2026.10.31").put("deposit", 20000000).put("rent", 1000000).put("mgmt", 100000)
                .put("collection", collection).put("deadline", JSONObject().put("days", 21).put("endDate", "2026-10-31").put("label", "D-21")).put("audit", JSONArray()))
            val items = JSONObject()
            for ((key, amount) in listOf("pay_rent" to 1100000, "pay_mgmt" to 110000, "pay_elec" to 38500, "pay_water" to 10000)) {
                val received = if (paid) amount else 0
                items.put(key, JSONObject().put("amount", amount).put("received", received).put("unpaid", amount - received).put("paid", paid).put("na", false).put("date", if (paid) "$month-05" else ""))
            }
            fun group(amount: Int) = JSONObject().put("total", amount).put("received", if (paid) amount else 0).put("unpaid", if (paid) 0 else amount).put("complete", paid)
            bills.put(JSONObject().put("tenantId", "demo-$index").put("name", name).put("unit", "${index + 2}01호").put("total", 1258500)
                .put("received", if (paid) 1258500 else 0).put("unpaid", if (paid) 0 else 1258500).put("items", items)
                .put("groups", JSONObject().put("rent", group(1100000)).put("mgmt", group(158500))).put("ledger", false).put("audit", JSONArray()))
        }
        return JSONObject().put("status", "ok").put("today", today).put("month", month).put("months", JSONArray().put(month))
            .put("tenants", tenants).put("bills", bills).put("expenses", JSONArray().put(JSONObject().put("name", "공용부 청소").put("amount", 80000).put("date", "$month-05").put("memo", "예시 지출")))
            .put("summary", JSONObject().put("total", 3775500).put("received", 1258500).put("unpaid", 2517000).put("overdue", 2200000).put("expense", 80000).put("activeTenants", 3))
    }
}
