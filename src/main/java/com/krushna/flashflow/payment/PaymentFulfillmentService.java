package com.krushna.flashflow.payment;

import com.krushna.flashflow.inventory.Inventory;
import com.krushna.flashflow.inventory.InventoryRepository;
import com.krushna.flashflow.inventory.redis.RedisInventoryService;
import com.krushna.flashflow.inventory.redis.RedisReservationService;
import com.krushna.flashflow.order.Order;
import com.krushna.flashflow.order.OrderRepository;
import com.krushna.flashflow.reservation.Reservation;
import com.krushna.flashflow.reservation.ReservationRepository;
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

    private final PaymentService paymentService;
    private final RedisInventoryService redisInventoryService;
    private final RedisReservationService redisReservationService;

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

        if (!"PENDING".equals(payment.getStatus())) {
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

        if ("SUCCESS".equals(result)) {
            payment.setStatus("SUCCESS");
            dbOrder.setStatus("CONFIRMED");
            paymentRepository.save(payment);
            orderRepository.save(dbOrder);
            log.info("Payment succeeded. Order {} status set to CONFIRMED", orderId);
        } else {
            payment.setStatus("FAILED");
            dbOrder.setStatus("FAILED");
            paymentRepository.save(payment);
            orderRepository.save(dbOrder);
            log.warn("Payment failed. Order {} status set to FAILED", orderId);

            // Release Stock & Cancel Reservation
            UUID reservationId = dbOrder.getReservationId();
            Reservation reservation = reservationRepository.findById(reservationId).orElse(null);
            if (reservation != null && "CONFIRMED".equals(reservation.getStatus())) {
                // Change reservation status to CANCELLED in DB
                reservation.setStatus("CANCELLED");
                reservationRepository.save(reservation);
                log.info("Reservation {} status updated to CANCELLED", reservationId);

                // Release stock in DB: availableStock += qty, reservedStock -= qty
                Inventory inventory = inventoryRepository.findById(dbOrder.getProductId()).orElse(null);
                if (inventory != null) {
                    inventory.setAvailableStock(inventory.getAvailableStock() + dbOrder.getQuantity());
                    inventory.setReservedStock(inventory.getReservedStock() - dbOrder.getQuantity());
                    inventoryRepository.save(inventory);
                    log.info("Released stock in DB for product: {}. Increased availableStock and decreased reservedStock by {}", 
                            dbOrder.getProductId(), dbOrder.getQuantity());

                    // Sync to Redis post-commit
                    if (TransactionSynchronizationManager.isSynchronizationActive()) {
                        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                            @Override
                            public void afterCommit() {
                                log.info("Fulfillment failed transaction committed. Syncing releases to Redis...");
                                try {
                                    redisInventoryService.setStock(dbOrder.getProductId(), inventory.getAvailableStock());
                                    redisReservationService.saveReservation(reservationId, "CANCELLED", 300L);
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
