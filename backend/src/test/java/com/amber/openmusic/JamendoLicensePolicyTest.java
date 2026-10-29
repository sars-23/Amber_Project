package com.amber.openmusic;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class JamendoLicensePolicyTest {

    @Test
    void allowsCcByAndCcBySa() {
        assertTrue(JamendoLicensePolicy.isImportAllowed("http://creativecommons.org/licenses/by/4.0/"));
        assertTrue(JamendoLicensePolicy.isImportAllowed("https://creativecommons.org/licenses/by/3.0/"));
        assertTrue(JamendoLicensePolicy.isImportAllowed("https://creativecommons.org/licenses/by-sa/4.0/"));
        assertTrue(JamendoLicensePolicy.isImportAllowed("http://creativecommons.org/licenses/by-sa/2.0/"));
        assertEquals("CC BY", JamendoLicensePolicy.displayName("https://creativecommons.org/licenses/by/4.0/"));
        assertEquals("CC BY-SA", JamendoLicensePolicy.displayName("https://creativecommons.org/licenses/by-sa/4.0/"));
    }

    @Test
    void rejectsNonCommercialNoDerivativesOrOtherHosts() {
        assertFalse(JamendoLicensePolicy.isImportAllowed("http://creativecommons.org/licenses/by-nc/4.0/"));
        assertFalse(JamendoLicensePolicy.isImportAllowed("http://creativecommons.org/licenses/by-nc-sa/4.0/"));
        assertFalse(JamendoLicensePolicy.isImportAllowed("http://creativecommons.org/licenses/by-nd/4.0/"));
        assertFalse(JamendoLicensePolicy.isImportAllowed("https://example.com/licenses/by/4.0/"));
        assertFalse(JamendoLicensePolicy.isImportAllowed(""));
        assertFalse(JamendoLicensePolicy.isImportAllowed(null));
        assertFalse(JamendoLicensePolicy.isImportAllowed("not a url"));
    }
}
