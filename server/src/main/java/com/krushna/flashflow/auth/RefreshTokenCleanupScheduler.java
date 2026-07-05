package com.krushna.flashflow.auth;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;

@Component
@EnableScheduling
@Slf4j
@RequiredArgsConstructor
public class RefreshTokenCleanupScheduler {

    private final RefreshTokenRepository refreshTokenRepository;

    @Scheduled(fixedDelay = 600000) // Runs every 10 minutes
    @Transactional
    public void purgeExpiredRefreshTokens() {
        log.info("Running expired refresh token purge task...");
        try {
            int deletedCount = refreshTokenRepository.deleteByExpiryDateBefore(Instant.now());
            log.info("Purged {} expired refresh tokens", deletedCount);
        } catch (Exception e) {
            log.error("Failed to purge expired refresh tokens", e);
        }
    }
}
