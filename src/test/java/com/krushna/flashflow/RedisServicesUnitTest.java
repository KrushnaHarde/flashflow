package com.krushna.flashflow;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.krushna.flashflow.inventory.redis.RateLimiterService;
import com.krushna.flashflow.inventory.redis.RedisIdempotencyService;
import com.krushna.flashflow.inventory.redis.RedisInventoryService;
import com.krushna.flashflow.inventory.redis.RedisReservationService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

public class RedisServicesUnitTest {

    private RedisTemplate<String, Object> redisTemplate;
    private StringRedisTemplate stringRedisTemplate;
    private ValueOperations<String, String> valueOperations;
    private ObjectMapper objectMapper;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUp() {
        redisTemplate = mock(RedisTemplate.class);
        stringRedisTemplate = mock(StringRedisTemplate.class);
        valueOperations = mock(ValueOperations.class);
        objectMapper = new ObjectMapper();

        RedisConnectionFactory connectionFactory = mock(RedisConnectionFactory.class);
        when(redisTemplate.getConnectionFactory()).thenReturn(connectionFactory);
        when(stringRedisTemplate.opsForValue()).thenReturn(valueOperations);
    }

    @Test
    void testRedisInventoryService() {
        RedisInventoryService service = new RedisInventoryService(redisTemplate);
        ReflectionTestUtils.setField(service, "stringRedisTemplate", stringRedisTemplate);

        UUID productId = UUID.randomUUID();
        String expectedKey = "inventory:stock:" + productId;

        // Test setStock
        service.setStock(productId, 50);
        verify(valueOperations).set(eq(expectedKey), eq("50"));

        // Test getStock
        when(valueOperations.get(eq(expectedKey))).thenReturn("50");
        Integer stock = service.getStock(productId);
        assertEquals(50, stock);

        // Test releaseStock
        service.releaseStock(productId, 10);
        verify(valueOperations).increment(eq(expectedKey), eq(10L));

        // Test reserveStock (Lua script)
        when(stringRedisTemplate.execute(any(RedisScript.class), anyList(), any())).thenReturn(1L);
        boolean reserved = service.reserveStock(productId, 5);
        assertTrue(reserved);
        verify(stringRedisTemplate).execute(any(RedisScript.class), eq(List.of(expectedKey)), eq("5"));
    }

    @Test
    void testRedisReservationService() {
        RedisReservationService service = new RedisReservationService(redisTemplate);
        ReflectionTestUtils.setField(service, "stringRedisTemplate", stringRedisTemplate);

        UUID reservationId = UUID.randomUUID();
        String expectedKey = "reservation:" + reservationId;

        // Test saveReservation
        service.saveReservation(reservationId, "ACTIVE", 300L);
        verify(valueOperations).set(eq(expectedKey), eq("ACTIVE"), eq(300L), eq(TimeUnit.SECONDS));

        // Test getReservationStatus
        when(valueOperations.get(eq(expectedKey))).thenReturn("ACTIVE");
        String status = service.getReservationStatus(reservationId);
        assertEquals("ACTIVE", status);

        // Test confirmReservation
        when(stringRedisTemplate.getExpire(eq(expectedKey), eq(TimeUnit.SECONDS))).thenReturn(250L);
        service.confirmReservation(reservationId);
        verify(valueOperations).set(eq(expectedKey), eq("CONFIRMED"), eq(250L), eq(TimeUnit.SECONDS));
    }

    @Test
    void testRedisIdempotencyService() {
        RedisIdempotencyService service = new RedisIdempotencyService(redisTemplate);
        ReflectionTestUtils.setField(service, "stringRedisTemplate", stringRedisTemplate);

        String idempotencyKey = "test-idempotency-key";
        String expectedKey = "idempotency:" + idempotencyKey;
        UUID orderId = UUID.randomUUID();

        // Test saveIdempotency
        service.saveIdempotency(idempotencyKey, "COMPLETED", "response-data", orderId, 600L);
        
        ArgumentCaptor<String> jsonCaptor = ArgumentCaptor.forClass(String.class);
        verify(valueOperations).set(eq(expectedKey), jsonCaptor.capture(), eq(600L), eq(TimeUnit.SECONDS));

        String capturedJson = jsonCaptor.getValue();
        assertTrue(capturedJson.contains("COMPLETED"));
        assertTrue(capturedJson.contains("response-data"));
        assertTrue(capturedJson.contains(orderId.toString()));

        // Test getIdempotency
        when(valueOperations.get(eq(expectedKey))).thenReturn(capturedJson);
        RedisIdempotencyService.IdempotencyValue cached = service.getIdempotency(idempotencyKey);
        assertNotNull(cached);
        assertEquals("COMPLETED", cached.getStatus());
        assertEquals("response-data", cached.getResponseSnapshot());
        assertEquals(orderId, cached.getOrderId());
    }

    @Test
    void testRateLimiterService() {
        RateLimiterService service = new RateLimiterService(redisTemplate);
        ReflectionTestUtils.setField(service, "stringRedisTemplate", stringRedisTemplate);

        UUID userId = UUID.randomUUID();
        String expectedKey = "ratelimit:" + userId;

        when(stringRedisTemplate.execute(any(RedisScript.class), anyList(), any(), any())).thenReturn(1L);
        boolean allowed = service.rateLimit(userId, 10, 60);
        assertTrue(allowed);
        verify(stringRedisTemplate).execute(any(RedisScript.class), eq(List.of(expectedKey)), eq("10"), eq("60"));
    }
}
