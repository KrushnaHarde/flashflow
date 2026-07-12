package com.krushna.flashflow.order;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.krushna.flashflow.inventory.Inventory;
import com.krushna.flashflow.inventory.InventoryService;
import com.krushna.flashflow.inventory.Product;
import com.krushna.flashflow.inventory.ProductService;
import com.krushna.flashflow.inventory.ProductStatus;
import com.krushna.flashflow.inventory.FlashSaleService;
import com.krushna.flashflow.inventory.redis.RateLimiterService;
import com.krushna.flashflow.inventory.redis.RedisIdempotencyService;
import com.krushna.flashflow.inventory.redis.RedisInventoryService;
import com.krushna.flashflow.inventory.redis.RedisReservationService;
import com.krushna.flashflow.order.event.OrderRequestedEvent;
import com.krushna.flashflow.reservation.Reservation;
import com.krushna.flashflow.reservation.ReservationRepository;
import com.krushna.flashflow.reservation.ReservationStatus;
import com.krushna.flashflow.user.User;
import com.krushna.flashflow.user.UserRepository;
import com.krushna.flashflow.common.OutboxEvent;
import com.krushna.flashflow.common.OutboxEventRepository;
import com.krushna.flashflow.common.OutboxStatus;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.kafka.core.KafkaTemplate;

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
    private final OutboxEventRepository outboxEventRepository;
    private final TransactionTemplate transactionTemplate;
    private final FlashSaleService flashSaleService;
    private final StringRedisTemplate stringRedisTemplate;
    private final KafkaTemplate<String, String> kafkaTemplate;

    private final ObjectMapper objectMapper = new ObjectMapper()
            .registerModule(new com.fasterxml.jackson.datatype.jsr310.JavaTimeModule());

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

        // 1. Idempotency Check (Redis only for the hot-path)
        RedisIdempotencyService.IdempotencyValue cached = redisIdempotencyService.getIdempotency(userId, idempotencyKey);
        if (cached != null) {
            log.info("Idempotency match found in Redis for user: {}, key: {}", userId, idempotencyKey);
            if ("PROCESSING".equals(cached.getStatus()) || "ORDER_CREATED".equals(cached.getStatus())) {
                throw new IllegalStateException("Request is currently being processed.");
            } else if ("COMPLETED".equals(cached.getStatus())) {
                try {
                    return objectMapper.readValue(cached.getResponseSnapshot(), PurchaseResponseDto.class);
                } catch (Exception e) {
                    log.error("Failed to deserialize cached idempotency response", e);
                }
            }
        }

        // 2. Rate Limiting Check (Redis)
        boolean allowed = rateLimiterService.rateLimit(userId, rateLimitLimit, rateLimitWindow);
        if (!allowed) {
            log.warn("Rate limit exceeded for user: {}", userId);
            throw new IllegalStateException("Rate limit exceeded. Please try again later.");
        }

        // 3. Validate User - Cache enabled state in Redis
        String userEnabledKey = "user:" + userId + ":enabled";
        String cachedEnabled = stringRedisTemplate.opsForValue().get(userEnabledKey);
        boolean enabled;
        if (cachedEnabled != null) {
            enabled = Boolean.parseBoolean(cachedEnabled);
        } else {
            User user = userRepository.findById(userId)
                    .orElseThrow(() -> new IllegalArgumentException("User not found: " + userId));
            enabled = user.isEnabled();
            stringRedisTemplate.opsForValue().set(userEnabledKey, String.valueOf(enabled), 10, java.util.concurrent.TimeUnit.MINUTES);
        }
        if (!enabled) {
            log.warn("User {} is disabled", userId);
            throw new IllegalArgumentException("User is disabled");
        }

        // 4. Validate Product & Quantity - Cache price/status metadata in Redis
        if (quantity == null || quantity <= 0) {
            throw new IllegalArgumentException("Quantity must be greater than zero");
        }

        String productMetaKey = "product:" + productId + ":meta";
        String cachedMeta = stringRedisTemplate.opsForValue().get(productMetaKey);
        BigDecimal price;
        String statusStr;
        boolean inAnySale;

        if (cachedMeta != null) {
            String[] parts = cachedMeta.split(":");
            price = new BigDecimal(parts[0]);
            statusStr = parts[1];
            inAnySale = Boolean.parseBoolean(parts[2]);
        } else {
            Product product = productService.getProductById(productId);
            price = product.getPrice();
            statusStr = product.getStatus().name();
            inAnySale = flashSaleService.isProductInAnySale(productId);
            stringRedisTemplate.opsForValue().set(productMetaKey, price.toString() + ":" + statusStr + ":" + inAnySale, 10, java.util.concurrent.TimeUnit.MINUTES);
        }

        if (!"ACTIVE".equals(statusStr)) {
            log.warn("Product {} is not active. Status: {}", productId, statusStr);
            throw new IllegalArgumentException("Product is not active");
        }

        if (!flashSaleService.isProductOnActiveSale(productId)) {
            if (!inAnySale) {
                log.warn("Product {} is not associated with any flash sale", productId);
                throw new IllegalArgumentException("Product is not part of any flash sale");
            } else {
                log.warn("Product {} sale has not started or is not active", productId);
                throw new IllegalArgumentException("Flash sale is not currently active for this product");
            }
        }

        // 5. Redis Stock Check & Lazy Load (using setStockIfAbsent SETNX guarded set)
        Integer stockInRedis = redisInventoryService.getStock(productId);
        if (stockInRedis == null) {
            log.warn("Redis inventory stock not found for product: {}. Performing lazy load from DB...", productId);
            try {
                Inventory dbInventory = inventoryService.getInventoryByProductId(productId);
                redisInventoryService.setStockIfAbsent(productId, dbInventory.getAvailableStock());
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
        BigDecimal totalAmount = price.multiply(new BigDecimal(quantity));
        final LocalDateTime expiresAt = LocalDateTime.now().plusMinutes(5);

        // Create the event object to serialize and send directly to Kafka
        OrderRequestedEvent event = OrderRequestedEvent.builder()
                .reservationId(reservationId)
                .userId(userId)
                .productId(productId)
                .quantity(quantity)
                .totalAmount(totalAmount)
                .unitPrice(price)
                .expiresAt(expiresAt)
                .idempotencyKey(idempotencyKey)
                .build();

        String eventPayload;
        try {
            eventPayload = objectMapper.writeValueAsString(event);
        } catch (Exception e) {
            redisInventoryService.releaseStock(productId, quantity);
            throw new RuntimeException("Failed to serialize OrderRequestedEvent for Kafka", e);
        }

        try {
            // Asynchronously send to Kafka without blocking .get()
            kafkaTemplate.send("flashflow.orders", reservationId.toString(), eventPayload);
        } catch (Exception e) {
            log.error("Failed to publish OrderRequestedEvent to Kafka for reservation {}. Releasing stock in Redis...", reservationId, e);
            redisInventoryService.releaseStock(productId, quantity);
            throw new RuntimeException("Kafka publish failed", e);
        }

        // 7. Write Reservation & Idempotency status to Redis
        redisReservationService.saveReservation(reservationId, ReservationStatus.ACTIVE.name(), 300L);
        redisIdempotencyService.saveIdempotency(userId, idempotencyKey, IdempotencyStatus.PROCESSING.name(), null, null, 86400L);

        log.info("Purchase reservation successfully created: {}", reservationId);

        return PurchaseResponseDto.builder()
                .reservationId(reservationId)
                .status(ReservationStatus.ACTIVE.name())
                .totalAmount(totalAmount)
                .expiresAt(expiresAt)
                .build();
    }
}
