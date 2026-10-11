package kr.henry.rental.independent

import android.content.Context
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import org.json.JSONObject
import java.io.File
import java.io.InputStream
import java.nio.charset.CodingErrorAction

/** Local PDF and bounded JSON files. No HTML renderer or external viewer. */
object NativeDocuments {
    const val MAX_BACKUP_BYTES=1500000
    fun readBackup(input:InputStream):JSONObject {
        val out=java.io.ByteArrayOutputStream()
        val buffer=ByteArray(8192)
        while(true){val n=input.read(buffer);if(n<0)break;require(out.size()+n<=MAX_BACKUP_BYTES){"백업 파일은 1.5MB 이하로 선택해주세요."};out.write(buffer,0,n)}
        val decoder=Charsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT).onUnmappableCharacter(CodingErrorAction.REPORT)
        val raw=decoder.decode(java.nio.ByteBuffer.wrap(out.toByteArray())).toString().removePrefix("\uFEFF")
        var depth=0;var quote=false;var escaped=false
        for(c in raw){if(quote){if(escaped)escaped=false else if(c=='\\')escaped=true else if(c=='"')quote=false}else if(c=='"')quote=true else if(c=='{'||c=='['){depth++;require(depth<=32){"백업 자료 중첩 깊이를 확인해주세요."}}else if(c=='}'||c==']')depth--}
        require(depth==0&&!quote){"백업 JSON이 완전하지 않습니다."}
        require(raw.trimStart().startsWith("{")){"JSON 백업 파일을 선택해주세요."}
        val tokener=org.json.JSONTokener(raw);val parsed=tokener.nextValue() as? JSONObject?:error("JSON 백업 파일을 선택해주세요.")
        require(tokener.nextClean()=='\u0000'){"백업 뒤에 잘못된 자료가 포함돼 있습니다."}
        require(parsed.optJSONArray("tenants")!=null&&parsed.optJSONObject("bills")!=null){"세입자와 고지서가 포함된 백업이 필요합니다."}
        return parsed
    }
    fun createPdf(context:Context,report:JSONObject):File {
        val landscape=report.optBoolean("landscape")
        val width=if(landscape)842 else 595;val height=if(landscape)595 else 842
        val left=38;val bottom=height-46;val font=Typeface.createFromAsset(context.assets,"fonts/Pretendard-Regular.otf")
        val document=PdfDocument();var page:PdfDocument.Page?=null;var count=0;var y=0f
        fun closePage(){val p=page?:return;val paint=Paint(Paint.ANTI_ALIAS_FLAG).apply{typeface=font;textSize=9f;color=Color.GRAY};p.canvas.drawText("NEW RENT STORE · $count",left.toFloat(),(height-24).toFloat(),paint);document.finishPage(p);page=null}
        fun openPage(){closePage();count++;require(count<=200){"출력은 200페이지 이하로 나눠주세요."};page=document.startPage(PdfDocument.PageInfo.Builder(width,height,count).create());val paint=Paint(Paint.ANTI_ALIAS_FLAG).apply{typeface=font;textSize=16f;color=Color.rgb(50,104,200)};page!!.canvas.drawText(report.optString("title"),left.toFloat(),38f,paint);paint.textSize=8f;paint.color=Color.GRAY;page!!.canvas.drawText(report.optString("generatedAt"),left.toFloat(),53f,paint);y=72f}
        try {
            openPage();val lines=report.getJSONArray("lines")
            for(i in 0 until lines.length()){
                val line=lines.getJSONObject(i);val kind=line.optString("kind")
                if(kind=="page"){if(y>72f)openPage();continue}
                val text=line.optString("text");if(text.isEmpty()){y+=8;continue}
                val paint=TextPaint(Paint.ANTI_ALIAS_FLAG).apply{typeface=if(kind=="heading")Typeface.create(font,Typeface.BOLD)else font;textSize=if(kind=="heading")13f else 10.5f;color=Color.rgb(25,38,60)}
                var remaining=text
                while(remaining.isNotEmpty()){
                    val layout=StaticLayout.Builder.obtain(remaining,0,remaining.length,paint,width-left*2).setAlignment(Layout.Alignment.ALIGN_NORMAL).setIncludePad(false).setLineSpacing(3f,1f).build()
                    if(layout.height<=bottom-72&&layout.height>bottom-y){openPage();continue}
                    var fit=layout.lineCount
                    while(fit>0&&layout.getLineBottom(fit-1)>bottom-y)fit--
                    if(fit==0){openPage();continue}
                    val end=layout.getLineEnd(fit-1);val fragment=remaining.substring(0,end)
                    val draw=StaticLayout.Builder.obtain(fragment,0,fragment.length,paint,width-left*2).setIncludePad(false).setLineSpacing(3f,1f).build()
                    val canvas=page!!.canvas;canvas.save();canvas.translate(left.toFloat(),y);draw.draw(canvas);canvas.restore();y+=draw.height+8
                    remaining=remaining.substring(end);if(remaining.isNotEmpty())openPage()
                }
            }
            closePage();val file=File(context.cacheDir,"native-report.pdf")
            file.outputStream().use{document.writeTo(it)};return file
        }finally{closePage();document.close()}
    }
}
