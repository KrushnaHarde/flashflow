package com.krushna.flashflow.inventory;

import com.krushna.flashflow.inventory.redis.RedisInventoryService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.UUID;

@Service
@RequiredArgsConstructor
@Slf4j
public class InventoryService {

    private final InventoryRepository inventoryRepository;
    private final ProductService productService;
    private final RedisInventoryService redisInventoryService;
    private final TransactionTemplate transactionTemplate;

    public Inventory addStock(UUID productId, Integer quantity) {
        log.info("Request to add {} stock for product ID: {}", quantity, productId);
        Inventory savedInventory = transactionTemplate.execute(status -> {
            // Validate product exists first
            productService.getProductById(productId);

            Inventory inventory = inventoryRepository.findById(productId)
                    .orElse(null);

            if (inventory == null) {
                log.info("No existing inventory found. Creating new inventory for product ID: {}", productId);
                inventory = Inventory.builder()
                        .productId(productId)
                        .totalStock(quantity)
                        .availableStock(quantity)
                        .reservedStock(0)
                        .build();
            } else {
                log.info("Existing inventory found. Total stock was {}, available stock was {}. Incrementing by {}", 
                        inventory.getTotalStock(), inventory.getAvailableStock(), quantity);
                inventory.setTotalStock(inventory.getTotalStock() + quantity);
                inventory.setAvailableStock(inventory.getAvailableStock() + quantity);
            }

            return inventoryRepository.save(inventory);
        });

        // Sync to Redis outside of DB transaction
        if (savedInventory != null) {
            log.info("DB inventory updated successfully. Syncing {} available stock to Redis for product ID: {}", 
                    savedInventory.getAvailableStock(), productId);
            redisInventoryService.setStock(productId, savedInventory.getAvailableStock());
        }

        return savedInventory;
    }

    public Inventory getInventoryByProductId(UUID productId) {
        log.info("Fetching inventory for product ID: {}", productId);
        return inventoryRepository.findById(productId)
                .orElseThrow(() -> {
                    log.warn("Inventory record not found in DB for product ID: {}", productId);
                    return new IllegalArgumentException("Inventory not found for product id: " + productId);
                });
    }
}
