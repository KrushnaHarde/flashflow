package com.krushna.flashflow;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.krushna.flashflow.common.*;
import com.krushna.flashflow.inventory.Inventory;
import com.krushna.flashflow.inventory.InventoryRepository;
import com.krushna.flashflow.inventory.redis.RedisInventoryService;
import com.krushna.flashflow.inventory.redis.RedisReservationService;
import com.krushna.flashflow.order.Order;
import com.krushna.flashflow.order.OrderRepository;
import com.krushna.flashflow.payment.Payment;
import com.krushna.flashflow.payment.PaymentRepository;
import com.krushna.flashflow.payment.kafka.PaymentRequestedConsumer;
import com.krushna.flashflow.reservation.Reservation;
import com.krushna.flashflow.reservation.ReservationRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.connection.ReactiveRedisConnectionFactory;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

@SpringBootTest
@ActiveProfiles("test")
public class OutboxPatternIntegrationTest {

    @Autowired
    private OutboxService outboxService;

    @Autowired
    private OutboxPublisherScheduler outboxPublisherScheduler;

    @Autowired
    private PaymentRequestedConsumer paymentRequestedConsumer;

    @Autowired
    private OutboxEventRepository outboxEventRepository;

    @Autowired
    private PaymentRepository paymentRepository;

    @Autowired
    private OrderRepository orderRepository;

    @Autowired
    private ReservationRepository reservationRepository;

    @Autowired
    private InventoryRepository inventoryRepository;

    @MockitoBean
    private RedisConnectionFactory redisConnectionFactory;

    @MockitoBean
    private ReactiveRedisConnectionFactory reactiveRedisConnectionFactory;

    @MockitoBean
    private RedisInventoryService redisInventoryService;

    @MockitoBean
    private RedisReservationService redisReservationService;

    @Autowired
    private KafkaTemplate<String, String> mockKafkaTemplate;

    private final ObjectMapper objectMapper = new ObjectMapper()
            .registerModule(new com.fasterxml.jackson.datatype.jsr310.JavaTimeModule());

    @BeforeEach
    void setUp() {
        // Reset mock
        Mockito.reset(mockKafkaTemplate);
        
        // Default return for mock KafkaTemplate
        when(mockKafkaTemplate.send(anyString(), anyString(), anyString()))
                .thenReturn(CompletableFuture.completedFuture(null));

        outboxEventRepository.deleteAll();
        paymentRepository.deleteAll();
        orderRepository.deleteAll();
        reservationRepository.deleteAll();
        inventoryRepository.deleteAll();
    }

    @Test
    void testOutboxPublishAndPaymentFulfillmentSuccess() throws Exception {
        UUID orderId = UUID.randomUUID();
        UUID reservationId = UUID.randomUUID();
        
        Order order = Order.builder()
                .orderId(orderId)
                .userId(UUID.randomUUID())
                .productId(UUID.randomUUID())
                .reservationId(reservationId)
                .quantity(2)
                .unitPrice(new BigDecimal("150.00"))
                .totalAmount(new BigDecimal("300.00"))
                .status("CREATED")
                .build();
        
        orderRepository.save(order);

        Payment payment = Payment.builder()
                .paymentId(UUID.randomUUID())
                .orderId(orderId)
                .amount(new BigDecimal("300.00"))
                .status("PENDING")
                .build();
        
        paymentRepository.save(payment);

        OutboxEvent outboxEvent = OutboxEvent.builder()
                .eventId(UUID.randomUUID())
                .aggregateType("ORDER")
                .aggregateId(orderId)
                .eventType("ORDER_CREATED")
                .payload(objectMapper.writeValueAsString(order))
                .status("PENDING")
                .retryCount(0)
                .build();
        
        outboxEventRepository.save(outboxEvent);

        // 1. Run outbox publisher scheduler
        outboxPublisherScheduler.publishPendingEvents();

        // Assert outbox is marked SENT and published to Kafka
        OutboxEvent processedEvent = outboxEventRepository.findById(outboxEvent.getEventId()).orElse(null);
        assertNotNull(processedEvent);
        assertEquals("SENT", processedEvent.getStatus());
        verify(mockKafkaTemplate).send(eq("flashflow.payments"), eq(orderId.toString()), anyString());

        // 2. Simulate consumer processing
        paymentRequestedConsumer.consume(objectMapper.writeValueAsString(order));

        // Assert updates in DB
        Payment finalPayment = paymentRepository.findById(payment.getPaymentId()).orElse(null);
        assertNotNull(finalPayment);
        assertEquals("SUCCESS", finalPayment.getStatus());

        Order finalOrder = orderRepository.findById(orderId).orElse(null);
        assertNotNull(finalOrder);
        assertEquals("CONFIRMED", finalOrder.getStatus());
    }

