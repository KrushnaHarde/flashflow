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
@Tag(name = "Products", description = "Endpoints for viewing and managing catalog products")
public class ProductController {

    private final ProductService productService;

    @GetMapping("/products")
    @Operation(summary = "Get all products", description = "Retrieves a list of all products in the database catalog.")
    public ResponseEntity<List<Product>> getAllProducts() {
        log.info("Request received to list all products");
        return ResponseEntity.ok(productService.getAllProducts());
    }

    @GetMapping("/products/{id}")
    @Operation(summary = "Get product by ID", description = "Retrieves a single product details by its unique identifier.")
    public ResponseEntity<Product> getProductById(@PathVariable UUID id) {
        log.info("Request received to fetch product by ID: {}", id);
        Product product = productService.getProductById(id);
        log.info("Successfully fetched product ID: {}", id);
        return ResponseEntity.ok(product);
    }

    @PostMapping("/admin/products")
    @Operation(summary = "Create product (Admin only)", description = "Creates and registers a new product in the catalog system. Defaults status to INACTIVE.")
    public ResponseEntity<Product> createProduct(@RequestBody Product product) {
        log.info("Request received to create product: {}", product.getName());
        Product created = productService.createProduct(product);
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    @PutMapping("/admin/products/{id}")
    @Operation(summary = "Update product details (Admin only)", description = "Updates fields of an existing product in the catalog.")
    public ResponseEntity<Product> updateProduct(@PathVariable UUID id, @RequestBody Product product) {
        log.info("Request received to update product ID: {}", id);
        Product updated = productService.updateProduct(id, product);
        return ResponseEntity.ok(updated);
    }

    @PatchMapping("/admin/products/{id}/activate")
    @Operation(summary = "Activate product (Admin only)", description = "Transitions product status to ACTIVE so it can be booked by users.")
    public ResponseEntity<Product> activateProduct(@PathVariable UUID id) {
        log.info("Request received to activate product ID: {}", id);
        Product activated = productService.activateProduct(id);
        return ResponseEntity.ok(activated);
    }

    @PatchMapping("/admin/products/{id}/deactivate")
    @Operation(summary = "Deactivate product (Admin only)", description = "Transitions product status to INACTIVE so users cannot book it.")
    public ResponseEntity<Product> deactivateProduct(@PathVariable UUID id) {
        log.info("Request received to deactivate product ID: {}", id);
        Product deactivated = productService.deactivateProduct(id);
        return ResponseEntity.ok(deactivated);
    }
}
