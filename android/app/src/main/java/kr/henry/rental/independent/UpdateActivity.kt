package kr.henry.rental.independent

import android.app.Activity
import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.View
import android.view.WindowInsets
import android.widget.*
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.util.concurrent.Executors

/** User initiated update. Android owns installation permission and confirmation. */
class UpdateActivity : Activity() {
    private lateinit var controller: UpdateController
    private lateinit var content: LinearLayout
    private lateinit var font: Typeface
    private var awaitPermission=false
    private var autoInstall=true
    private var installerOpen=false
    private val blue=Color.rgb(50,104,200)
    override fun onCreate(saved: Bundle?) {
        super.onCreate(saved)
        font=Typeface.createFromAsset(assets,"fonts/Pretendard-Regular.otf")
        awaitPermission=saved?.getBoolean("permission")?:false
        autoInstall=saved?.getBoolean("auto")?:true
        installerOpen=saved?.getBoolean("installer")?:false
        controller=(lastNonConfigurationInstance as? UpdateController) ?: UpdateController(applicationContext,saved?.getString("release"))
        val scroll=ScrollView(this).apply{setBackgroundColor(Color.rgb(246,248,251))}
        content=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;setPadding(dp(24),dp(24),dp(24),dp(24))};scroll.addView(content);setContentView(scroll)
        if(Build.VERSION.SDK_INT>=30)scroll.setOnApplyWindowInsetsListener{v,insets->val bars=insets.getInsets(WindowInsets.Type.systemBars());v.setPadding(bars.left,bars.top,bars.right,bars.bottom);insets}
        controller.observer={ready->runOnUiThread{if(!isDestroyed){render();if(ready&&autoInstall){autoInstall=false;openInstaller()}}}}
        render()
        if(controller.phase=="idle")controller.start()
        else if(controller.phase=="ready"&&autoInstall&&!awaitPermission&&!installerOpen)continueInstall()
    }
    override fun onRetainNonConfigurationInstance(): Any=controller
    override fun onSaveInstanceState(out: Bundle){out.putBoolean("permission",awaitPermission);out.putBoolean("auto",autoInstall);out.putBoolean("installer",installerOpen);out.putString("release",if(controller.phase=="ready")controller.release?.json()?.toString() else null);super.onSaveInstanceState(out)}
    override fun onResume(){super.onResume();if(!::controller.isInitialized)return
        if(awaitPermission){awaitPermission=false;if(Build.VERSION.SDK_INT<26||packageManager.canRequestPackageInstalls())continueInstall() else{controller.message="설치 허용이 필요합니다. 원할 때 ‘설치 계속’을 눌러주세요.";render()}}
        if(installerOpen){installerOpen=false;controller.message="설치가 취소됐다면 ‘설치 계속’으로 다시 진행할 수 있습니다.";render()}
    }
    override fun onDestroy(){controller.observer=null;if(!isChangingConfigurations)controller.close();super.onDestroy()}
    private fun dp(n:Int)=(resources.displayMetrics.density*n).toInt()
    private fun add(view: View,top:Int=12){content.addView(view,LinearLayout.LayoutParams(-1,-2).apply{topMargin=dp(top)})}
    private fun label(value:String,size:Float=15f,bold:Boolean=false)=TextView(this).apply{text=value;textSize=size;setTextColor(Color.rgb(25,38,60));typeface=if(bold)Typeface.create(font,Typeface.BOLD)else font;setLineSpacing(dp(4).toFloat(),1f)}
    private fun button(value:String,primary:Boolean=true,action:()->Unit)=Button(this).apply{text=value;isAllCaps=false;textSize=15f;typeface=font;minHeight=dp(52);setTextColor(if(primary)Color.WHITE else blue);background=GradientDrawable().apply{setColor(if(primary)blue else Color.rgb(237,243,253));cornerRadius=dp(14).toFloat()};setOnClickListener{action()}}
    private fun render(){content.removeAllViews();add(label("앱 업데이트",26f,true),0);add(label("NEW RENT STORE · 현재 ${packageManager.getPackageInfo(packageName,0).versionName}"),10);add(label(controller.message,16f),24)
        if(controller.busy){add(ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal).apply{max=100;isIndeterminate=controller.phase!="download";progress=controller.percent},20);if(controller.phase=="download")add(label("${controller.percent}% · 브라우저를 열지 않고 내려받고 있어요."))}
        if(controller.phase=="ready"){add(label("${controller.release!!.name} · 파일과 서명 확인 완료",14f),18);add(button("설치 계속"){continueInstall()},20)}
        if(!controller.busy)add(button(if(controller.phase=="error")"업데이트 다시 시도" else "새 버전 다시 확인",false){autoInstall=true;controller.start()},16)
        add(label("기존 앱 위에 설치하며 Google 자료와 기기 연결을 유지합니다. 처음에는 이 앱의 설치 허용이 필요할 수 있고, 마지막 설치 확인은 Android 화면에서 진행합니다.",13f),24)
        add(button(if(controller.busy)"취소 · 닫기" else "닫기",false){finish()},24)
    }
    private fun continueInstall(){if(controller.busy)return;autoInstall=true;controller.verifyReady()}
    private fun openInstaller(){val release=controller.release?:return
        if(Build.VERSION.SDK_INT>=26&&!packageManager.canRequestPackageInstalls()){
            controller.message="NEW RENT STORE의 ‘이 출처 허용’을 켜고 돌아오면 설치로 이어집니다.";render()
            try{awaitPermission=true;startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:$packageName")))}catch(_:Exception){awaitPermission=false;controller.message="설정에서 NEW RENT STORE의 앱 설치를 허용한 뒤 ‘설치 계속’을 눌러주세요.";render()};return
        }
        try{
            val uri=FileProvider.getUriForFile(this,"$packageName.updates",ApkUpdate.file(this,release))
            val request=Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            request.clipData=ClipData.newRawUri("NEW RENT STORE update",uri)
            installerOpen=true;controller.message="Android 설치 화면에서 업데이트를 확인해주세요.";render();startActivity(request)
        }catch(_:Exception){installerOpen=false;controller.message="설치 화면을 열지 못했습니다. ‘설치 계속’으로 다시 시도해주세요.";render()}
    }
}

