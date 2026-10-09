package kr.henry.rental.independent
import org.junit.Assert.*
import org.junit.Test
class AppDestinationTest {
    @Test fun callerCannotSubstituteSourceOrPhishingUrl() {
        assertTrue(AppDestination.isAllowed(AppDestination.WEB_APP))
        for (url in listOf("http://script.google.com/", "https://script.google.com.evil.test/", AppDestination.WEB_APP+"?redirect=evil", "javascript:alert(1)")) assertFalse(AppDestination.isAllowed(url))
    }
}
