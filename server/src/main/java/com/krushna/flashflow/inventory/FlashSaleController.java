package com.krushna.flashflow.inventory;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;

@RestController
@RequiredArgsConstructor
@Slf4j
@Tag(name = "Flash Sales", description = "Endpoints for scheduling and managing flash sales")
public class FlashSaleController {

    private final FlashSaleService flashSaleService;

    @GetMapping("/sales")
    @Operation(summary = "Get all scheduled sales", description = "Retrieves a list of all flash sales in the system.")
    public ResponseEntity<List<FlashSale>> getAllSales() {
        log.info("Request received to fetch all flash sales");
        return ResponseEntity.ok(flashSaleService.getAllSales());
    }

    @GetMapping("/sales/{id}")
    @Operation(summary = "Get sale by ID", description = "Retrieves details of a single flash sale by its unique identifier.")
    public ResponseEntity<FlashSale> getSaleById(@PathVariable UUID id) {
        log.info("Request received to fetch flash sale ID: {}", id);
        return ResponseEntity.ok(flashSaleService.getSaleById(id));
    }

    @PostMapping("/admin/sales")
    @Operation(summary = "Create flash sale (Admin only)", description = "Creates and registers a new flash sale schedule with associated products.")
    public ResponseEntity<FlashSale> createSale(@RequestBody FlashSale sale) {
        log.info("Request received to create flash sale: {}", sale.getName());
        FlashSale created = flashSaleService.createSale(sale);
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    @PutMapping("/admin/sales/{id}")
    @Operation(summary = "Update flash sale details (Admin only)", description = "Updates details and product associations of an existing flash sale.")
    public ResponseEntity<FlashSale> updateSale(@PathVariable UUID id, @RequestBody FlashSale sale) {
        log.info("Request received to update flash sale ID: {}", id);
        FlashSale updated = flashSaleService.updateSale(id, sale);
        return ResponseEntity.ok(updated);
    }

    @DeleteMapping("/admin/sales/{id}")
    @Operation(summary = "Delete flash sale (Admin only)", description = "Deletes a scheduled flash sale from the system.")
    public ResponseEntity<Void> deleteSale(@PathVariable UUID id) {
        log.info("Request received to delete flash sale ID: {}", id);
        flashSaleService.deleteSale(id);
        return ResponseEntity.noContent().build();
    }
}
