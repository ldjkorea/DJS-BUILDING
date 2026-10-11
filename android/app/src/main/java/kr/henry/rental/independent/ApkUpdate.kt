package kr.henry.rental.independent

import android.content.Context
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build
import android.util.Base64
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest
import java.util.UUID

/** Release bytes never have access to the encrypted rental store. */
object ApkUpdate {
    const val MAX_BYTES = 16 * 1024 * 1024
    data class Release(val name: String, val code: Int, val size: Long, val hash: String, val chunks: Int, val chunkSize: Int) {
        fun json() = JSONObject().put("versionName",name).put("versionCode",code).put("size",size).put("sha256",hash)
            .put("chunkCount",chunks).put("chunkEncodedSize",chunkSize).put("protocol","rental-apk-update-v1")
            .put("packageName",AppDestination.PACKAGE).put("signerSha256",AppDestination.SIGNER_SHA256)
    }
    fun parse(raw: JSONObject): Release {
        require(raw.getString("protocol")=="rental-apk-update-v1" && raw.getString("packageName")==AppDestination.PACKAGE && raw.getString("signerSha256")==AppDestination.SIGNER_SHA256) { "NEW RENT STORE 배포 정보를 확인하지 못했습니다." }
        fun integer(key:String):Long { val value=raw.get(key).toString();require(value.matches(Regex("[1-9][0-9]*"))){"업데이트 숫자 형식이 올바르지 않습니다."};return value.toLongOrNull()?:error("업데이트 숫자 범위를 확인해주세요.") }
        val name=raw.getString("versionName");val code=integer("versionCode");val size=integer("size")
        val hash=raw.getString("sha256");val chunksValue=integer("chunkCount");val chunkSizeValue=integer("chunkEncodedSize")
        require(chunksValue in 1..64 && chunkSizeValue==524288L){"업데이트 다운로드 범위를 확인해주세요."}
        val chunks=chunksValue.toInt();val chunkSize=chunkSizeValue.toInt()
        require(name.matches(Regex("[0-9]+\\.[0-9]+\\.[0-9]+")) && code in 1..Int.MAX_VALUE.toLong() && size in 4..MAX_BYTES.toLong() && hash.matches(Regex("[a-f0-9]{64}")) && chunkSize==524288 && chunks in 1..64 && chunks.toLong()==((size+2)/3*4+chunkSize-1)/chunkSize) { "업데이트 파일 크기와 버전을 확인해주세요." }
        return Release(name,code.toInt(),size,hash,chunks,chunkSize)
    }
    private fun flags() = if(Build.VERSION.SDK_INT>=28) PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
    fun code(info: PackageInfo): Long = if(Build.VERSION.SDK_INT>=28) info.longVersionCode else info.versionCode.toLong()
    @Suppress("DEPRECATION")
    private fun signers(info: PackageInfo): Set<String> {
        val signatures=if(Build.VERSION.SDK_INT>=28)info.signingInfo?.apkContentsSigners else info.signatures
        return signatures?.map { sha(it.toByteArray()) }?.toSet() ?: emptySet()
    }
    fun sha(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString(""){"%02x".format(it)}
    fun file(context: Context, release: Release) = File(File(context.filesDir,"app-updates"),"${release.code}-${release.hash}.apk")
    fun verify(context: Context, apk: File, release: Release, installedCode: Long = code(context.packageManager.getPackageInfo(context.packageName,0))) {
        require(apk.length()==release.size && release.code>installedCode) { "파일 크기 또는 업데이트 버전이 맞지 않습니다." }
        val digest=MessageDigest.getInstance("SHA-256");apk.inputStream().use { input->val buffer=ByteArray(8192);while(true){val n=input.read(buffer);if(n<0)break;digest.update(buffer,0,n)} }
        require(digest.digest().joinToString(""){"%02x".format(it)}==release.hash) { "다운로드 파일이 손상됐습니다. 다시 내려받아주세요." }
        val archive=context.packageManager.getPackageArchiveInfo(apk.absolutePath,flags()) ?: error("설치 파일을 읽지 못했습니다.")
        val installed=context.packageManager.getPackageInfo(context.packageName,flags())
        require(archive.packageName==context.packageName && archive.packageName==AppDestination.PACKAGE && code(archive)==release.code.toLong() && archive.versionName==release.name) { "다른 앱 또는 다른 버전의 파일입니다." }
        val trusted=setOf(AppDestination.SIGNER_SHA256)
        require(signers(installed)==trusted && signers(archive)==trusted) { "기존 앱과 서명이 일치하지 않습니다. 설치를 중단했습니다." }
        if(Build.VERSION.SDK_INT>=24) require((archive.applicationInfo?.minSdkVersion ?: Int.MAX_VALUE)<=Build.VERSION.SDK_INT) { "이 Android 버전에서 설치할 수 없습니다." }
    }
    fun download(context: Context, release: Release, chunk: (Int)->JSONObject, progress: (Int)->Unit, cancelled: ()->Boolean): File {
        val destination=file(context,release);destination.parentFile!!.mkdirs()
        val part=File(destination.parentFile,"${UUID.randomUUID()}.part")
        try {
            part.outputStream().use { output->
                for(index in 0 until release.chunks){
                    check(!cancelled()) { "다운로드를 취소했습니다." }
                    val row=chunk(index)
                    require(row.getString("status")=="ok" && row.getInt("versionCode")==release.code && row.getString("sha256")==release.hash && row.getInt("index")==index) { "다운로드 중 배포 버전이 바뀌었습니다. 다시 확인해주세요." }
                    val encoded=row.getString("base64")
                    val expected=if(index<release.chunks-1)release.chunkSize else (((release.size+2)/3*4)-(release.chunks-1L)*release.chunkSize).toInt()
                    require(encoded.length==expected && encoded.matches(Regex("[A-Za-z0-9+/]*={0,2}"))) { "다운로드 응답이 올바르지 않습니다." }
                    val bytes=Base64.decode(encoded,Base64.NO_WRAP)
                    require(Base64.encodeToString(bytes,Base64.NO_WRAP)==encoded && part.length()+bytes.size<=release.size) { "다운로드 파일 범위를 확인해주세요." }
                    output.write(bytes);progress(((index+1)*100/release.chunks))
                }
                output.flush()
            }
            check(!cancelled()) { "다운로드를 취소했습니다." }
            verify(context,part,release)
            check(!cancelled()) { "다운로드를 취소했습니다." }
            require(part.renameTo(destination)) { "검증한 설치 파일을 보관하지 못했습니다." }
            return destination
        } finally { part.delete() }
    }
}
