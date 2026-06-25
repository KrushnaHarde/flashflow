package com.krushna.flashflow.inventory;

import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequiredArgsConstructor
public class InventoryController {

    private final InventoryService inventoryService;

    @PostMapping("/admin/inventory/{productId}")
    public ResponseEntity<?> addStock(
            @PathVariable UUID productId,
            @RequestBody AddStockRequest request) {
        try {
            if (request == null || request.getQuantity() == null || request.getQuantity() <= 0) {
                return ResponseEntity.badRequest().body("Quantity must be greater than zero");
            }
            Inventory updatedInventory = inventoryService.addStock(productId, request.getQuantity());
            return ResponseEntity.ok(updatedInventory);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(e.getMessage());
        }
    }
}