    @Test
    void testOutboxPublishAndPaymentFulfillmentFailureWithStockRelease() throws Exception {
        UUID orderId = UUID.randomUUID();
        UUID reservationId = UUID.randomUUID();
        UUID productId = UUID.randomUUID();

        Order order = Order.builder()
                .orderId(orderId)
                .userId(UUID.randomUUID())
                .productId(productId)
                .reservationId(reservationId)
                .quantity(5)
                .unitPrice(new BigDecimal("12000.00"))
                .totalAmount(new BigDecimal("60000.00")) // Exceeds 50000 mock limit
                .status("CREATED")
                .build();

        orderRepository.save(order);

        Payment payment = Payment.builder()
                .paymentId(UUID.randomUUID())
                .orderId(orderId)
                .amount(new BigDecimal("60000.00"))
                .status("PENDING")
                .build();

        paymentRepository.save(payment);

        Reservation reservation = Reservation.builder()
                .reservationId(reservationId)
                .userId(order.getUserId())
                .productId(productId)
                .quantity(5)
                .unitPrice(new BigDecimal("12000.00"))
                .totalAmount(new BigDecimal("60000.00"))
                .status("CONFIRMED")
                .expiresAt(LocalDateTime.now().plusMinutes(5))
                .build();

        reservationRepository.save(reservation);

        Inventory inventory = Inventory.builder()
                .productId(productId)
                .totalStock(100)
                .availableStock(90)
                .reservedStock(10)
                .build();

        inventoryRepository.save(inventory);

        // 1. Process payment (which will fail due to amount > 50000)
        paymentRequestedConsumer.consume(objectMapper.writeValueAsString(order));

        // Assert payment and order marked FAILED
        Payment finalPayment = paymentRepository.findById(payment.getPaymentId()).orElse(null);
        assertNotNull(finalPayment);
        assertEquals("FAILED", finalPayment.getStatus());

        Order finalOrder = orderRepository.findById(orderId).orElse(null);
        assertNotNull(finalOrder);
        assertEquals("FAILED", finalOrder.getStatus());

        // Assert Reservation updated to CANCELLED
        Reservation finalReservation = reservationRepository.findById(reservationId).orElse(null);
        assertNotNull(finalReservation);
        assertEquals("CANCELLED", finalReservation.getStatus());

        // Assert Inventory stock released: availableStock increases, reservedStock decreases
        Inventory finalInventory = inventoryRepository.findById(productId).orElse(null);
        assertNotNull(finalInventory);
        assertEquals(95, finalInventory.getAvailableStock());
        assertEquals(5, finalInventory.getReservedStock());
    }

    @Test
    void testOutboxRetriesAndFailedState() {
        // Mock KafkaTemplate to fail publishing
        when(mockKafkaTemplate.send(anyString(), anyString(), anyString()))
                .thenThrow(new RuntimeException("Kafka connection lost"));

        OutboxEvent outboxEvent = OutboxEvent.builder()
                .eventId(UUID.randomUUID())
                .aggregateType("ORDER")
                .aggregateId(UUID.randomUUID())
                .eventType("ORDER_CREATED")
                .payload("{}")
                .status("PENDING")
                .retryCount(0)
                .build();

        outboxEventRepository.save(outboxEvent);

        // Execute scheduler 3 times
        outboxPublisherScheduler.publishPendingEvents();
        outboxPublisherScheduler.publishPendingEvents();
        outboxPublisherScheduler.publishPendingEvents();

        // Event should now be FAILED
        OutboxEvent failedEvent = outboxEventRepository.findById(outboxEvent.getEventId()).orElse(null);
        assertNotNull(failedEvent);
        assertEquals("FAILED", failedEvent.getStatus());
        assertEquals(3, failedEvent.getRetryCount());
    }
}
