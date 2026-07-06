package com.krushna.flashflow.auth;

import com.krushna.flashflow.user.User;
import com.krushna.flashflow.user.UserResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/auth")
@RequiredArgsConstructor
@Slf4j
@Tag(name = "Authentication", description = "Endpoints for user registration, login, and token refreshing")
public class AuthController {

    private final AuthenticationService authenticationService;

    @PostMapping("/register")
    @Operation(summary = "Register a new user", description = "Registers a new user in the system with roles and returns the created user entity.")
    public ResponseEntity<UserResponse> register(@RequestBody RegisterRequest request) {
        log.info("Received request to register user with email: {}", request.getEmail());
        User user = authenticationService.register(request);
        log.info("Successfully registered user: {}", user.getUserId());
        
        UserResponse responseDto = UserResponse.builder()
                .id(user.getUserId())
                .name(user.getName())
                .email(user.getEmail())
                .role(user.getRole())
                .createdAt(user.getCreatedAt())
                .build();
                
        return ResponseEntity.status(HttpStatus.CREATED).body(responseDto);
    }

    @PostMapping("/login")
    @Operation(summary = "Authenticate user", description = "Validates credentials and returns JWT access token and refresh token details.")
    public ResponseEntity<AuthResponse> login(@RequestBody LoginRequest request) {
        log.info("Received login request for user: {}", request.getEmail());
        AuthResponse response = authenticationService.login(request);
        
        org.springframework.http.ResponseCookie cookie = org.springframework.http.ResponseCookie.from("rt_flashflow", response.getRefreshToken())
                .httpOnly(true)
                .secure(false)
                .path("/api/v1/auth")
                .maxAge(7 * 24 * 60 * 60)
                .sameSite("Lax")
                .build();

        org.springframework.http.ResponseCookie csrfCookie = org.springframework.http.ResponseCookie.from("csrf_flashflow", response.getCsrfToken())
                .httpOnly(false)
                .secure(false)
                .path("/")
                .maxAge(7 * 24 * 60 * 60)
                .sameSite("Lax")
                .build();
        
        // Hide refresh token from client JSON body
        response.setRefreshToken(null);
        
        log.info("Successfully logged in user: {}", request.getEmail());
        return ResponseEntity.ok()
                .header(org.springframework.http.HttpHeaders.SET_COOKIE, cookie.toString())
                .header(org.springframework.http.HttpHeaders.SET_COOKIE, csrfCookie.toString())
                .body(response);
    }

    @PostMapping("/refresh")
    @Operation(summary = "Refresh JWT access token", description = "Validates the refresh token and returns a new JWT access token.")
    public ResponseEntity<AuthResponse> refresh(
            @org.springframework.web.bind.annotation.CookieValue(name = "rt_flashflow", required = false) String refreshToken,
            @org.springframework.web.bind.annotation.RequestHeader(name = "X-CSRF-Token", required = false) String csrfToken) {
        log.info("Received token refresh request");
        if (refreshToken == null || refreshToken.isEmpty()) {
            throw new IllegalArgumentException("Refresh token is missing");
        }
        if (csrfToken == null || csrfToken.isEmpty()) {
            throw new IllegalArgumentException("CSRF token is missing");
        }
        
        AuthResponse response = authenticationService.refresh(refreshToken, csrfToken);
        
        org.springframework.http.ResponseCookie cookie = org.springframework.http.ResponseCookie.from("rt_flashflow", response.getRefreshToken())
                .httpOnly(true)
                .secure(false)
                .path("/api/v1/auth")
                .maxAge(7 * 24 * 60 * 60)
                .sameSite("Lax")
                .build();

        org.springframework.http.ResponseCookie csrfCookie = org.springframework.http.ResponseCookie.from("csrf_flashflow", response.getCsrfToken())
                .httpOnly(false)
                .secure(false)
                .path("/")
                .maxAge(7 * 24 * 60 * 60)
                .sameSite("Lax")
                .build();
        
        // Hide refresh token from client JSON body
        response.setRefreshToken(null);
        
        log.info("Successfully refreshed access token");
        return ResponseEntity.ok()
                .header(org.springframework.http.HttpHeaders.SET_COOKIE, cookie.toString())
                .header(org.springframework.http.HttpHeaders.SET_COOKIE, csrfCookie.toString())
                .body(response);
    }

    @PostMapping("/logout")
    @Operation(summary = "Logout user", description = "Invalidates the refresh token by deleting it from the database.")
    public ResponseEntity<Void> logout(
            @org.springframework.web.bind.annotation.CookieValue(name = "rt_flashflow", required = false) String refreshToken,
            @org.springframework.web.bind.annotation.RequestHeader(name = "X-CSRF-Token", required = false) String csrfToken) {
        log.info("Received logout request");
        if (refreshToken != null && csrfToken != null && !refreshToken.isEmpty() && !csrfToken.isEmpty()) {
            authenticationService.logout(refreshToken, csrfToken);
        }
        
        org.springframework.http.ResponseCookie cookie = org.springframework.http.ResponseCookie.from("rt_flashflow", "")
                .httpOnly(true)
                .secure(false)
                .path("/api/v1/auth")
                .maxAge(0)
                .sameSite("Lax")
                .build();

        org.springframework.http.ResponseCookie csrfCookie = org.springframework.http.ResponseCookie.from("csrf_flashflow", "")
                .httpOnly(false)
                .secure(false)
                .path("/")
                .maxAge(0)
                .sameSite("Lax")
                .build();
        
        log.info("Successfully logged out user");
        return ResponseEntity.ok()
                .header(org.springframework.http.HttpHeaders.SET_COOKIE, cookie.toString())
                .header(org.springframework.http.HttpHeaders.SET_COOKIE, csrfCookie.toString())
                .build();
    }

    @org.springframework.web.bind.annotation.GetMapping("/me")
    @Operation(summary = "Get current user profile")
    public ResponseEntity<UserResponse> getMe(@org.springframework.security.core.annotation.AuthenticationPrincipal User user) {
        if (user == null) {
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        }
        UserResponse responseDto = UserResponse.builder()
                .id(user.getUserId())
                .name(user.getName())
                .email(user.getEmail())
                .role(user.getRole())
                .createdAt(user.getCreatedAt())
                .build();
        return ResponseEntity.ok(responseDto);
    }
}
