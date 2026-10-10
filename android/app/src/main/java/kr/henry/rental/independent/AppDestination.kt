package kr.henry.rental.independent

/** Fixed owner web app and authenticated JSON gateway; no caller-supplied URLs. */
object AppDestination {
    const val WEB_APP = "https://script.google.com/macros/s/AKfycbzclS1FDsLvKEpojsGrQ9eh4dDrjpWP1OFeG2e4RG3LjmtVR7hQRCAutBoSMoXGmgae/exec"
    const val RELEASE_URL = "https://github.com/ldjkorea/NEW-RENT-STORE/releases/latest"
    const val NATIVE_API = "https://script.google.com/macros/s/AKfycby69OSQBFEbQKXt99c2IovorjXUuUFr_iRAUhigHQ8Gye-zMUJKgaLsDxo-WNX7Y_gk/exec"
    const val PACKAGE = "kr.henry.rental.independent"
    fun isAllowed(url: String): Boolean = url == WEB_APP
}
