package com.amber.openmusic;

import java.net.URI;
import java.util.Locale;
import java.util.regex.Pattern;

/** Conservative initial policy: only CC BY and CC BY-SA licenses qualify for import. */
public final class JamendoLicensePolicy {
    private static final Pattern APPROVED_PATH = Pattern.compile(
            "^/licenses/by(?:-sa)?/[0-9]+(?:\\.[0-9]+)*(?:/[a-z]{2,10}(?:-[a-z]{2,5})?)?(?:/(?:deed|legalcode)(?:\\.[a-z]{2,5})?)?/?$",
            Pattern.CASE_INSENSITIVE
    );

    private JamendoLicensePolicy() {}

    public static boolean isImportAllowed(String licenseUrl) {
        if (licenseUrl == null || licenseUrl.isBlank()) return false;
        try {
            URI uri = URI.create(licenseUrl.trim());
            String scheme = uri.getScheme();
            if (scheme == null || (!scheme.equalsIgnoreCase("http") && !scheme.equalsIgnoreCase("https"))) {
                return false;
            }
            String host = uri.getHost();
            if (host == null) return false;
            String lowerHost = host.toLowerCase(Locale.ROOT);
            if (!lowerHost.equals("creativecommons.org") && !lowerHost.equals("www.creativecommons.org")) {
                return false;
            }
            if (uri.getUserInfo() != null || uri.getRawUserInfo() != null) {
                return false;
            }
            String path = uri.getPath();
            return path != null && APPROVED_PATH.matcher(path).matches();
        } catch (IllegalArgumentException ex) {
            return false;
        }
    }

    public static String displayName(String licenseUrl) {
        if (!isImportAllowed(licenseUrl)) return "Not approved";
        try {
            String path = URI.create(licenseUrl.trim()).getPath().toLowerCase(Locale.ROOT);
            return path.startsWith("/licenses/by-sa/") ? "CC BY-SA" : "CC BY";
        } catch (IllegalArgumentException ex) {
            return "Not approved";
        }
    }
}
