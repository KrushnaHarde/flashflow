package com.krushna.flashflow.order;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.krushna.flashflow.inventory.Inventory;
import com.krushna.flashflow.inventory.InventoryService;
import com.krushna.flashflow.inventory.Product;
import com.krushna.flashflow.inventory.ProductService;
import com.krushna.flashflow.inventory.redis.RateLimiterService;
import com.krushna.flashflow.inventory.redis.RedisIdempotencyService;
import com.krushna.flashflow.inventory.redis.RedisInventoryService;
import com.krushna.flashflow.inventory.redis.RedisReservationService;
import com.krushna.flashflow.order.event.OrderRequestedEvent;
import com.krushna.flashflow.order.kafka.OrderEventProducer;
import com.krushna.flashflow.reservation.Reservation;
import com.krushna.flashflow.reservation.ReservationRepository;
import com.krushna.flashflow.user.User;
import com.krushna.flashflow.user.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.Optional;
import java.util.UUID;

@Service
@Slf4j
@RequiredArgsConstructor
public class PurchaseService {

    private final UserRepository userRepository;
    private final ProductService productService;
    private final RedisIdempotencyService redisIdempotencyService;
    private final IdempotencyRepository idempotencyRepository;
    private final RateLimiterService rateLimiterService;
    private final RedisInventoryService redisInventoryService;
    private final InventoryService inventoryService;
    private final ReservationRepository reservationRepository;
    private final RedisReservationService redisReservationService;
    private final OrderEventProducer orderEventProducer;
    private final TransactionTemplate transactionTemplate;

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Value("${flashflow.rate-limit.limit:5}")
    private int rateLimitLimit;

    @Value("${flashflow.rate-limit.window:10}")
    private int rateLimitWindow;

    public PurchaseResponseDto purchase(PurchaseRequestDto request) {
        UUID userId = request.getUserId();
        UUID productId = request.getProductId();
        Integer quantity = request.getQuantity();
        String idempotencyKey = request.getIdempotencyKey();

        log.info("Processing purchase request. User: {}, Product: {}, Quantity: {}, IdempotencyKey: {}", 
                userId, productId, quantity, idempotencyKey);

        // 1. Rate Limiting Check (Redis)
        boolean allowed = rateLimiterService.rateLimit(userId, rateLimitLimit, rateLimitWindow);
        if (!allowed) {
            log.warn("Rate limit exceeded for user: {}", userId);
            throw new IllegalStateException("Rate limit exceeded. Please try again later.");
        }

        // 2. Idempotency Check (Redis & DB)
        // First check Redis
        RedisIdempotencyService.IdempotencyValue cached = redisIdempotencyService.getIdempotency(idempotencyKey);
        if (cached != null) {
            log.info("Idempotency match found in Redis for key: {}", idempotencyKey);
            if ("PROCESSING".equals(cached.getStatus())) {
                throw new IllegalStateException("Request is currently being processed.");
            } else if ("COMPLETED".equals(cached.getStatus())) {
                try {
                    return objectMapper.readValue(cached.getResponseSnapshot(), PurchaseResponseDto.class);
                } catch (Exception e) {
                    log.error("Failed to deserialize cached idempotency response", e);
                }
            }
        }

        // Check DB as fallback
        Optional<Idempotency> dbIdempotency = idempotencyRepository.findById(idempotencyKey);
        if (dbIdempotency.isPresent()) {
            Idempotency imp = dbIdempotency.get();
            log.info("Idempotency match found in DB for key: {}", idempotencyKey);
            if ("PROCESSING".equals(imp.getStatus())) {
                throw new IllegalStateException("Request is currently being processed.");
            } else if ("COMPLETED".equals(imp.getStatus())) {
                try {
                    return objectMapper.readValue(imp.getResponseSnapshot(), PurchaseResponseDto.class);
                } catch (Exception e) {
                    log.error("Failed to deserialize DB idempotency response", e);
                }
            }
        }

        // 3. Validate User
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new IllegalArgumentException("User not found: " + userId));
        if (!user.isEnabled()) {
            log.warn("User {} is disabled", userId);
            throw new IllegalArgumentException("User is disabled");
        }

