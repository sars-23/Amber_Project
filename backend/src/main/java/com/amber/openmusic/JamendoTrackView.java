package com.amber.openmusic;

/** Safe public search result; the browser receives neither a download URL nor an API credential. */
public record JamendoTrackView(
        String id,
        String title,
        String artist,
        String album,
        int durationSeconds,
        String sourceUrl,
        String licenseUrl,
        String licenseName,
        String attributionText
) {
    public static JamendoTrackView from(JamendoTrack track) {
        return new JamendoTrackView(
                track.id(), track.title(), track.artist(), track.album(), track.durationSeconds(),
                track.sourceUrl(), track.licenseUrl(), JamendoLicensePolicy.displayName(track.licenseUrl()),
                track.attributionText()
        );
    }
}
