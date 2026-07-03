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

    public List<FlashSale> getAllSales() {
        log.info("Fetching all flash sales");
        return flashSaleRepository.findAll();
    }

    public FlashSale getSaleById(UUID id) {
        log.info("Fetching flash sale by ID: {}", id);
        return flashSaleRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Flash sale not found with id: " + id));
    }

    @Transactional
    public FlashSale createSale(FlashSale sale) {
        log.info("Creating a new flash sale: {}", sale.getName());
        if (sale.getSaleId() == null) {
            sale.setSaleId(UUID.randomUUID());
        }
        return flashSaleRepository.save(sale);
    }

    @Transactional
    public FlashSale updateSale(UUID id, FlashSale updated) {
        log.info("Updating flash sale ID: {}", id);
        FlashSale sale = getSaleById(id);
        sale.setName(updated.getName());
        sale.setStartTime(updated.getStartTime());
        sale.setEndTime(updated.getEndTime());
        sale.setProductIds(updated.getProductIds());
        return flashSaleRepository.save(sale);
    }

    @Transactional
    public void deleteSale(UUID id) {
        log.info("Deleting flash sale ID: {}", id);
        FlashSale sale = getSaleById(id);
        flashSaleRepository.delete(sale);
    }

    public boolean isProductOnActiveSale(UUID productId) {
        List<FlashSale> activeSales = flashSaleRepository.findActiveSalesForProduct(productId, LocalDateTime.now());
        boolean active = !activeSales.isEmpty();
        log.info("Checking active sale status for product {}: {}", productId, active);
        return active;
    }
}
