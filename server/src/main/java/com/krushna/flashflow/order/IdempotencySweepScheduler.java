package com.krushna.flashflow.order;

import com.krushna.flashflow.inventory.redis.RedisIdempotencyService;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;

@Component
@EnableScheduling
@Slf4j
public class IdempotencySweepScheduler {

    private final IdempotencyRepository idempotencyRepository;
    private final RedisIdempotencyService redisIdempotencyService;
    private final Counter stuckIdempotencyCounter;

    @Value("${flashflow.idempotency.stuck-timeout-minutes:5}")
    private int stuckTimeoutMinutes;

    @Value("${flashflow.schedulers.enabled:true}")
    private boolean schedulersEnabled;

    public IdempotencySweepScheduler(
            IdempotencyRepository idempotencyRepository,
            RedisIdempotencyService redisIdempotencyService,
            MeterRegistry meterRegistry) {
        this.idempotencyRepository = idempotencyRepository;
        this.redisIdempotencyService = redisIdempotencyService;
        this.stuckIdempotencyCounter = Counter.builder("idempotency.stuck.count")
                .description("Number of stuck idempotency keys transitioned to FAILED")
                .register(meterRegistry);
    }

    @Scheduled(fixedDelay = 60000) // Run every 1 minute
    @Transactional
    public void sweepStuckIdempotencyKeys() {
        if (!schedulersEnabled) {
            log.debug("IdempotencySweepScheduler is disabled by config.");
            return;
        }
        log.info("Running stuck idempotency keys sweep task...");
        LocalDateTime threshold = LocalDateTime.now().minusMinutes(stuckTimeoutMinutes);
        List<Idempotency> stuckKeys = idempotencyRepository.findByStatusAndCreatedAtBefore(
                IdempotencyStatus.PROCESSING, threshold);

        if (stuckKeys.isEmpty()) {
            return;
        }

        log.info("Found {} stuck idempotency keys to fail", stuckKeys.size());

        for (Idempotency key : stuckKeys) {
            // Check if there really is no corresponding Order (just to be safe)
            if (key.getOrderId() == null) {
                log.warn("Failing stuck idempotency key: {} for user: {}", key.getIdempotencyKey(), key.getUserId());
                key.setStatus(IdempotencyStatus.FAILED);
                idempotencyRepository.save(key);
                stuckIdempotencyCounter.increment();

                // Synchronize release/update to Redis
                try {
                    redisIdempotencyService.saveIdempotency(
                            key.getUserId(),
                            key.getIdempotencyKey(),
                            IdempotencyStatus.FAILED.name(),
                            null,
                            null,
                            300L // Keep failed snapshot for 5 mins
                    );
                } catch (Exception e) {
                    log.error("Failed to update Redis cache for stuck idempotency key: {}", key.getIdempotencyKey(), e);
                }
            }
        }
    }
}
