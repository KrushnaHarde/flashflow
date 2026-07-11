package com.krushna.flashflow.reservation;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.krushna.flashflow.common.OutboxEvent;
import com.krushna.flashflow.common.OutboxEventRepository;
import com.krushna.flashflow.common.OutboxStatus;
import com.krushna.flashflow.inventory.Inventory;
import com.krushna.flashflow.inventory.InventoryRepository;
import com.krushna.flashflow.inventory.redis.RedisInventoryService;
import com.krushna.flashflow.inventory.redis.RedisReservationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Counter;
import jakarta.annotation.PostConstruct;

@Service
@Slf4j
@RequiredArgsConstructor
public class ReservationExpiryService {

    private final ReservationRepository reservationRepository;
    private final InventoryRepository inventoryRepository;
    private final OutboxEventRepository outboxEventRepository;
    
    private final RedisInventoryService redisInventoryService;
    private final RedisReservationService redisReservationService;
    
    private final ObjectMapper objectMapper;
    private final MeterRegistry meterRegistry;
    private Counter expiredCounter;

    @PostConstruct
    public void init() {
        this.expiredCounter = meterRegistry.counter("reservations.expired.count");
    }

    @Transactional
    public void expireReservations() {
        LocalDateTime now = LocalDateTime.now();
        List<Reservation> expiredReservations = reservationRepository.findByStatusAndExpiresAtBefore(
                ReservationStatus.ACTIVE, now);

        if (expiredReservations.isEmpty()) {
            return;
        }

        log.info("Found {} expired active reservations to process", expiredReservations.size());

        for (Reservation reservation : expiredReservations) {
            expiredCounter.increment();
            UUID reservationId = reservation.getReservationId();
            UUID productId = reservation.getProductId();
            int quantity = reservation.getQuantity();

            log.info("Expiring reservation: {}, Product: {}, Quantity: {}", reservationId, productId, quantity);

            // 1. Transition Reservation to EXPIRED
            reservation.setStatus(ReservationStatus.EXPIRED);
            reservationRepository.save(reservation);

            // 2. No DB Stock release required as /purchase does not synchronously write to DB inventory.

            // 3. Create OutboxEvent
            String reservationPayload;
            try {
                reservationPayload = objectMapper.writeValueAsString(reservation);
            } catch (Exception e) {
                log.error("Failed to serialize reservation {} for outbox", reservationId, e);
                throw new RuntimeException("Failed to serialize reservation for outbox", e);
            }

            OutboxEvent outboxEvent = OutboxEvent.builder()
                    .eventId(UUID.randomUUID())
                    .aggregateType("RESERVATION")
                    .aggregateId(reservationId)
                    .eventType("RESERVATION_EXPIRED")
                    .payload(reservationPayload)
                    .status(OutboxStatus.PENDING)
                    .retryCount(0)
                    .build();
            outboxEventRepository.save(outboxEvent);
            log.info("Created outbox event RESERVATION_EXPIRED for reservation: {}", reservationId);

            // 4. Redis sync post-commit
            if (TransactionSynchronizationManager.isSynchronizationActive()) {
                TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                    @Override
                    public void afterCommit() {
                        log.info("Reservation expiration transaction committed. Syncing releases to Redis...");
                        try {
                            redisInventoryService.releaseStock(productId, quantity);
                            redisReservationService.saveReservation(reservationId, ReservationStatus.EXPIRED.name(), 300L);
                            log.info("Successfully updated Redis states for expired reservation: {}", reservationId);
                        } catch (Exception e) {
                            log.error("Failed to sync Redis states post-commit for reservation: {}", reservationId, e);
                        }
                    }
                });
            }
        }
    }
}
