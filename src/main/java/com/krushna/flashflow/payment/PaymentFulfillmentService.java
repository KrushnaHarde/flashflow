package com.krushna.flashflow.payment;

import com.krushna.flashflow.inventory.Inventory;
import com.krushna.flashflow.inventory.InventoryRepository;
import com.krushna.flashflow.inventory.redis.RedisInventoryService;
import com.krushna.flashflow.inventory.redis.RedisReservationService;
import com.krushna.flashflow.order.Order;
import com.krushna.flashflow.order.OrderRepository;
import com.krushna.flashflow.order.OrderStatus;
import com.krushna.flashflow.reservation.Reservation;
import com.krushna.flashflow.reservation.ReservationRepository;
import com.krushna.flashflow.reservation.ReservationStatus;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.krushna.flashflow.order.Idempotency;
import com.krushna.flashflow.order.IdempotencyRepository;
import com.krushna.flashflow.order.IdempotencyStatus;
import com.krushna.flashflow.order.PurchaseResponseDto;
import com.krushna.flashflow.inventory.redis.RedisIdempotencyService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import java.util.UUID;

@Service
@Slf4j
@RequiredArgsConstructor
public class PaymentFulfillmentService {

    private final PaymentRepository paymentRepository;
    private final OrderRepository orderRepository;
    private final ReservationRepository reservationRepository;
    private final InventoryRepository inventoryRepository;
    private final IdempotencyRepository idempotencyRepository;

    private final PaymentService paymentService;
    private final RedisInventoryService redisInventoryService;
    private final RedisReservationService redisReservationService;
    private final RedisIdempotencyService redisIdempotencyService;
    private final ObjectMapper objectMapper = new ObjectMapper()
            .registerModule(new com.fasterxml.jackson.datatype.jsr310.JavaTimeModule());

    @Transactional
    public void fulfillPayment(Order order) {
        UUID orderId = order.getOrderId();
        log.info("Fulfilling payment for order: {}", orderId);

        // 1. Fetch Payment by orderId
        Payment payment = paymentRepository.findByOrderId(orderId)
                .orElse(null);
        if (payment == null) {
            log.warn("Payment record not found for order: {}", orderId);
            return;
        }

        if (payment.getStatus() != PaymentStatus.PENDING) {
            log.info("Payment for order {} is already processed. Current status: {}", orderId, payment.getStatus());
            return;
        }

        // 2. Fetch Order from DB to ensure state consistency
        Order dbOrder = orderRepository.findById(orderId).orElse(null);
        if (dbOrder == null) {
            log.warn("Order {} not found in database", orderId);
            return;
        }

        // 3. Process payment via PaymentService
        String result = paymentService.processPayment(payment.getAmount());

        // 4. Update Idempotency snapshot based on result
        Idempotency idempotency = idempotencyRepository.findByOrderId(orderId).orElse(null);
        String responseJson = null;
        if (idempotency != null) {
            String outcome = "SUCCESS".equals(result) ? "CONFIRMED" : "FAILED";
            PurchaseResponseDto responseDto = PurchaseResponseDto.builder()
                    .reservationId(dbOrder.getReservationId())
                    .status(outcome)
                    .totalAmount(dbOrder.getTotalAmount())
                    .build();
            try {
                responseJson = objectMapper.writeValueAsString(responseDto);
                idempotency.setStatus(IdempotencyStatus.COMPLETED);
                idempotency.setResponseSnapshot(responseJson);
                idempotencyRepository.save(idempotency);
                log.info("Updated DB Idempotency to COMPLETED with snapshot status: {}", outcome);
            } catch (Exception e) {
                log.error("Failed to serialize idempotency response snapshot", e);
            }
        }

        if ("SUCCESS".equals(result)) {
            payment.setStatus(PaymentStatus.SUCCESS);
            dbOrder.setStatus(OrderStatus.CONFIRMED);
            paymentRepository.save(payment);
            orderRepository.save(dbOrder);
            log.info("Payment succeeded. Order {} status set to CONFIRMED", orderId);

            // Sync idempotency to Redis post-commit
            if (idempotency != null && responseJson != null) {
                final String finalResponseJson = responseJson;
                final Idempotency finalIdempotency = idempotency;
                if (TransactionSynchronizationManager.isSynchronizationActive()) {
                    TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                        @Override
                        public void afterCommit() {
                            try {
                                redisIdempotencyService.saveIdempotency(
                                        finalIdempotency.getUserId(),
                                        finalIdempotency.getIdempotencyKey(),
                                        IdempotencyStatus.COMPLETED.name(),
                                        finalResponseJson,
                                        orderId,
                                        86400L
                                );
                                log.info("Successfully updated Redis states for successful payment");
                            } catch (Exception e) {
                                log.error("Failed to sync Redis state post-commit on payment success", e);
                            }
                        }
                    });
                }
            }
        } else {
            payment.setStatus(PaymentStatus.FAILED);
            dbOrder.setStatus(OrderStatus.FAILED);
            paymentRepository.save(payment);
            orderRepository.save(dbOrder);
            log.warn("Payment failed. Order {} status set to FAILED", orderId);

            // Release Stock & Cancel Reservation
            UUID reservationId = dbOrder.getReservationId();
            Reservation reservation = reservationRepository.findById(reservationId).orElse(null);
            if (reservation != null && reservation.getStatus() == ReservationStatus.CONFIRMED) {
                // Change reservation status to CANCELLED in DB
                reservation.setStatus(ReservationStatus.CANCELLED);
                reservationRepository.save(reservation);
                log.info("Reservation {} status updated to CANCELLED", reservationId);

                // Release stock in DB: availableStock += qty, totalStock += qty (reservedStock: DO NOT TOUCH)
                Inventory inventory = inventoryRepository.findById(dbOrder.getProductId()).orElse(null);
                if (inventory != null) {
                    inventory.setAvailableStock(inventory.getAvailableStock() + dbOrder.getQuantity());
                    inventory.setTotalStock(inventory.getTotalStock() + dbOrder.getQuantity());
                    inventoryRepository.save(inventory);
                    log.info("Released stock in DB for product: {}. Increased availableStock and totalStock by {}", 
                            dbOrder.getProductId(), dbOrder.getQuantity());

                    // Sync to Redis post-commit
                    if (TransactionSynchronizationManager.isSynchronizationActive()) {
                        final String finalResponseJson = responseJson;
                        final Idempotency finalIdempotency = idempotency;
                        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                            @Override
                            public void afterCommit() {
                                log.info("Fulfillment failed transaction committed. Syncing releases to Redis...");
                                try {
                                    redisInventoryService.setStock(dbOrder.getProductId(), inventory.getAvailableStock());
                                    redisReservationService.saveReservation(reservationId, ReservationStatus.CANCELLED.name(), 300L);
                                    
                                    if (finalIdempotency != null && finalResponseJson != null) {
                                        redisIdempotencyService.saveIdempotency(
                                                finalIdempotency.getUserId(),
                                                finalIdempotency.getIdempotencyKey(),
                                                IdempotencyStatus.COMPLETED.name(),
                                                finalResponseJson,
                                                orderId,
                                                86400L
                                        );
                                    }
                                    log.info("Successfully updated Redis state after payment failure release");
                                } catch (Exception e) {
                                    log.error("Failed to sync Redis state post-commit on payment failure", e);
                                }
                            }
                        });
                    }
                }
            }
        }
    }
}
