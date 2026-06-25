package com.krushna.flashflow.inventory;

import com.krushna.flashflow.inventory.redis.RedisInventoryService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.UUID;

@Service
@RequiredArgsConstructor
public class InventoryService {

    private final InventoryRepository inventoryRepository;
    private final ProductService productService;
    private final RedisInventoryService redisInventoryService;
    private final TransactionTemplate transactionTemplate;

    public Inventory addStock(UUID productId, Integer quantity) {
        Inventory savedInventory = transactionTemplate.execute(status -> {
            // Validate product exists first
            productService.getProductById(productId);

            Inventory inventory = inventoryRepository.findById(productId)
                    .orElse(null);

            if (inventory == null) {
                inventory = Inventory.builder()
                        .productId(productId)
                        .totalStock(quantity)
                        .availableStock(quantity)
                        .reservedStock(0)
                        .build();
            } else {
                inventory.setTotalStock(inventory.getTotalStock() + quantity);
                inventory.setAvailableStock(inventory.getAvailableStock() + quantity);
            }

            return inventoryRepository.save(inventory);
        });

        // Sync to Redis outside of DB transaction
        if (savedInventory != null) {
            redisInventoryService.setStock(productId, savedInventory.getAvailableStock());
        }

        return savedInventory;
    }

    public Inventory getInventoryByProductId(UUID productId) {
        return inventoryRepository.findById(productId)
                .orElseThrow(() -> new IllegalArgumentException("Inventory not found for product id: " + productId));
    }
}
