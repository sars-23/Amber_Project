package com.amber.openmusic;

/**
 * Machine-readable rejection reasons for Jamendo tracks failing pre-import revalidation.
 */
public enum TrackRejectionReason {
    NONE,
    TRACK_NOT_RETURNED,
    DOWNLOAD_NOT_ALLOWED,
    DOWNLOAD_URL_MISSING,
    UNSUPPORTED_LICENSE,
    INVALID_METADATA,
    API_REQUEST_FAILED,
    INVALID_API_RESPONSE
}
