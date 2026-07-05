package com.krushna.flashflow.inventory.redis;

import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.util.UUID;
import java.util.concurrent.TimeUnit;

@Service
@RequiredArgsConstructor
public class RedisReservationService {

    private final RedisTemplate<String, Object> redisTemplate;
    private StringRedisTemplate stringRedisTemplate;

    private static final String RESERVATION_KEY_PREFIX = "reservation:";

    @PostConstruct
    public void init() {
        this.stringRedisTemplate = new StringRedisTemplate(redisTemplate.getConnectionFactory());
    }

    public void saveReservation(UUID reservationId, String status, long ttlSeconds) {
        stringRedisTemplate.opsForValue().set(
            RESERVATION_KEY_PREFIX + reservationId,
            status,
            ttlSeconds,
            TimeUnit.SECONDS
        );
    }

    public String getReservationStatus(UUID reservationId) {
        return stringRedisTemplate.opsForValue().get(RESERVATION_KEY_PREFIX + reservationId);
    }

    public void confirmReservation(UUID reservationId) {
        String key = RESERVATION_KEY_PREFIX + reservationId;
        Long expire = stringRedisTemplate.getExpire(key, TimeUnit.SECONDS);
        if (expire != null && expire > 0) {
            stringRedisTemplate.opsForValue().set(key, "CONFIRMED", expire, TimeUnit.SECONDS);
        } else {
            stringRedisTemplate.opsForValue().set(key, "CONFIRMED");
        }
    }
}
