package com.krushna.flashflow.inventory.redis;

import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

import java.util.Set;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Slf4j
public class RedisFlashSaleService {

    private final RedisTemplate<String, Object> redisTemplate;
    private StringRedisTemplate stringRedisTemplate;

    @PostConstruct
    public void init() {
        this.stringRedisTemplate = new StringRedisTemplate(redisTemplate.getConnectionFactory());
    }

    private static final String ACTIVE_SALE_PRODUCTS_KEY = "active-sale-products";

    public boolean isProductOnActiveSale(UUID productId) {
        Boolean member = stringRedisTemplate.opsForSet().isMember(ACTIVE_SALE_PRODUCTS_KEY, productId.toString());
        return member != null && member;
    }

    public void refreshActiveProducts(Set<UUID> productIds) {
        log.info("Refreshing active sale products in Redis. Count: {}", productIds.size());
        stringRedisTemplate.delete(ACTIVE_SALE_PRODUCTS_KEY);
        if (productIds != null && !productIds.isEmpty()) {
            String[] ids = productIds.stream().map(UUID::toString).toArray(String[]::new);
            stringRedisTemplate.opsForSet().add(ACTIVE_SALE_PRODUCTS_KEY, ids);
        }
    }
}