        // 4. Validate Product & Quantity
        if (quantity == null || quantity <= 0) {
            throw new IllegalArgumentException("Quantity must be greater than zero");
        }
        Product product = productService.getProductById(productId);
        if (!"ACTIVE".equals(product.getStatus())) {
            log.warn("Product {} is not active. Status: {}", productId, product.getStatus());
            throw new IllegalArgumentException("Product is not active");
        }

        // 5. Redis Stock Check & Lazy Load
        Integer stockInRedis = redisInventoryService.getStock(productId);
        if (stockInRedis == null) {
            log.info("Redis inventory stock not found for product: {}. Loading from database...", productId);
            try {
                Inventory dbInventory = inventoryService.getInventoryByProductId(productId);
                redisInventoryService.setStock(productId, dbInventory.getAvailableStock());
            } catch (Exception e) {
                log.warn("Inventory record does not exist in DB for product: {}", productId);
                throw new IllegalArgumentException("Insufficient stock available");
            }
        }

        // 6. Reserve Stock in Redis
        boolean reservedInRedis = redisInventoryService.reserveStock(productId, quantity);
        if (!reservedInRedis) {
            log.warn("Insufficient stock in Redis for product: {}, requested: {}", productId, quantity);
            throw new IllegalArgumentException("Insufficient stock available");
        }

        UUID reservationId = UUID.randomUUID();
        BigDecimal totalAmount = product.getPrice().multiply(new BigDecimal(quantity));

        try {
            // 7. DB Transaction: Create Reservation + DB Inventory update + Idempotency save
            transactionTemplate.execute(status -> {
                // Save idempotency as PROCESSING
                idempotencyRepository.save(Idempotency.builder()
                        .idempotencyKey(idempotencyKey)
                        .userId(userId)
                        .productId(productId)
                        .status("PROCESSING")
                        .build());

                // Update DB Inventory: availableStock decreases, reservedStock increases
                Inventory dbInventory = inventoryService.getInventoryByProductId(productId);
                if (dbInventory.getAvailableStock() < quantity) {
                    throw new IllegalArgumentException("Insufficient stock available");
                }
                dbInventory.setAvailableStock(dbInventory.getAvailableStock() - quantity);
                dbInventory.setReservedStock(dbInventory.getReservedStock() + quantity);

                // Create Reservation
                Reservation reservation = Reservation.builder()
                        .reservationId(reservationId)
                        .userId(userId)
                        .productId(productId)
                        .quantity(quantity)
                        .unitPrice(product.getPrice())
                        .totalAmount(totalAmount)
                        .status("ACTIVE")
                        .expiresAt(LocalDateTime.now().plusMinutes(5))
                        .build();

                reservationRepository.save(reservation);
                return null;
            });
        } catch (Exception e) {
            log.error("Database transaction failed for reservation {}. Releasing stock in Redis...", reservationId, e);
            // Compensating action: Release stock in Redis
            redisInventoryService.releaseStock(productId, quantity);
            throw e;
        }

        // 8. Redis Save Reservation
        redisReservationService.saveReservation(reservationId, "ACTIVE", 300L);

        // Redis save idempotency as PROCESSING
        redisIdempotencyService.saveIdempotency(idempotencyKey, "PROCESSING", null, null, 86400L);

        // 9. Publish Kafka event
        OrderRequestedEvent event = OrderRequestedEvent.builder()
                .reservationId(reservationId)
                .userId(userId)
                .productId(productId)
                .quantity(quantity)
                .totalAmount(totalAmount)
                .idempotencyKey(idempotencyKey)
                .build();

        orderEventProducer.publishOrderRequested(event);

        log.info("Purchase reservation successfully created: {}", reservationId);

        return PurchaseResponseDto.builder()
                .reservationId(reservationId)
                .status("ACTIVE")
                .totalAmount(totalAmount)
                .build();
    }
}
