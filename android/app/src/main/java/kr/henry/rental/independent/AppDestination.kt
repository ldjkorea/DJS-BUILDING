package kr.henry.rental.independent

/** The native launcher accepts no caller-supplied URL or authentication data. */
object AppDestination {
    const val WEB_APP = "https://script.google.com/macros/s/AKfycbzclS1FDsLvKEpojsGrQ9eh4dDrjpWP1OFeG2e4RG3LjmtVR7hQRCAutBoSMoXGmgae/exec"
    const val RELEASE_URL = "https://github.com/ldjkorea/NEW-RENT-STORE/releases/latest"
    const val PACKAGE = "kr.henry.rental.independent"
    fun isAllowed(url: String): Boolean = url == WEB_APP
}
