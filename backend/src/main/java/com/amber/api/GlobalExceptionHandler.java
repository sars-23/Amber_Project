package com.amber.api;

import com.amber.exception.AudioProcessingException;
import com.amber.exception.AudioValidationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;

import org.springframework.web.servlet.resource.NoResourceFoundException;

import java.time.Instant;
import java.util.Map;

import com.amber.security.AdminForbiddenException;
import com.amber.security.AdminUnauthorizedException;

@RestControllerAdvice
public class GlobalExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(AdminUnauthorizedException.class)
    public ResponseEntity<Map<String, Object>> handleAdminUnauthorized(AdminUnauthorizedException ex) {
        log.warn("Unauthorized administrative request: {}", ex.getMessage());
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(Map.of(
                "status", HttpStatus.UNAUTHORIZED.value(),
                "error", "Unauthorized",
                "message", ex.getMessage(),
                "timestamp", Instant.now().toString()
        ));
    }

    @ExceptionHandler(AdminForbiddenException.class)
    public ResponseEntity<Map<String, Object>> handleAdminForbidden(AdminForbiddenException ex) {
        log.warn("Forbidden administrative request: {}", ex.getMessage());
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of(
                "status", HttpStatus.FORBIDDEN.value(),
                "error", "Forbidden",
                "message", ex.getMessage(),
                "timestamp", Instant.now().toString()
        ));
    }

    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<Map<String, Object>> handleNoResourceFound(NoResourceFoundException ex) {
        log.debug("Resource not found: {}", ex.getMessage());
        return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of(
                "error", "Not Found",
                "message", ex.getMessage(),
                "timestamp", Instant.now()
        ));
    }

    @ExceptionHandler(AudioValidationException.class)
    public ResponseEntity<Map<String, Object>> handleValidation(AudioValidationException ex) {
        log.warn("Audio validation error: {}", ex.getMessage());
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of(
                "error", "Bad Request",
                "message", ex.getMessage(),
                "timestamp", Instant.now()
        ));
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<Map<String, Object>> handleMaxUploadSize(MaxUploadSizeExceededException ex) {
        log.warn("Max upload size exceeded: {}", ex.getMessage());
        return ResponseEntity.status(HttpStatus.PAYLOAD_TOO_LARGE).body(Map.of(
                "error", "Payload Too Large",
                "message", "The uploaded file exceeds the maximum permitted limit of 25MB.",
                "timestamp", Instant.now()
        ));
    }

    @ExceptionHandler(AudioProcessingException.class)
    public ResponseEntity<Map<String, Object>> handleProcessing(AudioProcessingException ex) {
        log.error("Audio processing failure: {}", ex.getMessage(), ex);
        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY).body(Map.of(
                "error", "Unprocessable Entity",
                "message", ex.getMessage(),
                "timestamp", Instant.now()
        ));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, Object>> handleIllegalArgument(IllegalArgumentException ex) {
        log.warn("Illegal argument: {}", ex.getMessage());
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of(
                "error", "Bad Request",
                "message", ex.getMessage(),
                "timestamp", Instant.now()
        ));
    }

    @ExceptionHandler(com.amber.openmusic.TrackEligibilityException.class)
    public ResponseEntity<Map<String, Object>> handleTrackEligibility(com.amber.openmusic.TrackEligibilityException ex) {
        log.warn("Track eligibility rejected for track {}: [{}] {}", ex.getTrackId(), ex.getRejectionReason(), ex.getReason());
        Map<String, Object> body = new java.util.LinkedHashMap<>();
        body.put("status", HttpStatus.UNPROCESSABLE_ENTITY.value());
        body.put("error", "Unprocessable Entity");
        body.put("message", ex.getReason() != null ? ex.getReason() : ex.getMessage());
        body.put("trackId", ex.getTrackId());
        body.put("reasonCode", ex.getRejectionReason().name());
        body.put("timestamp", Instant.now().toString());
        return ResponseEntity.status(HttpStatus.UNPROCESSABLE_ENTITY).body(body);
    }

    @ExceptionHandler(org.springframework.web.server.ResponseStatusException.class)
    public ResponseEntity<Map<String, Object>> handleResponseStatus(org.springframework.web.server.ResponseStatusException ex) {
        log.warn("Response status exception: {} - {}", ex.getStatusCode(), ex.getReason());
        return ResponseEntity.status(ex.getStatusCode()).body(Map.of(
                "error", ex.getStatusCode().toString(),
                "message", ex.getReason() != null ? ex.getReason() : ex.getMessage(),
                "timestamp", Instant.now()
        ));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, Object>> handleGeneric(Exception ex) {
        log.error("Internal server error: {}", ex.getMessage(), ex);
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of(
                "error", "Internal Server Error",
                "message", "An unexpected error occurred while processing the request.",
                "timestamp", Instant.now()
        ));
    }
}
