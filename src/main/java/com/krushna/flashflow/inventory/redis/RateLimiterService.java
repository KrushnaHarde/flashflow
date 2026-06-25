package com.krushna.flashflow.inventory.redis;

import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Service;

import java.util.Collections;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class RateLimiterService {

    private final RedisTemplate<String, Object> redisTemplate;
    private StringRedisTemplate stringRedisTemplate;

    private static final String RATELIMIT_KEY_PREFIX = "ratelimit:";

    @PostConstruct
    public void init() {
        this.stringRedisTemplate = new StringRedisTemplate(redisTemplate.getConnectionFactory());
    }

    public boolean rateLimit(String userId, int limit, int windowSeconds) {
        String key = RATELIMIT_KEY_PREFIX + userId;

        // Lua script to atomically increment and set expire if it's the first request
        String luaScript =
            "local key = KEYS[1] " +
            "local limit = tonumber(ARGV[1]) " +
            "local window = tonumber(ARGV[2]) " +
            "local current = redis.call('get', key) " +
            "if current and tonumber(current) >= limit then " +
            "    return 0 " +
            "else " +
            "    local newVal = redis.call('incr', key) " +
            "    if tonumber(newVal) == 1 then " +
            "        redis.call('expire', key, window) " +
            "    end " +
            "    return 1 " +
            "end";

        DefaultRedisScript<Long> redisScript = new DefaultRedisScript<>(luaScript, Long.class);
        Long result = stringRedisTemplate.execute(
            redisScript,
            Collections.singletonList(key),
            String.valueOf(limit),
            String.valueOf(windowSeconds)
        );

        return result != null && result == 1;
    }

    public boolean rateLimit(UUID userId, int limit, int windowSeconds) {
        return rateLimit(userId.toString(), limit, windowSeconds);
    }
}
