package com.krushna.flashflow.inventory;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
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
@Tag(name = "Inventory", description = "Endpoints for managing stock levels and product inventory")
public class InventoryController {

    private final InventoryService inventoryService;

    @PostMapping("/admin/inventory/{productId}")
    @Operation(summary = "Add product stock (Admin only)", description = "Increments available and total stock count for a specific product catalog item.")
    public ResponseEntity<Inventory> addStock(
            @PathVariable UUID productId,
            @RequestBody AddStockRequest request) {
        log.info("Received request to add stock for product ID: {}", productId);
        if (request == null || request.getQuantity() == null || request.getQuantity() <= 0) {
            throw new IllegalArgumentException("Quantity must be greater than zero");
        }
        Inventory updatedInventory = inventoryService.addStock(productId, request.getQuantity());
        log.info("Successfully updated inventory for product ID: {}. Total stock: {}, Available stock: {}", 
                productId, updatedInventory.getTotalStock(), updatedInventory.getAvailableStock());
        return ResponseEntity.ok(updatedInventory);
    }
}
