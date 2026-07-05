package com.krushna.flashflow.inventory;

import com.krushna.flashflow.common.exception.ResourceNotFoundException;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@Slf4j
public class FlashSaleService {

    private final FlashSaleRepository flashSaleRepository;
    private final com.krushna.flashflow.inventory.redis.RedisFlashSaleService redisFlashSaleService;

    public List<FlashSale> getAllSales() {
        log.info("Fetching all flash sales");
        return flashSaleRepository.findAll();
    }

    public FlashSale getSaleById(UUID id) {
        log.info("Fetching flash sale by ID: {}", id);
        return flashSaleRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Flash sale not found with id: " + id));
    }

    private void validateSale(FlashSale sale) {
        if (sale.getStartTime() == null) {
            throw new IllegalArgumentException("startTime is required");
        }
        if (sale.getEndTime() != null && !sale.getEndTime().isAfter(sale.getStartTime())) {
            throw new IllegalArgumentException("endTime must be after startTime");
        }
        if (sale.getProductIds() == null || sale.getProductIds().isEmpty()) {
            throw new IllegalArgumentException("A flash sale must include at least one product");
        }
    }

    private void refreshRedisSet() {
        try {
            List<FlashSale> activeSales = flashSaleRepository.findAllActiveSales(LocalDateTime.now());
            java.util.Set<UUID> activeProductIds = activeSales.stream()
                    .flatMap(s -> s.getProductIds().stream())
                    .collect(java.util.stream.Collectors.toSet());
            redisFlashSaleService.refreshActiveProducts(activeProductIds);
        } catch (Exception e) {
            log.error("Failed to refresh active flash sale products in Redis", e);
        }
    }

    @Transactional
    public FlashSale createSale(FlashSale sale) {
        log.info("Creating a new flash sale: {}", sale.getName());
        validateSale(sale);
        if (sale.getSaleId() == null) {
            sale.setSaleId(UUID.randomUUID());
        }
        FlashSale saved = flashSaleRepository.save(sale);
        refreshRedisSet();
        return saved;
    }

    @Transactional
    public FlashSale updateSale(UUID id, FlashSale updated) {
        log.info("Updating flash sale ID: {}", id);
        validateSale(updated);
        FlashSale sale = getSaleById(id);
        sale.setName(updated.getName());
        sale.setStartTime(updated.getStartTime());
        sale.setEndTime(updated.getEndTime());
        sale.setProductIds(updated.getProductIds());
        FlashSale saved = flashSaleRepository.save(sale);
        refreshRedisSet();
        return saved;
    }

    @Transactional
    public void deleteSale(UUID id) {
        log.info("Deleting flash sale ID: {}", id);
        FlashSale sale = getSaleById(id);
        flashSaleRepository.delete(sale);
        refreshRedisSet();
    }

    public boolean isProductOnActiveSale(UUID productId) {
        boolean active = redisFlashSaleService.isProductOnActiveSale(productId);
        log.info("Checking active sale status (Redis) for product {}: {}", productId, active);
        return active;
    }

    public boolean isProductInAnySale(UUID productId) {
        return flashSaleRepository.existsByProductId(productId);
    }
}
