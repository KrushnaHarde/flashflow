package com.krushna.flashflow;

import com.krushna.flashflow.inventory.FlashSale;
import com.krushna.flashflow.inventory.FlashSaleRepository;
import com.krushna.flashflow.inventory.FlashSaleService;
import com.krushna.flashflow.inventory.redis.RedisFlashSaleService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDateTime;
import java.util.Collections;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
public class FlashSaleServiceTest {

    @Mock
    private FlashSaleRepository flashSaleRepository;

    @Mock
    private RedisFlashSaleService redisFlashSaleService;

    @InjectMocks
    private FlashSaleService flashSaleService;

    private UUID productId;
    private FlashSale sale;

    @BeforeEach
    void setUp() {
        productId = UUID.randomUUID();
        sale = FlashSale.builder()
                .saleId(UUID.randomUUID())
                .name("Black Friday")
                .startTime(LocalDateTime.now().plusHours(1))
                .endTime(LocalDateTime.now().plusHours(2))
                .productIds(Set.of(productId))
                .build();
    }

    @Test
    void testCreateSale_Success() {
        when(flashSaleRepository.save(any(FlashSale.class))).thenReturn(sale);
        when(flashSaleRepository.findAllActiveSales(any(LocalDateTime.class)))
                .thenReturn(Collections.singletonList(sale));

        FlashSale created = flashSaleService.createSale(sale);

        assertNotNull(created);
        assertEquals(sale.getName(), created.getName());
        verify(flashSaleRepository, times(1)).save(sale);
        verify(redisFlashSaleService, times(1)).refreshActiveProducts(anySet());
    }

    @Test
    void testCreateSale_InvalidTime() {
        sale.setEndTime(LocalDateTime.now().minusHours(1));
        assertThrows(IllegalArgumentException.class, () -> flashSaleService.createSale(sale));
    }

    @Test
    void testCreateSale_EmptyProducts() {
        sale.setProductIds(Collections.emptySet());
        assertThrows(IllegalArgumentException.class, () -> flashSaleService.createSale(sale));
    }

    @Test
    void testUpdateSale_Success() {
        when(flashSaleRepository.findById(sale.getSaleId())).thenReturn(Optional.of(sale));
        when(flashSaleRepository.save(any(FlashSale.class))).thenReturn(sale);

        FlashSale updatedInfo = FlashSale.builder()
                .name("Updated Sale")
                .startTime(LocalDateTime.now().plusHours(2))
                .endTime(LocalDateTime.now().plusHours(4))
                .productIds(Set.of(productId))
                .build();

        FlashSale result = flashSaleService.updateSale(sale.getSaleId(), updatedInfo);

        assertNotNull(result);
        assertEquals("Updated Sale", result.getName());
        verify(flashSaleRepository, times(1)).save(any(FlashSale.class));
    }

    @Test
    void testDeleteSale_Success() {
        when(flashSaleRepository.findById(sale.getSaleId())).thenReturn(Optional.of(sale));
        doNothing().when(flashSaleRepository).delete(sale);

        flashSaleService.deleteSale(sale.getSaleId());

        verify(flashSaleRepository, times(1)).delete(sale);
        verify(redisFlashSaleService, times(1)).refreshActiveProducts(anySet());
    }

    @Test
    void testIsProductOnActiveSale_True() {
        when(redisFlashSaleService.isProductOnActiveSale(productId)).thenReturn(true);

        boolean isActive = flashSaleService.isProductOnActiveSale(productId);

        assertTrue(isActive);
        verify(redisFlashSaleService, times(1)).isProductOnActiveSale(productId);
    }

    @Test
    void testIsProductOnActiveSale_False() {
        when(redisFlashSaleService.isProductOnActiveSale(productId)).thenReturn(false);

        boolean isActive = flashSaleService.isProductOnActiveSale(productId);

        assertFalse(isActive);
        verify(redisFlashSaleService, times(1)).isProductOnActiveSale(productId);
    }
}
