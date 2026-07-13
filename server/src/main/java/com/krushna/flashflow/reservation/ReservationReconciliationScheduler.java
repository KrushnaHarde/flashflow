package com.krushna.flashflow.reservation;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.krushna.flashflow.inventory.redis.RedisInventoryService;
import com.krushna.flashflow.inventory.redis.RedisReservationService;
import com.krushna.flashflow.order.event.OrderRequestedEvent;
import io.micrometer.core.instrument.Counter;
import io.micrometer.core.instrument.MeterRegistry;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import jakarta.annotation.PostConstruct;
import java.time.LocalDateTime;
import java.time.temporal.ChronoUnit;
import java.util.Set;
import java.util.UUID;

@Component
@EnableScheduling
@Slf4j
@RequiredArgsConstructor
public class ReservationReconciliationScheduler {

    private final StringRedisTemplate stringRedisTemplate;
    private final ReservationRepository reservationRepository;
    private final RedisInventoryService redisInventoryService;
    private final RedisReservationService redisReservationService;
    private final KafkaTemplate<String, String> kafkaTemplate;
    private final MeterRegistry meterRegistry;

    private final ObjectMapper objectMapper = new ObjectMapper()
            .registerModule(new com.fasterxml.jackson.datatype.jsr310.JavaTimeModule());

    private Counter reconciledCounter;
    private Counter reconciliationFailedCounter;

    @Value("${flashflow.schedulers.enabled:true}")
    private boolean schedulersEnabled;

    @PostConstruct
    public void init() {
        this.reconciledCounter = meterRegistry.counter("reservations.reconciled.count");
        this.reconciliationFailedCounter = meterRegistry.counter("reservations.reconciliation.failed.count");
    }

    @Scheduled(fixedDelay = 30000)
    public void reconcileOrphanReservations() {
        if (!schedulersEnabled) {
            log.debug("ReservationReconciliationScheduler is disabled by config.");
            return;
        }

        log.info("Running reservation reconciliation sweep...");
        Set<String> keys = stringRedisTemplate.keys("reservation:*:meta");
        if (keys == null || keys.isEmpty()) {
            return;
        }

        for (String key : keys) {
            try {
                String metaJson = stringRedisTemplate.opsForValue().get(key);
                if (metaJson == null) {
                    continue;
                }

                RedisReservationMeta meta = objectMapper.readValue(metaJson, RedisReservationMeta.class);
                UUID reservationId = meta.getReservationId();

                // Check Redis status
                String redisStatus = redisReservationService.getReservationStatus(reservationId);
                if (redisStatus == null || "CONFIRMED".equals(redisStatus) || "EXPIRED".equals(redisStatus)) {
                    // Cleanup meta key since status is already terminal
                    stringRedisTemplate.delete(key);
                    continue;
                }

                // If ACTIVE, check if age exceeds 15 seconds grace period
                long ageSeconds = ChronoUnit.SECONDS.between(meta.getCreatedAt(), LocalDateTime.now());
                if (ageSeconds > 15) {
                    // Cross check against Postgres
                    boolean existsInDb = reservationRepository.existsById(reservationId);
                    if (existsInDb) {
                        log.info("Reservation {} already exists in DB. Syncing Redis status to CONFIRMED.", reservationId);
                        redisReservationService.saveReservation(reservationId, ReservationStatus.CONFIRMED.name(), 300L);
                        stringRedisTemplate.delete(key);
                    } else {
                        // Orphan detected!
                        int nextRetry = meta.getRetryCount() + 1;
                        if (nextRetry <= 3) {
                            log.warn("Orphaned reservation detected: {}. Attempting reconciliation, retry #{}...", reservationId, nextRetry);
                            
                            OrderRequestedEvent event = OrderRequestedEvent.builder()
                                    .reservationId(reservationId)
                                    .userId(meta.getUserId())
                                    .productId(meta.getProductId())
                                    .quantity(meta.getQuantity())
                                    .totalAmount(meta.getTotalAmount())
                                    .unitPrice(meta.getUnitPrice())
                                    .expiresAt(meta.getExpiresAt())
                                    .idempotencyKey(meta.getIdempotencyKey())
                                    .traceId(meta.getTraceId())
                                    .build();

                            String eventPayload = objectMapper.writeValueAsString(event);

                            // Re-publish to Kafka
                            org.apache.kafka.clients.producer.ProducerRecord<String, String> record =
                                    new org.apache.kafka.clients.producer.ProducerRecord<>("flashflow.orders", reservationId.toString(), eventPayload);
                            record.headers().add("traceId", meta.getTraceId().getBytes(java.nio.charset.StandardCharsets.UTF_8));
                            kafkaTemplate.send(record);

                            // Update meta
                            meta.setRetryCount(nextRetry);
                            meta.setCreatedAt(LocalDateTime.now()); // Reset timestamp for next check window
                            stringRedisTemplate.opsForValue().set(key, objectMapper.writeValueAsString(meta), 300L, java.util.concurrent.TimeUnit.SECONDS);
                            
                            reconciledCounter.increment();
                        } else {
                            log.error("Reservation {} failed reconciliation after 3 attempts. Expiring reservation and releasing Redis stock.", reservationId);
                            
                            redisReservationService.saveReservation(reservationId, ReservationStatus.EXPIRED.name(), 300L);
                            stringRedisTemplate.delete(key);
                            redisInventoryService.releaseStock(meta.getProductId(), meta.getQuantity());
                            
                            reconciliationFailedCounter.increment();
                        }
                    }
                }
            } catch (Exception e) {
                log.error("Failed to process reconciliation for Redis meta key: {}", key, e);
            }
        }
    }
}
