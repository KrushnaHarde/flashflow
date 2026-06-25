package com.krushna.flashflow;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.krushna.flashflow.auth.Role;
import com.krushna.flashflow.config.JwtService;
import com.krushna.flashflow.inventory.AddStockRequest;
import com.krushna.flashflow.inventory.Inventory;
import com.krushna.flashflow.inventory.InventoryRepository;
import com.krushna.flashflow.inventory.Product;
import com.krushna.flashflow.inventory.ProductRepository;
import com.krushna.flashflow.inventory.redis.RedisInventoryService;
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
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@ActiveProfiles("test")
public class InventoryIntegrationTest {

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
    private PasswordEncoder passwordEncoder;

    @Autowired
    private JwtService jwtService;

    @MockitoBean
    private RedisConnectionFactory redisConnectionFactory;

    @MockitoBean
    private ReactiveRedisConnectionFactory reactiveRedisConnectionFactory;

    @MockitoBean
    private RedisInventoryService redisInventoryService;

    private final ObjectMapper objectMapper = new ObjectMapper()
            .registerModule(new com.fasterxml.jackson.datatype.jsr310.JavaTimeModule());

    private String userToken;
    private String adminToken;
    private Product activeProduct;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext)
                .apply(org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity())
                .build();

        inventoryRepository.deleteAll();
        productRepository.deleteAll();
        userRepository.deleteAll();

        // Create a USER
        User normalUser = User.builder()
                .userId(UUID.randomUUID())
                .name("Normal User")
                .email("user@example.com")
                .password(passwordEncoder.encode("pass"))
                .role(Role.USER)
                .enabled(true)
                .build();
        userRepository.save(normalUser);
        userToken = "Bearer " + jwtService.generateToken(normalUser.getEmail());

        // Create an ADMIN
        User adminUser = User.builder()
                .userId(UUID.randomUUID())
                .name("Admin User")
                .email("admin@example.com")
                .password(passwordEncoder.encode("pass"))
                .role(Role.ADMIN)
                .enabled(true)
                .build();
        userRepository.save(adminUser);
        adminToken = "Bearer " + jwtService.generateToken(adminUser.getEmail());

        // Create a Product
        activeProduct = Product.builder()
                .productId(UUID.randomUUID())
                .name("Smartphone")
                .description("Latest smartphone")
                .coverImg("http://example.com/phone.jpg")
                .price(new BigDecimal("799.99"))
                .status("ACTIVE")
                .build();
        productRepository.save(activeProduct);
    }

    @Test
    void testAddStockAccessControl() throws Exception {
        AddStockRequest request = new AddStockRequest();
        request.setQuantity(10);

        // 1. Normal User should receive 403 Forbidden
        mockMvc.perform(post("/admin/inventory/" + activeProduct.getProductId())
                        .header("Authorization", userToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isForbidden());

        // 2. Admin should succeed
        MvcResult result = mockMvc.perform(post("/admin/inventory/" + activeProduct.getProductId())
                        .header("Authorization", adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isOk())
                .andReturn();

        Inventory inventory = objectMapper.readValue(result.getResponse().getContentAsString(), Inventory.class);
        assertEquals(activeProduct.getProductId(), inventory.getProductId());
        assertEquals(10, inventory.getTotalStock());
        assertEquals(10, inventory.getAvailableStock());
        assertEquals(0, inventory.getReservedStock());

        // Verify Redis inventory sync was called
        verify(redisInventoryService).setStock(eq(activeProduct.getProductId()), eq(10));
    }

    @Test
    void testAddStockNonExistentProduct() throws Exception {
        AddStockRequest request = new AddStockRequest();
        request.setQuantity(5);
        UUID nonExistentId = UUID.randomUUID();

        mockMvc.perform(post("/admin/inventory/" + nonExistentId)
                        .header("Authorization", adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isNotFound());
    }

    @Test
    void testAddStockInvalidQuantity() throws Exception {
        AddStockRequest request = new AddStockRequest();
        request.setQuantity(-5);

        mockMvc.perform(post("/admin/inventory/" + activeProduct.getProductId())
                        .header("Authorization", adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest());
    }
}
