package com.krushna.flashflow.inventory.redis;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.util.UUID;
import java.util.concurrent.TimeUnit;

@Service
public class RedisIdempotencyService {

    private final RedisTemplate<String, Object> redisTemplate;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private StringRedisTemplate stringRedisTemplate;

    private static final String IDEMPOTENCY_KEY_PREFIX = "idempotency:";

    public RedisIdempotencyService(RedisTemplate<String, Object> redisTemplate) {
        this.redisTemplate = redisTemplate;
    }

    @PostConstruct
    public void init() {
        this.stringRedisTemplate = new StringRedisTemplate(redisTemplate.getConnectionFactory());
    }

    public static class IdempotencyValue {
        private String status;
        private String responseSnapshot;
        private UUID orderId;

        public IdempotencyValue() {}

        public IdempotencyValue(String status, String responseSnapshot, UUID orderId) {
            this.status = status;
            this.responseSnapshot = responseSnapshot;
            this.orderId = orderId;
        }

        public String getStatus() { return status; }
        public void setStatus(String status) { this.status = status; }

        public String getResponseSnapshot() { return responseSnapshot; }
        public void setResponseSnapshot(String responseSnapshot) { this.responseSnapshot = responseSnapshot; }

        public UUID getOrderId() { return orderId; }
        public void setOrderId(UUID orderId) { this.orderId = orderId; }
    }

    public void saveIdempotency(String key, String status, String responseSnapshot, UUID orderId, long ttlSeconds) {
        IdempotencyValue value = new IdempotencyValue(status, responseSnapshot, orderId);
        try {
            String json = objectMapper.writeValueAsString(value);
            stringRedisTemplate.opsForValue().set(
                IDEMPOTENCY_KEY_PREFIX + key,
                json,
                ttlSeconds,
                TimeUnit.SECONDS
            );
        } catch (JsonProcessingException e) {
            throw new RuntimeException("Failed to serialize idempotency value", e);
        }
    }

    public IdempotencyValue getIdempotency(String key) {
        String json = stringRedisTemplate.opsForValue().get(IDEMPOTENCY_KEY_PREFIX + key);
        if (json == null) {
            return null;
        }
        try {
            return objectMapper.readValue(json, IdempotencyValue.class);
        } catch (JsonProcessingException e) {
            throw new RuntimeException("Failed to deserialize idempotency value", e);
        }
    }
}
