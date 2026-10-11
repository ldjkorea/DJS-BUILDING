package kr.henry.rental.independent

/** Fixed owner web app and authenticated JSON gateway; no caller-supplied URLs. */
object AppDestination {
    const val WEB_APP = "https://script.google.com/macros/s/AKfycbzclS1FDsLvKEpojsGrQ9eh4dDrjpWP1OFeG2e4RG3LjmtVR7hQRCAutBoSMoXGmgae/exec"
    const val RELEASE_URL = "https://github.com/ldjkorea/NEW-RENT-STORE/releases/latest"
    const val NATIVE_API = "https://script.google.com/macros/s/AKfycby69OSQBFEbQKXt99c2IovorjXUuUFr_iRAUhigHQ8Gye-zMUJKgaLsDxo-WNX7Y_gk/exec"
    const val PACKAGE = "kr.henry.rental.independent"
    const val SIGNER_SHA256 = "b25160850067d115c493fe51aca9bdce1956d999ed45cee0950bd86d33c5a2a0"
    fun isAllowed(url: String): Boolean = url == WEB_APP
}
