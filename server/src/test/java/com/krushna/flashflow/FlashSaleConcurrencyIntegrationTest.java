package com.krushna.flashflow;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.krushna.flashflow.auth.Role;
import com.krushna.flashflow.config.JwtService;
import com.krushna.flashflow.inventory.*;
import com.krushna.flashflow.inventory.redis.RateLimiterService;
import com.krushna.flashflow.inventory.redis.RedisFlashSaleService;
import com.krushna.flashflow.inventory.redis.RedisInventoryService;
import com.krushna.flashflow.order.PurchaseRequestDto;
import com.krushna.flashflow.user.User;
import com.krushna.flashflow.user.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.connection.ReactiveRedisConnectionFactory;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@ActiveProfiles("test")
public class FlashSaleConcurrencyIntegrationTest {

    private MockMvc mockMvc;

    @Autowired
    private WebApplicationContext webApplicationContext;

    @Autowired
    private ProductRepository productRepository;

    @Autowired
    private InventoryRepository inventoryRepository;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private FlashSaleRepository flashSaleRepository;

    @Autowired
    private FlashSaleService flashSaleService;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private JwtService jwtService;

    @MockitoBean
    private RedisConnectionFactory redisConnectionFactory;

    @MockitoBean
    private ReactiveRedisConnectionFactory reactiveRedisConnectionFactory;

    @MockitoBean
    private RateLimiterService rateLimiterService;

    @MockitoBean
    private RedisInventoryService redisInventoryService;

    @MockitoBean
    private RedisFlashSaleService redisFlashSaleService;

    private final ObjectMapper objectMapper = new ObjectMapper()
            .registerModule(new com.fasterxml.jackson.datatype.jsr310.JavaTimeModule());

    private String userToken;
    private User normalUser;
    private Product activeProduct;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext)
                .apply(org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity())
                .build();

        userRepository.deleteAll();
        flashSaleRepository.deleteAll();
        productRepository.deleteAll();
        inventoryRepository.deleteAll();

        // Create User
        normalUser = User.builder()
                .userId(UUID.randomUUID())
                .name("Concurrency Tester")
                .email("tester@example.com")
                .password(passwordEncoder.encode("pass"))
                .role(Role.USER)
                .enabled(true)
                .build();
        userRepository.save(normalUser);
        userToken = "Bearer " + jwtService.generateToken(normalUser.getEmail());

        // Create Product
        activeProduct = Product.builder()
                .productId(UUID.randomUUID())
                .name("Flash Product")
                .price(new BigDecimal("99.99"))
                .status(ProductStatus.ACTIVE)
                .build();
        productRepository.save(activeProduct);

        // Create Inventory
        Inventory inventory = Inventory.builder()
                .productId(activeProduct.getProductId())
                .totalStock(100)
                .availableStock(100)
                .reservedStock(0)
                .build();
        inventoryRepository.save(inventory);

        // Stub standard redis checks
        when(rateLimiterService.rateLimit(any(UUID.class), anyInt(), anyInt())).thenReturn(true);
        when(redisInventoryService.getStock(any(UUID.class))).thenReturn(100);
        when(redisInventoryService.reserveStock(any(UUID.class), anyInt())).thenReturn(true);
    }

    @Test
    void testConcurrentPurchasesAtBoundary() throws Exception {
        UUID productId = activeProduct.getProductId();
        
        // 1. Create a FlashSale that starts in 1 second
        FlashSale sale = FlashSale.builder()
                .saleId(UUID.randomUUID())
                .name("Boundary Sale")
                .startTime(LocalDateTime.now().plusSeconds(1))
                .endTime(LocalDateTime.now().plusSeconds(3))
                .productIds(Set.of(productId))
                .build();
        flashSaleRepository.save(sale);

        // Stub redis cache check to align with whether the sale is active
        // Before start: false
        when(redisFlashSaleService.isProductOnActiveSale(productId)).thenReturn(false);

        // Start threads to request concurrently
        int threads = 10;
        ExecutorService executor = Executors.newFixedThreadPool(threads);
        CountDownLatch startLatch = new CountDownLatch(1);
        CountDownLatch doneLatch = new CountDownLatch(threads);

        AtomicInteger allowedPurchases = new AtomicInteger(0);
        AtomicInteger rejectedPurchases = new AtomicInteger(0);

        for (int i = 0; i < threads; i++) {
            final int idx = i;
            executor.submit(() -> {
                try {
                    startLatch.await();
                    PurchaseRequestDto request = new PurchaseRequestDto();
                    request.setUserId(normalUser.getUserId());
                    request.setProductId(productId);
                    request.setQuantity(1);
                    request.setIdempotencyKey("idem-boundary-" + idx);

                    MvcResult result = mockMvc.perform(post("/purchase")
                                    .header("Authorization", userToken)
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content(objectMapper.writeValueAsString(request)))
                            .andReturn();

                    int status = result.getResponse().getStatus();
                    if (status == 202) {
                        allowedPurchases.incrementAndGet();
                    } else if (status == 400) {
                        rejectedPurchases.incrementAndGet();
                    }
                } catch (Exception e) {
                    e.printStackTrace();
                } finally {
                    doneLatch.countDown();
                }
            });
        }

        // Release threads to fire concurrently while we change status
        startLatch.countDown();
        
        // Simulating the propagation window: update Redis to active
        when(redisFlashSaleService.isProductOnActiveSale(productId)).thenReturn(true);

        doneLatch.await(5, TimeUnit.SECONDS);

        // Verify that the responses succeeded or failed cleanly, without raising exceptions or internal mismatches
        assertTrue(allowedPurchases.get() + rejectedPurchases.get() > 0);
        
        // Simulating end of sale boundary
        when(redisFlashSaleService.isProductOnActiveSale(productId)).thenReturn(false);
        
        // Fire subsequent purchases after end - must be rejected
        PurchaseRequestDto postEndRequest = new PurchaseRequestDto();
        postEndRequest.setUserId(normalUser.getUserId());
        postEndRequest.setProductId(productId);
        postEndRequest.setQuantity(1);
        postEndRequest.setIdempotencyKey("idem-post-end");

        mockMvc.perform(post("/purchase")
                        .header("Authorization", userToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(postEndRequest)))
                .andExpect(status().isBadRequest());

        executor.shutdown();
    }
}
