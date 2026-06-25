package com.krushna.flashflow.inventory;

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
public class ProductController {

    private final ProductService productService;

    @GetMapping("/products")
    public ResponseEntity<List<Product>> getAllProducts() {
        log.info("Request received to list all products");
        return ResponseEntity.ok(productService.getAllProducts());
    }

    @GetMapping("/products/{id}")
    public ResponseEntity<?> getProductById(@PathVariable UUID id) {
        log.info("Request received to fetch product by ID: {}", id);
        try {
            Product product = productService.getProductById(id);
            log.info("Successfully fetched product ID: {}", id);
            return ResponseEntity.ok(product);
        } catch (IllegalArgumentException e) {
            log.warn("Product fetching failed for ID {}: {}", id, e.getMessage());
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(e.getMessage());
        }
    }

    @PostMapping("/admin/products")
    public ResponseEntity<Product> createProduct(@RequestBody Product product) {
        log.info("Request received to create product: {}", product.getName());
        Product created = productService.createProduct(product);
        return ResponseEntity.status(HttpStatus.CREATED).body(created);
    }

    @PutMapping("/admin/products/{id}")
    public ResponseEntity<?> updateProduct(@PathVariable UUID id, @RequestBody Product product) {
        log.info("Request received to update product ID: {}", id);
        try {
            Product updated = productService.updateProduct(id, product);
            return ResponseEntity.ok(updated);
        } catch (IllegalArgumentException e) {
            log.warn("Product update failed for ID {}: {}", id, e.getMessage());
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(e.getMessage());
        }
    }

    @PatchMapping("/admin/products/{id}/activate")
    public ResponseEntity<?> activateProduct(@PathVariable UUID id) {
        log.info("Request received to activate product ID: {}", id);
        try {
            Product activated = productService.activateProduct(id);
            return ResponseEntity.ok(activated);
        } catch (IllegalArgumentException e) {
            log.warn("Product activation failed for ID {}: {}", id, e.getMessage());
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(e.getMessage());
        }
    }

    @PatchMapping("/admin/products/{id}/deactivate")
    public ResponseEntity<?> deactivateProduct(@PathVariable UUID id) {
        log.info("Request received to deactivate product ID: {}", id);
        try {
            Product deactivated = productService.deactivateProduct(id);
            return ResponseEntity.ok(deactivated);
        } catch (IllegalArgumentException e) {
            log.warn("Product deactivation failed for ID {}: {}", id, e.getMessage());
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(e.getMessage());
        }
    }
}
