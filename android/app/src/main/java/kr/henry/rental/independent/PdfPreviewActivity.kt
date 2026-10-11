package kr.henry.rental.independent

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.os.Bundle
import android.os.ParcelFileDescriptor
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintDocumentInfo
import android.print.PrintManager
import android.print.PageRange
import android.os.CancellationSignal
import android.widget.*
import java.io.File
import java.io.FileOutputStream

/** Internal PDF preview, Android print service and user-selected file output. */
class PdfPreviewActivity:Activity() {
    private var renderer:PdfRenderer?=null;private var descriptor:ParcelFileDescriptor?=null
    private var bitmap:Bitmap?=null;private var current=0;private var zoom=1f
    private lateinit var image:ImageView;private lateinit var label:TextView;private lateinit var file:File
    override fun onCreate(saved:Bundle?){super.onCreate(saved);file=File(cacheDir,"native-report.pdf");current=saved?.getInt("page")?:0;zoom=saved?.getFloat("zoom")?:1f
        try{descriptor=ParcelFileDescriptor.open(file,ParcelFileDescriptor.MODE_READ_ONLY);renderer=PdfRenderer(descriptor!!);current=current.coerceIn(0,renderer!!.pageCount-1);build();showPage()}catch(_:Exception){setContentView(TextView(this).apply{text="PDF를 열지 못했습니다. 뒤로 돌아가 다시 출력해주세요.";setPadding(24,48,24,24)})}}
    private fun build(){val root=LinearLayout(this).apply{orientation=LinearLayout.VERTICAL;setBackgroundColor(Color.WHITE);setOnApplyWindowInsetsListener{v,i->if(android.os.Build.VERSION.SDK_INT>=30){val bars=i.getInsets(android.view.WindowInsets.Type.systemBars());v.setPadding(bars.left+18,bars.top+12,bars.right+18,bars.bottom+12)}else{@Suppress("DEPRECATION") v.setPadding(i.systemWindowInsetLeft+18,i.systemWindowInsetTop+12,i.systemWindowInsetRight+18,i.systemWindowInsetBottom+12)};i}}
        val font=android.graphics.Typeface.createFromAsset(assets,"fonts/Pretendard-Regular.otf")
        fun action(text:String,click:()->Unit)=Button(this).apply{this.text=text;typeface=font;isAllCaps=false;setOnClickListener{click()}}
        val top=LinearLayout(this);top.addView(action("닫기"){finish()});top.addView(action("PDF 저장"){startActivityForResult(Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/pdf").putExtra(Intent.EXTRA_TITLE,"NEW-RENT-STORE-출력.pdf"),103)});top.addView(action("인쇄"){printPdf()});root.addView(top)
        label=TextView(this).apply{textSize=14f;typeface=font};root.addView(label)
        val horizontal=HorizontalScrollView(this);val vertical=ScrollView(this);image=ImageView(this).apply{adjustViewBounds=true};vertical.addView(image);horizontal.addView(vertical);root.addView(horizontal,LinearLayout.LayoutParams(-1,0,1f))
        val controls=LinearLayout(this);controls.addView(action("이전"){if(current>0){current--;showPage()}});controls.addView(action("다음"){if(current+1<renderer!!.pageCount){current++;showPage()}});controls.addView(action("확대"){zoom=if(zoom>=2f)1f else zoom+0.5f;showPage()});root.addView(controls);setContentView(root)
    }
    private fun showPage(){renderer!!.openPage(current).use{page->val width=(resources.displayMetrics.widthPixels*zoom).toInt().coerceAtMost(1800);val next=Bitmap.createBitmap(width,width*page.height/page.width,Bitmap.Config.ARGB_8888);next.eraseColor(Color.WHITE);page.render(next,null,null,PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);image.setImageBitmap(next);image.layoutParams=android.widget.FrameLayout.LayoutParams(next.width,next.height);bitmap?.recycle();bitmap=next};label.text="${current+1} / ${renderer!!.pageCount} 페이지 · 앱 내부 PDF 미리보기"}
    override fun onSaveInstanceState(out:Bundle){out.putInt("page",current);out.putFloat("zoom",zoom);super.onSaveInstanceState(out)}
    @Deprecated("Android Activity result compatibility") override fun onActivityResult(request:Int,result:Int,data:Intent?){super.onActivityResult(request,result,data);if(request==103&&result==RESULT_OK){try{contentResolver.openOutputStream(data!!.data!!,"wt")!!.use{out->file.inputStream().use{it.copyTo(out)}};Toast.makeText(this,"PDF 파일을 저장했습니다.",Toast.LENGTH_LONG).show()}catch(_:Exception){Toast.makeText(this,"PDF 저장을 완료하지 못했습니다.",Toast.LENGTH_LONG).show()}}}
    private fun printPdf(){val bytes=file.readBytes();val pages=renderer!!.pageCount
        (getSystemService(PRINT_SERVICE) as PrintManager).print("NEW RENT STORE",object:PrintDocumentAdapter(){
            override fun onLayout(old:PrintAttributes?,new:PrintAttributes?,cancel:CancellationSignal,callback:LayoutResultCallback,extras:Bundle?){if(cancel.isCanceled){callback.onLayoutCancelled();return};callback.onLayoutFinished(PrintDocumentInfo.Builder("NEW-RENT-STORE.pdf").setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT).setPageCount(pages).build(),true)}
            override fun onWrite(ranges:Array<out PageRange>,destination:ParcelFileDescriptor,cancel:CancellationSignal,callback:WriteResultCallback){try{if(cancel.isCanceled){callback.onWriteCancelled();return};val selected=(0 until pages).filter{page->ranges.any{page in it.start..it.end}};require(selected.isNotEmpty())
                FileOutputStream(destination.fileDescriptor).use{out->if(selected.size==pages)out.write(bytes)else writeSelectedPages(file,selected,cancel,out)}
                if(cancel.isCanceled)callback.onWriteCancelled()else callback.onWriteFinished(selected.map{PageRange(it,it)}.toTypedArray())
            }catch(_:Exception){if(cancel.isCanceled)callback.onWriteCancelled()else callback.onWriteFailed("인쇄 파일을 전달하지 못했습니다.")}}
        },PrintAttributes.Builder().setMediaSize(renderer!!.openPage(0).use{if(it.width>it.height)PrintAttributes.MediaSize.ISO_A4.asLandscape()else PrintAttributes.MediaSize.ISO_A4}).build())
    }
    override fun onDestroy(){if(::image.isInitialized)image.setImageDrawable(null);bitmap?.recycle();renderer?.close();descriptor?.close();super.onDestroy()}
    companion object {
        /** Print a selected range at 216 dpi; the full saved PDF keeps vector text. */
        fun writeSelectedPages(file:File,selected:List<Int>,cancel:CancellationSignal,out:java.io.OutputStream){
            PdfRenderer(ParcelFileDescriptor.open(file,ParcelFileDescriptor.MODE_READ_ONLY)).use{source->val pdf=android.graphics.pdf.PdfDocument();try{for(index in selected){if(cancel.isCanceled)return;source.openPage(index).use{original->val bitmap=Bitmap.createBitmap(original.width*3,original.height*3,Bitmap.Config.ARGB_8888);try{bitmap.eraseColor(Color.WHITE);original.render(bitmap,null,null,PdfRenderer.Page.RENDER_MODE_FOR_PRINT);val page=pdf.startPage(android.graphics.pdf.PdfDocument.PageInfo.Builder(original.width,original.height,index+1).create());try{page.canvas.drawBitmap(bitmap,null,android.graphics.Rect(0,0,original.width,original.height),android.graphics.Paint(android.graphics.Paint.FILTER_BITMAP_FLAG))}finally{pdf.finishPage(page)}}finally{bitmap.recycle()}}};if(!cancel.isCanceled)pdf.writeTo(out)}finally{pdf.close()}}
        }
    }
}
