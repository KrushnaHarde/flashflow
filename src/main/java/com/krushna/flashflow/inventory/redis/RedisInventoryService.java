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
public class RedisInventoryService {

    private final RedisTemplate<String, Object> redisTemplate;
    private StringRedisTemplate stringRedisTemplate;

    private static final String STOCK_KEY_PREFIX = "inventory:stock:";

    @PostConstruct
    public void init() {
        this.stringRedisTemplate = new StringRedisTemplate(redisTemplate.getConnectionFactory());
    }

    public void setStock(UUID productId, int stock) {
        stringRedisTemplate.opsForValue().set(STOCK_KEY_PREFIX + productId, String.valueOf(stock));
    }

    public Integer getStock(UUID productId) {
        String value = stringRedisTemplate.opsForValue().get(STOCK_KEY_PREFIX + productId);
        return value != null ? Integer.parseInt(value) : null;
    }

    public boolean reserveStock(UUID productId, int quantity) {
        String key = STOCK_KEY_PREFIX + productId;
        
        // Lua script to atomically check and decrement stock if sufficient
        String luaScript = 
            "local stock = redis.call('get', KEYS[1]) " +
            "if not stock then " +
            "    return -1 " +
            "end " +
            "stock = tonumber(stock) " +
            "local qty = tonumber(ARGV[1]) " +
            "if stock >= qty then " +
            "    redis.call('decrby', KEYS[1], qty) " +
            "    return 1 " +
            "else " +
            "    return 0 " +
            "end";

        DefaultRedisScript<Long> redisScript = new DefaultRedisScript<>(luaScript, Long.class);
        Long result = stringRedisTemplate.execute(redisScript, Collections.singletonList(key), String.valueOf(quantity));
        
        // Return true if stock was successfully reserved (result is 1)
        return result != null && result == 1;
    }

    public void releaseStock(UUID productId, int quantity) {
        String key = STOCK_KEY_PREFIX + productId;
        stringRedisTemplate.opsForValue().increment(key, quantity);
    }
}
