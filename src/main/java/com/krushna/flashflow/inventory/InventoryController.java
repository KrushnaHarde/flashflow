package com.krushna.flashflow.inventory;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequiredArgsConstructor
@Slf4j
public class InventoryController {

    private final InventoryService inventoryService;

    @PostMapping("/admin/inventory/{productId}")
    public ResponseEntity<?> addStock(
            @PathVariable UUID productId,
            @RequestBody AddStockRequest request) {
        log.info("Received request to add stock for product ID: {}", productId);
        try {
            if (request == null || request.getQuantity() == null || request.getQuantity() <= 0) {
                log.warn("Invalid stock add request for product ID: {}. Quantity must be positive.", productId);
                return ResponseEntity.badRequest().body("Quantity must be greater than zero");
            }
            Inventory updatedInventory = inventoryService.addStock(productId, request.getQuantity());
            log.info("Successfully updated inventory for product ID: {}. Total stock: {}, Available stock: {}", 
                    productId, updatedInventory.getTotalStock(), updatedInventory.getAvailableStock());
            return ResponseEntity.ok(updatedInventory);
        } catch (IllegalArgumentException e) {
            log.warn("Product or inventory not found when adding stock for product ID: {}. Error: {}", productId, e.getMessage());
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(e.getMessage());
        }
    }
}
