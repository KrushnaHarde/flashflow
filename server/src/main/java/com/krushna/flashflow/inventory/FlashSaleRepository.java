package com.krushna.flashflow.inventory;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDateTime;
import java.util.List;
import java.util.UUID;

public interface FlashSaleRepository extends JpaRepository<FlashSale, UUID> {

    @Query("SELECT s FROM FlashSale s JOIN s.productIds p WHERE p = :productId AND s.startTime <= :now AND (s.endTime IS NULL OR s.endTime >= :now)")
    List<FlashSale> findActiveSalesForProduct(@Param("productId") UUID productId, @Param("now") LocalDateTime now);
}
