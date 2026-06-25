package com.krushna.flashflow.inventory;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Slf4j
public class ProductService {

    private final ProductRepository productRepository;

    public List<Product> getAllProducts() {
        log.info("Fetching all products from database");
        return productRepository.findAll();
    }

    public Product getProductById(UUID id) {
        log.info("Fetching product by ID: {}", id);
        return productRepository.findById(id)
                .orElseThrow(() -> {
                    log.warn("Product not found with ID: {}", id);
                    return new IllegalArgumentException("Product not found with id: " + id);
                });
    }

    @Transactional
    public Product createProduct(Product product) {
        log.info("Creating a new product: {}", product.getName());
        if (product.getProductId() == null) {
            product.setProductId(UUID.randomUUID());
        }
        if (product.getStatus() == null || product.getStatus().isBlank()) {
            product.setStatus("INACTIVE"); // Default to INACTIVE as per requirement
        }
        Product savedProduct = productRepository.save(product);
        log.info("Successfully created product with ID: {} and status: {}", savedProduct.getProductId(), savedProduct.getStatus());
        return savedProduct;
    }

    @Transactional
    public Product updateProduct(UUID id, Product updatedProduct) {
        log.info("Updating product ID: {}", id);
        Product product = getProductById(id);

        product.setName(updatedProduct.getName());
        product.setDescription(updatedProduct.getDescription());
        product.setCoverImg(updatedProduct.getCoverImg());
        product.setPrice(updatedProduct.getPrice());
        if (updatedProduct.getStatus() != null && !updatedProduct.getStatus().isBlank()) {
            product.setStatus(updatedProduct.getStatus());
        }

        Product savedProduct = productRepository.save(product);
        log.info("Successfully updated product ID: {}", id);
        return savedProduct;
    }

    @Transactional
    public Product activateProduct(UUID id) {
        log.info("Activating product ID: {}", id);
        Product product = getProductById(id);
        product.setStatus("ACTIVE");
        Product savedProduct = productRepository.save(product);
        log.info("Successfully activated product ID: {}", id);
        return savedProduct;
    }

    @Transactional
    public Product deactivateProduct(UUID id) {
        log.info("Deactivating product ID: {}", id);
        Product product = getProductById(id);
        product.setStatus("INACTIVE");
        Product savedProduct = productRepository.save(product);
        log.info("Successfully deactivated product ID: {}", id);
        return savedProduct;
    }
}
