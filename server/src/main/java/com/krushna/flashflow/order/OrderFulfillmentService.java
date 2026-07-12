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
import com.krushna.flashflow.payment.PaymentStatus;
import com.krushna.flashflow.reservation.Reservation;
import com.krushna.flashflow.reservation.ReservationRepository;
import com.krushna.flashflow.reservation.ReservationStatus;
import com.krushna.flashflow.common.OutboxStatus;
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

    private final ObjectMapper objectMapper;

    @Transactional
    public void fulfillOrder(OrderRequestedEvent event) {
        log.info("Fulfilling order for reservation: {}", event.getReservationId());

        // 1. Check if Reservation already exists in DB (idempotency guard)
        Reservation existingReservation = reservationRepository.findById(event.getReservationId())
                .orElse(null);
        if (existingReservation != null) {
            log.info("Reservation {} already exists in DB with status: {}. Skipping fulfillment.", 
                    event.getReservationId(), existingReservation.getStatus());
            return;
        }

        // 2. Check if Order already exists in DB
        if (orderRepository.existsByReservationId(event.getReservationId())) {
            log.info("Order already exists for reservation: {}. Skipping.", event.getReservationId());
            return;
        }

        // 3. Create and Save Reservation directly as CONFIRMED
        Reservation reservation = Reservation.builder()
                .reservationId(event.getReservationId())
                .userId(event.getUserId())
                .productId(event.getProductId())
                .quantity(event.getQuantity())
                .unitPrice(event.getUnitPrice())
                .totalAmount(event.getTotalAmount())
                .status(ReservationStatus.CONFIRMED)
                .expiresAt(event.getExpiresAt())
                .build();
        reservationRepository.save(reservation);
        log.info("Saved Reservation {} in DB with status CONFIRMED", event.getReservationId());

        // 4. Create and Save Order
        UUID orderId = UUID.randomUUID();
        Order order = Order.builder()
                .orderId(orderId)
                .userId(event.getUserId())
                .productId(event.getProductId())
                .reservationId(event.getReservationId())
                .quantity(event.getQuantity())
                .unitPrice(event.getUnitPrice())
                .totalAmount(event.getTotalAmount())
                .status(OrderStatus.CREATED)
                .build();
        orderRepository.save(order);
        log.info("Created Order {} for reservation: {}", orderId, event.getReservationId());

        // 5. Create and Save Payment (PENDING status)
        UUID paymentId = UUID.randomUUID();
        Payment payment = Payment.builder()
                .paymentId(paymentId)
                .orderId(orderId)
                .amount(order.getTotalAmount())
                .status(PaymentStatus.PENDING)
                .build();
        paymentRepository.save(payment);
        log.info("Created Payment {} in PENDING state for Order {}", paymentId, orderId);

        // 6. Update DB Inventory
        Inventory inventory = inventoryRepository.findById(event.getProductId())
                .orElseThrow(() -> new IllegalArgumentException("Inventory not found for product: " + event.getProductId()));

        if (inventory.getAvailableStock() < event.getQuantity()) {
            throw new IllegalArgumentException("Insufficient stock available in DB for product: " + event.getProductId());
        }
        inventory.setAvailableStock(inventory.getAvailableStock() - event.getQuantity());
        inventory.setTotalStock(inventory.getTotalStock() - event.getQuantity());
        inventoryRepository.save(inventory);
        log.info("Updated DB Inventory for product: {}. Decremented totalStock and availableStock by {}", 
                event.getProductId(), event.getQuantity());

        // 7. Insert OutboxEvent for PAYMENT relay
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
                .status(OutboxStatus.PENDING)
                .retryCount(0)
                .build();
        outboxEventRepository.save(outboxEvent);
        log.info("Inserted OutboxEvent for Order {}", orderId);

        // 8. Insert Idempotency record with status ORDER_CREATED
        PurchaseResponseDto responseDto = PurchaseResponseDto.builder()
                .reservationId(event.getReservationId())
                .status("ORDER_CREATED")
                .totalAmount(event.getTotalAmount())
                .expiresAt(event.getExpiresAt())
                .build();

        String responseJson;
        try {
            responseJson = objectMapper.writeValueAsString(responseDto);
        } catch (Exception e) {
            throw new RuntimeException("Failed to serialize response snapshot", e);
        }

        Idempotency idempotency = Idempotency.builder()
                .idempotencyKey(event.getIdempotencyKey())
                .userId(event.getUserId())
                .productId(event.getProductId())
                .status(IdempotencyStatus.ORDER_CREATED)
                .orderId(orderId)
                .responseSnapshot(responseJson)
                .build();
        idempotencyRepository.save(idempotency);
        log.info("Saved Idempotency record in DB with status ORDER_CREATED for user: {}, key: {}", 
                event.getUserId(), event.getIdempotencyKey());

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
                                .status("ORDER_CREATED")
                                .totalAmount(event.getTotalAmount())
                                .build();
                        String responseJson = objectMapper.writeValueAsString(responseDto);
                        redisIdempotencyService.saveIdempotency(
                                event.getUserId(),
                                event.getIdempotencyKey(),
                                IdempotencyStatus.ORDER_CREATED.name(),
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
