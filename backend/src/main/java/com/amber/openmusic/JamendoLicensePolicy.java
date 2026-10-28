package com.amber.openmusic;

import java.net.URI;
import java.util.Locale;
import java.util.regex.Pattern;

/** Conservative initial policy: only CC BY and CC BY-SA licenses qualify for import. */
public final class JamendoLicensePolicy {
    private static final Pattern APPROVED_PATH = Pattern.compile("^/licenses/by(?:-sa)?/[0-9]+(?:\\.[0-9]+)*/?$", Pattern.CASE_INSENSITIVE);

    private JamendoLicensePolicy() {}

    public static boolean isImportAllowed(String licenseUrl) {
        if (licenseUrl == null || licenseUrl.isBlank()) return false;
        try {
            URI uri = URI.create(licenseUrl.trim());
            String host = uri.getHost();
            return host != null
                    && host.toLowerCase(Locale.ROOT).equals("creativecommons.org")
                    && uri.getUserInfo() == null
                    && APPROVED_PATH.matcher(uri.getPath() == null ? "" : uri.getPath()).matches();
        } catch (IllegalArgumentException ex) {
            return false;
        }
    }

    public static String displayName(String licenseUrl) {
        if (!isImportAllowed(licenseUrl)) return "Not approved";
        String path = URI.create(licenseUrl.trim()).getPath().toLowerCase(Locale.ROOT);
        return path.startsWith("/licenses/by-sa/") ? "CC BY-SA" : "CC BY";
    }
}
