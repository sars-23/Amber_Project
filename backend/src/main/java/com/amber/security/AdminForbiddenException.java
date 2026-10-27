package com.amber.security;

public class AdminForbiddenException extends RuntimeException {
    public AdminForbiddenException(String message) {
        super(message);
    }
}
