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
    private final org.springframework.data.redis.core.StringRedisTemplate stringRedisTemplate;
    private final Counter stuckIdempotencyCounter;
    private final Counter mismatchCounter;

    @Value("${flashflow.idempotency.stuck-timeout-minutes:5}")
    private int stuckTimeoutMinutes;

    @Value("${flashflow.schedulers.enabled:true}")
    private boolean schedulersEnabled;

    public IdempotencySweepScheduler(
            IdempotencyRepository idempotencyRepository,
            RedisIdempotencyService redisIdempotencyService,
            org.springframework.data.redis.core.StringRedisTemplate stringRedisTemplate,
            MeterRegistry meterRegistry) {
        this.idempotencyRepository = idempotencyRepository;
        this.redisIdempotencyService = redisIdempotencyService;
        this.stringRedisTemplate = stringRedisTemplate;
        this.stuckIdempotencyCounter = Counter.builder("idempotency.stuck.count")
                .description("Number of stuck idempotency keys transitioned to FAILED")
                .register(meterRegistry);
        this.mismatchCounter = Counter.builder("idempotency.mismatch.count")
                .description("Number of mismatched idempotency keys between Redis and Postgres")
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

    @Scheduled(fixedDelay = 60000)
    public void crossCheckRedisIdempotency() {
        if (!schedulersEnabled) {
            return;
        }
        log.info("Running idempotency cross-check sweep...");
        java.util.Set<String> keys = stringRedisTemplate.keys("idempotency:*");
        if (keys == null || keys.isEmpty()) {
            return;
        }

        com.fasterxml.jackson.databind.ObjectMapper mapper = new com.fasterxml.jackson.databind.ObjectMapper();

        for (String key : keys) {
            try {
                String[] parts = key.split(":");
                if (parts.length < 3) {
                    continue;
                }
                java.util.UUID userId = java.util.UUID.fromString(parts[1]);
                String idempotencyKey = parts[2];

                String redisValueJson = stringRedisTemplate.opsForValue().get(key);
                if (redisValueJson == null) {
                    continue;
                }

                // Parse status from JSON
                String redisStatus = null;
                try {
                    com.fasterxml.jackson.databind.JsonNode node = mapper.readTree(redisValueJson);
                    if (node.has("status")) {
                        redisStatus = node.get("status").asText();
                    }
                } catch (Exception e) {
                    // ignore parse exception
                }

                if (redisStatus == null) {
                    continue;
                }

                java.util.Optional<Idempotency> dbRecord = idempotencyRepository.findById(new IdempotencyId(idempotencyKey, userId));
                if (!dbRecord.isPresent()) {
                    if ("ORDER_CREATED".equals(redisStatus) || "COMPLETED".equals(redisStatus)) {
                        log.warn("IDEMPOTENCY MISMATCH: Key {} for user {} is marked {} in Redis but not found in Postgres.", idempotencyKey, userId, redisStatus);
                        mismatchCounter.increment();
                    }
                } else {
                    String dbStatus = dbRecord.get().getStatus().name();
                    String normRedis = "ORDER_CREATED".equals(redisStatus) ? "COMPLETED" : redisStatus;
                    String normDb = "ORDER_CREATED".equals(dbStatus) ? "COMPLETED" : dbStatus;

                    if (!normRedis.equals(normDb)) {
                        log.warn("IDEMPOTENCY MISMATCH: Key {} for user {} has status {} in Redis but {} in Postgres.", idempotencyKey, userId, normRedis, normDb);
                        mismatchCounter.increment();
                    }
                }
            } catch (Exception e) {
                // ignore
            }
        }
    }
}
