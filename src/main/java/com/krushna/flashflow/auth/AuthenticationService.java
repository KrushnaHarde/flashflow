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

        String accessToken = jwtService.generateToken(user.getEmail());
        String refreshTokenString = UUID.randomUUID().toString();

        log.info("Generating new refresh token for user ID: {}", user.getUserId());
        // Save new refresh token (7 days TTL)
        RefreshToken refreshToken = RefreshToken.builder()
                .tokenId(UUID.randomUUID())
                .token(refreshTokenString)
                .userId(user.getUserId())
                .expiryDate(Instant.now().plus(7, ChronoUnit.DAYS))
                .build();

        refreshTokenRepository.save(refreshToken);
        log.info("Authentication successful. Access token and refresh token generated for user: {}", request.getEmail());

        return AuthResponse.builder()
                .accessToken(accessToken)
                .refreshToken(refreshTokenString)
                .expiresIn(jwtService.getExpirationTime())
                .build();
    }

    @Transactional
    public AuthResponse refresh(RefreshRequest request) {
        log.info("Attempting token refresh operation");
        RefreshToken oldRefreshToken = refreshTokenRepository.findByToken(request.getRefreshToken())
                .orElseThrow(() -> {
                    log.warn("Token refresh aborted. Provided refresh token is invalid");
                    return new IllegalArgumentException("Invalid refresh token");
                });

        if (oldRefreshToken.getExpiryDate().isBefore(Instant.now())) {
            log.warn("Token refresh aborted. Refresh token is expired. Removing token ID: {}", oldRefreshToken.getTokenId());
            refreshTokenRepository.delete(oldRefreshToken);
            throw new IllegalArgumentException("Refresh token expired");
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
        String newAccessToken = jwtService.generateToken(user.getEmail());
        String newRefreshTokenString = UUID.randomUUID().toString();

        RefreshToken newRefreshToken = RefreshToken.builder()
                .tokenId(UUID.randomUUID())
                .token(newRefreshTokenString)
                .userId(user.getUserId())
                .expiryDate(Instant.now().plus(7, ChronoUnit.DAYS))
                .build();

        refreshTokenRepository.save(newRefreshToken);
        log.info("Token refresh successful. New tokens issued for user: {}", user.getEmail());

        return AuthResponse.builder()
                .accessToken(newAccessToken)
                .refreshToken(newRefreshTokenString)
                .expiresIn(jwtService.getExpirationTime())
                .build();
    }
}
