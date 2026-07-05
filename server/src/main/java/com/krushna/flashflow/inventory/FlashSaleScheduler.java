package com.krushna.flashflow.inventory;

import com.krushna.flashflow.inventory.redis.RedisFlashSaleService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@Component
@EnableScheduling
@RequiredArgsConstructor
@Slf4j
public class FlashSaleScheduler {

    private final FlashSaleRepository flashSaleRepository;
    private final RedisFlashSaleService redisFlashSaleService;

    // Run every 5 seconds to sync database active sales to Redis SET
    @Scheduled(fixedRate = 5000)
    public void syncActiveSalesToRedis() {
        try {
            List<FlashSale> activeSales = flashSaleRepository.findAllActiveSales(LocalDateTime.now());
            Set<UUID> activeProductIds = activeSales.stream()
                    .flatMap(sale -> sale.getProductIds().stream())
                    .collect(Collectors.toSet());
            redisFlashSaleService.refreshActiveProducts(activeProductIds);
        } catch (Exception e) {
            log.error("Failed to sync active flash sales to Redis", e);
        }
    }
}
