package com.krushna.flashflow.inventory;

import com.krushna.flashflow.inventory.redis.RedisInventoryService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
@RequiredArgsConstructor
@Slf4j
public class CachePreWarmingLoader {

    private final ProductRepository productRepository;
    private final InventoryRepository inventoryRepository;
    private final RedisInventoryService redisInventoryService;

    @EventListener(ApplicationReadyEvent.class)
    public void warmUpCache() {
        log.info("Pre-warming Redis inventory stock cache for all ACTIVE products...");
        try {
            // Add findByStatus finder if needed, or query all and check
            List<Product> products = productRepository.findAll();
            int count = 0;
            for (Product product : products) {
                if (product.getStatus() == ProductStatus.ACTIVE) {
                    inventoryRepository.findById(product.getProductId()).ifPresent(inventory -> {
                        redisInventoryService.setStock(product.getProductId(), inventory.getAvailableStock());
                        log.info("Pre-warmed product {} stock: {}", product.getProductId(), inventory.getAvailableStock());
                    });
                    count++;
                }
            }
            log.info("Finished pre-warming Redis stock cache for {} active products.", count);
        } catch (Exception e) {
            log.error("Failed to pre-warm Redis inventory stock cache", e);
        }
    }
}
