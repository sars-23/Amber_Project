package com.amber.openmusic;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import static org.junit.jupiter.api.Assertions.*;

class JamendoLicensePolicyTest {

    @ParameterizedTest
    @ValueSource(strings = {
            "http://creativecommons.org/licenses/by/4.0/",
            "http://creativecommons.org/licenses/by/4.0",
            "https://creativecommons.org/licenses/by/3.0/",
            "https://creativecommons.org/licenses/by/3.0",
            "https://www.creativecommons.org/licenses/by/4.0/",
            "http://creativecommons.org/licenses/by/2.5/es/",
            "http://creativecommons.org/licenses/by/2.0/uk/",
            "https://creativecommons.org/licenses/by/2.1/jp/",
            "https://creativecommons.org/licenses/by/4.0/legalcode",
            "http://creativecommons.org/licenses/by/3.0/deed.en",
            "http://creativecommons.org/licenses/by/3.0/deed.fr/"
    })
    @DisplayName("Valid CC BY variants are permitted")
    void allowsCcByVariants(String url) {
        assertTrue(JamendoLicensePolicy.isImportAllowed(url), "Should allow: " + url);
        assertEquals("CC BY", JamendoLicensePolicy.displayName(url));
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "http://creativecommons.org/licenses/by-sa/4.0/",
            "http://creativecommons.org/licenses/by-sa/4.0",
            "https://creativecommons.org/licenses/by-sa/3.0/",
            "https://creativecommons.org/licenses/by-sa/3.0",
            "http://creativecommons.org/licenses/by-sa/2.0/",
            "https://www.creativecommons.org/licenses/by-sa/3.0/",
            "http://creativecommons.org/licenses/by-sa/2.5/it/",
            "http://creativecommons.org/licenses/by-sa/2.0/de/",
            "http://creativecommons.org/licenses/by-sa/3.0/igo/",
            "http://creativecommons.org/licenses/by-sa/3.0/deed.en",
            "https://creativecommons.org/licenses/by-sa/3.0/deed.fr/",
            "http://creativecommons.org/licenses/by-sa/4.0/legalcode"
    })
    @DisplayName("Valid CC BY-SA variants are permitted")
    void allowsCcBySaVariants(String url) {
        assertTrue(JamendoLicensePolicy.isImportAllowed(url), "Should allow: " + url);
        assertEquals("CC BY-SA", JamendoLicensePolicy.displayName(url));
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "http://creativecommons.org/licenses/by-nc/4.0/",
            "http://creativecommons.org/licenses/by-nc-sa/4.0/",
            "http://creativecommons.org/licenses/by-nc-sa/3.0/",
            "http://creativecommons.org/licenses/by-nc-sa/2.5/it/",
            "http://creativecommons.org/licenses/by-nc-sa/2.5/es/",
            "http://creativecommons.org/licenses/by-nc-sa/2.0/de/",
            "http://creativecommons.org/licenses/by-nd/4.0/",
            "http://creativecommons.org/licenses/by-nd/3.0/",
            "http://creativecommons.org/licenses/by-nd/2.0/fr/",
            "http://creativecommons.org/licenses/by-nc-nd/4.0/",
            "http://creativecommons.org/licenses/by-nc-nd/3.0/",
            "https://creativecommons.org/publicdomain/zero/1.0/",
            "http://creativecommons.org/licenses/sampling+/1.0/",
            "https://example.com/licenses/by/4.0/",
            "https://creativecommons.org.evil.com/licenses/by/4.0/",
            "http://attacker@creativecommons.org/licenses/by/3.0/",
            "ftp://creativecommons.org/licenses/by/4.0/",
            "javascript:alert(1)",
            "",
            "   ",
            "not a url"
    })
    @DisplayName("Rejects Non-Commercial, No-Derivatives, non-approved hosts, or invalid URLs")
    void rejectsNonApprovedLicenses(String url) {
        assertFalse(JamendoLicensePolicy.isImportAllowed(url), "Should reject: " + url);
        assertEquals("Not approved", JamendoLicensePolicy.displayName(url));
    }

    @Test
    @DisplayName("Null URL is rejected safely")
    void rejectsNull() {
        assertFalse(JamendoLicensePolicy.isImportAllowed(null));
        assertEquals("Not approved", JamendoLicensePolicy.displayName(null));
    }
}
