package com.krushna.flashflow.user;

import com.krushna.flashflow.config.JwtService;
import lombok.RequiredArgsConstructor;
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
public class AuthenticationService {

    private final UserRepository userRepository;
    private final RefreshTokenRepository refreshTokenRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final AuthenticationManager authenticationManager;

    @Transactional
    public User register(RegisterRequest request) {
        if (userRepository.findByEmail(request.getEmail()).isPresent()) {
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

        return userRepository.save(user);
    }

    @Transactional
    public AuthResponse login(LoginRequest request) {
        authenticationManager.authenticate(
                new UsernamePasswordAuthenticationToken(
                        request.getEmail(),
                        request.getPassword()
                )
        );

        User user = userRepository.findByEmail(request.getEmail())
                .orElseThrow(() -> new IllegalArgumentException("User not found"));

        String accessToken = jwtService.generateToken(user.getEmail());
        String refreshTokenString = UUID.randomUUID().toString();

        // Save new refresh token (7 days TTL)
        RefreshToken refreshToken = RefreshToken.builder()
                .tokenId(UUID.randomUUID())
                .token(refreshTokenString)
                .userId(user.getUserId())
                .expiryDate(Instant.now().plus(7, ChronoUnit.DAYS))
                .build();

        refreshTokenRepository.save(refreshToken);

        return AuthResponse.builder()
                .accessToken(accessToken)
                .refreshToken(refreshTokenString)
                .expiresIn(jwtService.getExpirationTime())
                .build();
    }

    @Transactional
    public AuthResponse refresh(RefreshRequest request) {
        RefreshToken oldRefreshToken = refreshTokenRepository.findByToken(request.getRefreshToken())
                .orElseThrow(() -> new IllegalArgumentException("Invalid refresh token"));

        if (oldRefreshToken.getExpiryDate().isBefore(Instant.now())) {
            refreshTokenRepository.delete(oldRefreshToken);
            throw new IllegalArgumentException("Refresh token expired");
        }

        User user = userRepository.findById(oldRefreshToken.getUserId())
                .orElseThrow(() -> new IllegalArgumentException("User not found"));

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

        return AuthResponse.builder()
                .accessToken(newAccessToken)
                .refreshToken(newRefreshTokenString)
                .expiresIn(jwtService.getExpirationTime())
                .build();
    }
}
