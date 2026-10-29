package com.amber.openmusic;

import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * Exception thrown when a selected track fails server-side revalidation before queuing.
 * Carries the failing track ID and structured machine-readable reason code.
 */
public class TrackEligibilityException extends ResponseStatusException {
    private final String trackId;
    private final TrackRejectionReason rejectionReason;

    public TrackEligibilityException(String trackId, TrackRejectionReason rejectionReason, String message) {
        super(HttpStatus.UNPROCESSABLE_ENTITY, message);
        this.trackId = trackId;
        this.rejectionReason = rejectionReason != null ? rejectionReason : TrackRejectionReason.UNSUPPORTED_LICENSE;
    }

    public String getTrackId() {
        return trackId;
    }

    public TrackRejectionReason getRejectionReason() {
        return rejectionReason;
    }
}
