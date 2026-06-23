package com.krushna.flashflow.inventory;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class ProductService {

    private final ProductRepository productRepository;

    public List<Product> getAllProducts() {
        return productRepository.findAll();
    }

    public Product getProductById(UUID id) {
        return productRepository.findById(id)
                .orElseThrow(() -> new IllegalArgumentException("Product not found with id: " + id));
    }

    @Transactional
    public Product createProduct(Product product) {
        if (product.getProductId() == null) {
            product.setProductId(UUID.randomUUID());
        }
        if (product.getStatus() == null || product.getStatus().isBlank()) {
            product.setStatus("INACTIVE"); // Default to INACTIVE as per requirement
        }
        return productRepository.save(product);
    }

    @Transactional
    public Product updateProduct(UUID id, Product updatedProduct) {
        Product product = getProductById(id);

        product.setName(updatedProduct.getName());
        product.setDescription(updatedProduct.getDescription());
        product.setCoverImg(updatedProduct.getCoverImg());
        product.setPrice(updatedProduct.getPrice());
        if (updatedProduct.getStatus() != null && !updatedProduct.getStatus().isBlank()) {
            product.setStatus(updatedProduct.getStatus());
        }

        return productRepository.save(product);
    }

    @Transactional
    public Product activateProduct(UUID id) {
        Product product = getProductById(id);
        product.setStatus("ACTIVE");
        return productRepository.save(product);
    }

    @Transactional
    public Product deactivateProduct(UUID id) {
        Product product = getProductById(id);
        product.setStatus("INACTIVE");
        return productRepository.save(product);
    }
}