/** Retained across rotation; owns application Context, never an Activity. */
internal class UpdateController(private val context: Context,savedRelease:String?) {
    private val executor=Executors.newSingleThreadExecutor()
    @Volatile private var closed=false
    @Volatile var observer: ((Boolean)->Unit)?=null
    @Volatile var phase="idle"
    @Volatile var message="새 버전을 확인하고 있어요."
    @Volatile var percent=0
    @Volatile var release: ApkUpdate.Release?=null
    val busy get()=phase in setOf("check","download","verify")
    init{if(savedRelease!=null)try{release=ApkUpdate.parse(JSONObject(savedRelease));phase="ready";message="보관한 파일을 다시 확인한 뒤 설치할 수 있습니다."}catch(_:Exception){phase="error";message="업데이트를 다시 확인해주세요."}}
    private fun notify(ready:Boolean=false){if(!closed)observer?.invoke(ready)}
    fun start(){if(busy||closed)return;phase="check";message="새 버전을 확인하고 있어요.";notify()
        executor.execute{try{
            val response=NativeApi.updateManifest();require(response.optString("status")=="ok"){response.optString("message","업데이트 배포를 확인하지 못했습니다.")}
            val next=ApkUpdate.parse(response.getJSONObject("release"));val installed=ApkUpdate.code(context.packageManager.getPackageInfo(context.packageName,0));release=next
            if(next.code<=installed){phase="latest";message="최신 버전입니다. (${context.packageManager.getPackageInfo(context.packageName,0).versionName})";notify();return@execute}
            val cached=ApkUpdate.file(context,next)
            var usable=false;if(cached.isFile)try{ApkUpdate.verify(context,cached,next);usable=true}catch(_:Exception){cached.delete()}
            if(!usable){phase="download";message="${next.name} 업데이트를 내려받고 있어요.";percent=0;notify()
                ApkUpdate.download(context,next,{NativeApi.updateChunk(next.code,next.hash,it)},{p->percent=p;if(p==100){phase="verify";message="파일과 기존 앱의 서명을 확인하고 있어요."};notify()},{closed||Thread.currentThread().isInterrupted})}
            if(!closed){phase="ready";message="다운로드와 검증이 완료됐습니다. 설치 화면으로 이어집니다.";notify(true)}
        }catch(e:Exception){if(!closed){phase="error";message=e.message?:"연결을 확인하고 다시 시도해주세요.";notify()}}}
    }
    fun verifyReady(){val current=release?:return;if(busy||closed)return;phase="verify";message="보관한 설치 파일을 다시 확인하고 있어요.";notify();executor.execute{try{ApkUpdate.verify(context,ApkUpdate.file(context,current),current);phase="ready";message="설치 파일을 확인했습니다.";notify(true)}catch(e:Exception){phase="error";message=e.message?:"파일을 다시 내려받아주세요.";notify()}}}
    fun close(){closed=true;observer=null;executor.shutdownNow()}
}
