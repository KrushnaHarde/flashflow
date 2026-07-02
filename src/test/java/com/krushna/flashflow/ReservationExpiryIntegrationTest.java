package com.krushna.flashflow;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.krushna.flashflow.common.OutboxEvent;
import com.krushna.flashflow.common.OutboxEventRepository;
import com.krushna.flashflow.common.OutboxStatus;
import com.krushna.flashflow.inventory.Inventory;
import com.krushna.flashflow.inventory.InventoryRepository;
import com.krushna.flashflow.inventory.redis.RedisInventoryService;
import com.krushna.flashflow.inventory.redis.RedisReservationService;
import com.krushna.flashflow.reservation.Reservation;
import com.krushna.flashflow.reservation.ReservationRepository;
import com.krushna.flashflow.reservation.ReservationStatus;
import com.krushna.flashflow.reservation.ReservationExpiryService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.connection.ReactiveRedisConnectionFactory;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

@SpringBootTest
@ActiveProfiles("test")
public class ReservationExpiryIntegrationTest {

    @Autowired
    private ReservationExpiryService reservationExpiryService;

    @Autowired
    private ReservationRepository reservationRepository;

    @Autowired
    private InventoryRepository inventoryRepository;

    @Autowired
    private OutboxEventRepository outboxEventRepository;

    @MockitoBean
    private RedisConnectionFactory redisConnectionFactory;

    @MockitoBean
    private ReactiveRedisConnectionFactory reactiveRedisConnectionFactory;

    @MockitoBean
    private RedisInventoryService redisInventoryService;

    @MockitoBean
    private RedisReservationService redisReservationService;

    private final ObjectMapper objectMapper = new ObjectMapper()
            .registerModule(new com.fasterxml.jackson.datatype.jsr310.JavaTimeModule());

    @BeforeEach
    void setUp() {
        Mockito.reset(redisInventoryService, redisReservationService);
        reservationRepository.deleteAll();
        inventoryRepository.deleteAll();
        outboxEventRepository.deleteAll();
    }

    @Test
    void testReservationExpirySuccess() throws Exception {
        UUID productId = UUID.randomUUID();
        UUID reservationId = UUID.randomUUID();

        // 1. Setup expired active reservation in DB
        Reservation expiredReservation = Reservation.builder()
                .reservationId(reservationId)
                .userId(UUID.randomUUID())
                .productId(productId)
                .quantity(5)
                .unitPrice(new BigDecimal("10.00"))
                .totalAmount(new BigDecimal("50.00"))
                .status(ReservationStatus.ACTIVE)
                .expiresAt(LocalDateTime.now().minusMinutes(1)) // Expired 1 min ago
                .build();
        reservationRepository.save(expiredReservation);

        // 2. Setup inventory in DB
        Inventory inventory = Inventory.builder()
                .productId(productId)
                .totalStock(10)
                .availableStock(5)
                .reservedStock(5)
                .build();
        inventoryRepository.save(inventory);

        // Act: Run reservation expiry service
        reservationExpiryService.expireReservations();

        // Assert: Reservation status transitions to EXPIRED
        Reservation updatedReservation = reservationRepository.findById(reservationId).orElse(null);
        assertNotNull(updatedReservation);
        assertEquals(ReservationStatus.EXPIRED, updatedReservation.getStatus());

        // Assert: DB inventory is released back to availableStock
        Inventory updatedInventory = inventoryRepository.findById(productId).orElse(null);
        assertNotNull(updatedInventory);
        assertEquals(10, updatedInventory.getAvailableStock());
        assertEquals(0, updatedInventory.getReservedStock());

        // Assert: Outbox event created
        List<OutboxEvent> outboxEvents = outboxEventRepository.findAll();
        assertEquals(1, outboxEvents.size());
        OutboxEvent outboxEvent = outboxEvents.get(0);
        assertEquals("RESERVATION", outboxEvent.getAggregateType());
        assertEquals(reservationId, outboxEvent.getAggregateId());
        assertEquals("RESERVATION_EXPIRED", outboxEvent.getEventType());
        assertEquals(OutboxStatus.PENDING, outboxEvent.getStatus());
    }

    @Test
    void testNoActionForValidActiveReservation() {
        UUID productId = UUID.randomUUID();
        UUID reservationId = UUID.randomUUID();

        // 1. Setup active reservation expiring in the future (5 minutes from now)
        Reservation validReservation = Reservation.builder()
                .reservationId(reservationId)
                .userId(UUID.randomUUID())
                .productId(productId)
                .quantity(5)
                .unitPrice(new BigDecimal("10.00"))
                .totalAmount(new BigDecimal("50.00"))
                .status(ReservationStatus.ACTIVE)
                .expiresAt(LocalDateTime.now().plusMinutes(5))
                .build();
        reservationRepository.save(validReservation);

        // 2. Setup inventory
        Inventory inventory = Inventory.builder()
                .productId(productId)
                .totalStock(10)
                .availableStock(5)
                .reservedStock(5)
                .build();
        inventoryRepository.save(inventory);

        // Act: Run expiration
        reservationExpiryService.expireReservations();

        // Assert: Reservation remains ACTIVE
        Reservation updatedReservation = reservationRepository.findById(reservationId).orElse(null);
        assertNotNull(updatedReservation);
        assertEquals(ReservationStatus.ACTIVE, updatedReservation.getStatus());

        // Assert: DB inventory remains unchanged
        Inventory updatedInventory = inventoryRepository.findById(productId).orElse(null);
        assertNotNull(updatedInventory);
        assertEquals(5, updatedInventory.getAvailableStock());
        assertEquals(5, updatedInventory.getReservedStock());

        // Assert: No outbox event is created
        List<OutboxEvent> outboxEvents = outboxEventRepository.findAll();
        assertTrue(outboxEvents.isEmpty());
    }

    @Test
    void testNoActionForAlreadyExpiredOrCancelledReservations() {
        UUID productId = UUID.randomUUID();
        UUID resId1 = UUID.randomUUID();
        UUID resId2 = UUID.randomUUID();

        // 1. Already EXPIRED reservation
        Reservation expiredRes = Reservation.builder()
                .reservationId(resId1)
                .userId(UUID.randomUUID())
                .productId(productId)
                .quantity(5)
                .unitPrice(new BigDecimal("10.00"))
                .totalAmount(new BigDecimal("50.00"))
                .status(ReservationStatus.EXPIRED)
                .expiresAt(LocalDateTime.now().minusMinutes(5))
                .build();

        // 2. Already CANCELLED reservation
        Reservation cancelledRes = Reservation.builder()
                .reservationId(resId2)
                .userId(UUID.randomUUID())
                .productId(productId)
                .quantity(3)
                .unitPrice(new BigDecimal("10.00"))
                .totalAmount(new BigDecimal("30.00"))
                .status(ReservationStatus.CANCELLED)
                .expiresAt(LocalDateTime.now().minusMinutes(5))
                .build();

        reservationRepository.saveAll(List.of(expiredRes, cancelledRes));

        // Act: Run expiration
        reservationExpiryService.expireReservations();

        // Assert: No outbox event is created
        List<OutboxEvent> outboxEvents = outboxEventRepository.findAll();
        assertTrue(outboxEvents.isEmpty());
    }
}
