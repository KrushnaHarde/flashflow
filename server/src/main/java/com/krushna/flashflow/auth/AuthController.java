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
        log.info("Successfully logged in user: {}", request.getEmail());
        return ResponseEntity.ok(response);
    }

    @PostMapping("/refresh")
    @Operation(summary = "Refresh JWT access token", description = "Validates the refresh token and returns a new JWT access token.")
    public ResponseEntity<AuthResponse> refresh(@RequestBody RefreshRequest request) {
        log.info("Received token refresh request");
        AuthResponse response = authenticationService.refresh(request);
        log.info("Successfully refreshed access token");
        return ResponseEntity.ok(response);
    }

    @PostMapping("/logout")
    @Operation(summary = "Logout user", description = "Invalidates the refresh token by deleting it from the database.")
    public ResponseEntity<Void> logout(@RequestBody LogoutRequest request) {
        log.info("Received logout request");
        authenticationService.logout(request);
        log.info("Successfully logged out user");
        return ResponseEntity.ok().build();
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
