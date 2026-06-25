package com.krushna.flashflow.order;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.krushna.flashflow.common.OutboxEvent;
import com.krushna.flashflow.common.OutboxEventRepository;
import com.krushna.flashflow.inventory.Inventory;
import com.krushna.flashflow.inventory.InventoryRepository;
import com.krushna.flashflow.inventory.redis.RedisIdempotencyService;
import com.krushna.flashflow.inventory.redis.RedisReservationService;
import com.krushna.flashflow.order.event.OrderRequestedEvent;
import com.krushna.flashflow.payment.Payment;
import com.krushna.flashflow.payment.PaymentRepository;
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
public class OrderFulfillmentService {

    private final ReservationRepository reservationRepository;
    private final OrderRepository orderRepository;
    private final PaymentRepository paymentRepository;
    private final InventoryRepository inventoryRepository;
    private final OutboxEventRepository outboxEventRepository;
    private final IdempotencyRepository idempotencyRepository;

    private final RedisReservationService redisReservationService;
    private final RedisIdempotencyService redisIdempotencyService;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Transactional
    public void fulfillOrder(OrderRequestedEvent event) {
        log.info("Fulfilling order for reservation: {}", event.getReservationId());

        // 1. Validate reservation in DB
        Reservation reservation = reservationRepository.findById(event.getReservationId())
                .orElse(null);
        if (reservation == null) {
            log.warn("Reservation not found in DB: {}", event.getReservationId());
            return;
        }
        if (!"ACTIVE".equals(reservation.getStatus())) {
            log.info("Reservation {} is not ACTIVE. Current status: {}. Skipping fulfillment.", 
                    event.getReservationId(), reservation.getStatus());
            return;
        }

        // 2. Check if Order already exists (idempotency check)
        if (orderRepository.existsByReservationId(event.getReservationId())) {
            log.info("Order already exists for reservation: {}. Skipping.", event.getReservationId());
            return;
        }

        // 3. Create Order
        UUID orderId = UUID.randomUUID();
        Order order = Order.builder()
                .orderId(orderId)
                .userId(event.getUserId())
                .productId(event.getProductId())
                .reservationId(event.getReservationId())
                .quantity(event.getQuantity())
                .unitPrice(reservation.getUnitPrice())
                .totalAmount(event.getTotalAmount())
                .status("CREATED")
                .build();
        orderRepository.save(order);
        log.info("Created Order {} for reservation: {}", orderId, event.getReservationId());

        // 4. Create Payment (PENDING status)
        UUID paymentId = UUID.randomUUID();
        Payment payment = Payment.builder()
                .paymentId(paymentId)
                .orderId(orderId)
                .amount(order.getTotalAmount())
                .status("PENDING")
                .build();
        paymentRepository.save(payment);
        log.info("Created Payment {} in PENDING state for Order {}", paymentId, orderId);

        // 5. Update DB Inventory: availableStock was decremented during reservation.
        //    Now we finalize: decrement reservedStock by quantity, decrement totalStock by quantity.
        Inventory inventory = inventoryRepository.findById(event.getProductId())
                .orElseThrow(() -> new IllegalArgumentException("Inventory not found for product: " + event.getProductId()));

        inventory.setReservedStock(inventory.getReservedStock() - event.getQuantity());
        inventory.setTotalStock(inventory.getTotalStock() - event.getQuantity());
        inventoryRepository.save(inventory);
        log.info("Updated DB Inventory for product: {}. Decremented totalStock and reservedStock by {}", 
                event.getProductId(), event.getQuantity());

        // 6. Insert OutboxEvent
        String orderPayload;
        try {
            orderPayload = objectMapper.writeValueAsString(order);
        } catch (Exception e) {
            throw new RuntimeException("Failed to serialize order for outbox event payload", e);
        }

        OutboxEvent outboxEvent = OutboxEvent.builder()
                .eventId(UUID.randomUUID())
                .aggregateType("ORDER")
                .aggregateId(orderId)
                .eventType("ORDER_CREATED")
                .payload(orderPayload)
                .status("PENDING")
                .retryCount(0)
                .build();
        outboxEventRepository.save(outboxEvent);
        log.info("Inserted OutboxEvent for Order {}", orderId);

        // 7. Update Reservation status to CONFIRMED
        reservation.setStatus("CONFIRMED");
        reservationRepository.save(reservation);
        log.info("Updated DB Reservation status to CONFIRMED for: {}", event.getReservationId());

        // 8. Update DB Idempotency status to COMPLETED
        Idempotency idempotency = idempotencyRepository.findById(event.getIdempotencyKey())
                .orElse(null);
        if (idempotency != null) {
            PurchaseResponseDto responseDto = PurchaseResponseDto.builder()
                    .reservationId(event.getReservationId())
                    .status("CONFIRMED")
                    .totalAmount(event.getTotalAmount())
                    .build();
            try {
                String responseJson = objectMapper.writeValueAsString(responseDto);
                idempotency.setStatus("COMPLETED");
                idempotency.setResponseSnapshot(responseJson);
                idempotency.setOrderId(orderId);
                idempotencyRepository.save(idempotency);
                log.info("Updated DB Idempotency status to COMPLETED for key: {}", event.getIdempotencyKey());
            } catch (Exception e) {
                log.error("Failed to serialize idempotency response snapshot", e);
            }
        }

        // Register transaction synchronization to execute Redis updates AFTER DB transaction commits
        if (TransactionSynchronizationManager.isSynchronizationActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    log.info("Fulfillment DB transaction committed. Syncing states to Redis for reservation: {}", 
                            event.getReservationId());
                    try {
                        // Confirm reservation in Redis
                        redisReservationService.confirmReservation(event.getReservationId());

                        // Update idempotency cache in Redis
                        PurchaseResponseDto responseDto = PurchaseResponseDto.builder()
                                .reservationId(event.getReservationId())
                                .status("CONFIRMED")
                                .totalAmount(event.getTotalAmount())
                                .build();
                        String responseJson = objectMapper.writeValueAsString(responseDto);
                        redisIdempotencyService.saveIdempotency(
                                event.getIdempotencyKey(),
                                "COMPLETED",
                                responseJson,
                                orderId,
                                86400L
                        );
                        log.info("Successfully updated Redis states for reservation: {}", event.getReservationId());
                    } catch (Exception e) {
                        log.error("Error updating Redis states post-commit for reservation: {}", 
                                event.getReservationId(), e);
                    }
                }
            });
        }
    }
}
