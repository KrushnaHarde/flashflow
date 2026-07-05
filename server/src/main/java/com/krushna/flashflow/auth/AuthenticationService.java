package com.krushna.flashflow.auth;

import com.krushna.flashflow.user.User;
import com.krushna.flashflow.user.UserRepository;

import com.krushna.flashflow.config.JwtService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Slf4j
public class AuthenticationService {

    private final UserRepository userRepository;
    private final RefreshTokenRepository refreshTokenRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final AuthenticationManager authenticationManager;

    @Transactional
    public User register(RegisterRequest request) {
        log.info("Attempting to register user with email: {}", request.getEmail());
        if (userRepository.findByEmail(request.getEmail()).isPresent()) {
            log.warn("Registration rejected. Email already in use: {}", request.getEmail());
            throw new IllegalArgumentException("Email already in use");
        }

        User user = User.builder()
                .userId(UUID.randomUUID())
                .name(request.getName())
                .email(request.getEmail())
                .password(passwordEncoder.encode(request.getPassword()))
                .role(Role.USER)
                .enabled(true)
                .build();

        User savedUser = userRepository.save(user);
        log.info("User registered successfully. Assigned ID: {}", savedUser.getUserId());
        return savedUser;
    }

    private java.util.Map<String, Object> buildClaims(User user) {
        java.util.Map<String, Object> claims = new java.util.HashMap<>();
        claims.put("role", user.getRole().name());
        claims.put("userId", user.getUserId().toString());
        claims.put("name", user.getName());
        return claims;
    }

    @Transactional
    public AuthResponse login(LoginRequest request) {
        log.info("Attempting to authenticate user: {}", request.getEmail());
        authenticationManager.authenticate(
                new UsernamePasswordAuthenticationToken(
                        request.getEmail(),
                        request.getPassword()
                )
        );

        User user = userRepository.findByEmail(request.getEmail())
                .orElseThrow(() -> {
                    log.warn("Authentication passed but user record not found in database for email: {}", request.getEmail());
                    return new IllegalArgumentException("User not found");
                });

        java.util.Map<String, Object> claims = buildClaims(user);
        String accessToken = jwtService.generateToken(claims, user.getEmail());
        String refreshTokenString = UUID.randomUUID().toString();
        String csrfToken = UUID.randomUUID().toString();

        log.info("Generating new refresh token for user ID: {}", user.getUserId());
        // Save new refresh token (7 days TTL)
        RefreshToken refreshToken = RefreshToken.builder()
                .tokenId(UUID.randomUUID())
                .token(refreshTokenString)
                .userId(user.getUserId())
                .expiryDate(Instant.now().plus(7, ChronoUnit.DAYS))
                .csrfToken(csrfToken)
                .build();

        refreshTokenRepository.save(refreshToken);
        log.info("Authentication successful. Access token and refresh token generated for user: {}", request.getEmail());

        return AuthResponse.builder()
                .accessToken(accessToken)
                .refreshToken(refreshTokenString)
                .csrfToken(csrfToken)
                .expiresIn(jwtService.getExpirationTime())
                .build();
    }

    @Transactional
    public AuthResponse refresh(String refreshToken, String csrfToken) {
        log.info("Attempting token refresh operation");
        RefreshToken oldRefreshToken = refreshTokenRepository.findByToken(refreshToken)
                .orElseThrow(() -> {
                    log.warn("Token refresh aborted. Provided refresh token is invalid");
                    return new IllegalArgumentException("Invalid refresh token");
                });

        if (oldRefreshToken.getExpiryDate().isBefore(Instant.now())) {
            log.warn("Token refresh aborted. Refresh token is expired. Removing token ID: {}", oldRefreshToken.getTokenId());
            refreshTokenRepository.delete(oldRefreshToken);
            throw new IllegalArgumentException("Refresh token expired");
        }

        // Double-submit CSRF Token validation
        if (oldRefreshToken.getCsrfToken() != null && !oldRefreshToken.getCsrfToken().equals(csrfToken)) {
            log.warn("CSRF token mismatch. Expected: {}, Received: {}", oldRefreshToken.getCsrfToken(), csrfToken);
            throw new IllegalArgumentException("CSRF token validation failed");
        }

        User user = userRepository.findById(oldRefreshToken.getUserId())
                .orElseThrow(() -> {
                    log.error("Token refresh aborted. User ID {} linked to refresh token was not found", oldRefreshToken.getUserId());
                    return new IllegalArgumentException("User not found");
                });

        log.info("Rotating refresh token for user ID: {}", user.getUserId());
        // Delete the old refresh token (Rotation)
        refreshTokenRepository.delete(oldRefreshToken);

        // Generate new access and refresh tokens
        java.util.Map<String, Object> claims = buildClaims(user);
        String newAccessToken = jwtService.generateToken(claims, user.getEmail());
        String newRefreshTokenString = UUID.randomUUID().toString();
        String newCsrfToken = UUID.randomUUID().toString();

        RefreshToken newRefreshToken = RefreshToken.builder()
                .tokenId(UUID.randomUUID())
                .token(newRefreshTokenString)
                .userId(user.getUserId())
                .expiryDate(Instant.now().plus(7, ChronoUnit.DAYS))
                .csrfToken(newCsrfToken)
                .build();

        refreshTokenRepository.save(newRefreshToken);
        log.info("Token refresh successful. New tokens issued for user: {}", user.getEmail());

        return AuthResponse.builder()
                .accessToken(newAccessToken)
                .refreshToken(newRefreshTokenString)
                .csrfToken(newCsrfToken)
                .expiresIn(jwtService.getExpirationTime())
                .build();
    }

    @Transactional
    public void logout(String refreshToken, String csrfToken) {
        log.info("Processing logout request...");
        if (refreshToken != null) {
            refreshTokenRepository.findByToken(refreshToken)
                    .ifPresent(token -> {
                        if (token.getCsrfToken() != null && !token.getCsrfToken().equals(csrfToken)) {
                            log.warn("Logout aborted. CSRF token mismatch.");
                            throw new IllegalArgumentException("CSRF token validation failed");
                        }
                        refreshTokenRepository.delete(token);
                        log.info("Deleted refresh token from database during logout");
                    });
        }
    }
}
