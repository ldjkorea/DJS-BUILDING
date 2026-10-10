package kr.henry.rental.independent

import android.app.Activity
import android.app.AlertDialog
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.ConnectivityManager
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsClient
import androidx.browser.customtabs.CustomTabsIntent

class MainActivity : Activity() {
    private lateinit var status: TextView
    private var launched = false
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        launched = savedInstanceState?.getBoolean("launched") ?: false
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(28), dp(56), dp(28), dp(36)); setBackgroundColor(Color.rgb(247,248,250))
        }
        val icon = ImageView(this).apply { setImageResource(R.drawable.ic_launcher); contentDescription = getString(R.string.app_name) }
        layout.addView(icon, LinearLayout.LayoutParams(dp(80),dp(80)))
        fun text(resource: Int, size: Float): TextView = TextView(this).apply {
            setText(resource); textSize = size; setTextColor(Color.rgb(32,41,54)); setPadding(0,dp(24),0,dp(8))
        }
        layout.addView(text(R.string.welcome,26f))
        layout.addView(text(R.string.account_hint,16f))
        status=text(R.string.return_message,15f);status.accessibilityLiveRegion=View.ACCESSIBILITY_LIVE_REGION_POLITE
        layout.addView(status)
        fun button(resource: Int, action: ()->Unit) {
            layout.addView(Button(this).apply { setText(resource); minHeight=dp(48); isAllCaps=false; setOnClickListener { action() } },
                LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT,LinearLayout.LayoutParams.WRAP_CONTENT))
        }
        button(R.string.open_app) { openApp(false) }
        button(R.string.open_browser) { openApp(true) }
        button(R.string.apk_updates) { openRelease() }
        button(R.string.updates) { AlertDialog.Builder(this).setTitle(R.string.updates).setMessage(R.string.update_info).setPositiveButton(android.R.string.ok,null).show() }
        layout.addView(text(R.string.version_label,13f))
        val scroll=ScrollView(this).apply { addView(layout) }
        scroll.setOnApplyWindowInsetsListener { view, insets ->
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                val bars=insets.getInsets(android.view.WindowInsets.Type.systemBars());view.setPadding(bars.left,bars.top,bars.right,bars.bottom)
            } else {
                @Suppress("DEPRECATION")
                view.setPadding(insets.systemWindowInsetLeft,insets.systemWindowInsetTop,insets.systemWindowInsetRight,insets.systemWindowInsetBottom)
            }
            insets
        }
        setContentView(scroll)
        if (!launched) { launched=true; openApp(false) }
    }
    private fun openApp(browserOnly: Boolean) {
        val network=getSystemService(ConnectivityManager::class.java)
        if (network.activeNetwork == null) { status.setText(R.string.offline); return }
        try {
            if (browserOnly) startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(AppDestination.WEB_APP)))
            else {
                val provider=CustomTabsClient.getPackageName(this,null)
                if (provider == null) { startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(AppDestination.WEB_APP))); return }
                val tab=CustomTabsIntent.Builder().setShowTitle(true)
                    .setDefaultColorSchemeParams(CustomTabColorSchemeParams.Builder().setToolbarColor(Color.rgb(247,248,250)).build()).build()
                tab.intent.setPackage(provider)
                tab.launchUrl(this,Uri.parse(AppDestination.WEB_APP))
            }
            status.setText(R.string.return_message)
        } catch (_: ActivityNotFoundException) { status.setText(R.string.browser_missing) }
    }
    private fun openRelease() {
        try {
            startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(AppDestination.RELEASE_URL)))
            status.setText(R.string.apk_updates_hint)
        } catch (_: ActivityNotFoundException) { status.setText(R.string.browser_missing) }
    }
    override fun onSaveInstanceState(outState: Bundle) { outState.putBoolean("launched",launched);super.onSaveInstanceState(outState) }
    private fun dp(value: Int)=(value*resources.displayMetrics.density).toInt()
}
