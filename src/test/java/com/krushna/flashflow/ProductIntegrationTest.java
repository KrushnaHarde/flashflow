package com.krushna.flashflow;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.krushna.flashflow.config.JwtService;
import com.krushna.flashflow.inventory.Product;
import com.krushna.flashflow.inventory.ProductRepository;
import com.krushna.flashflow.user.Role;
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
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@ActiveProfiles("test")
public class ProductIntegrationTest {

    private MockMvc mockMvc;

    @Autowired
    private WebApplicationContext webApplicationContext;

    @Autowired
    private ProductRepository productRepository;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private JwtService jwtService;

    private final ObjectMapper objectMapper = new ObjectMapper()
            .registerModule(new com.fasterxml.jackson.datatype.jsr310.JavaTimeModule());

    @MockitoBean
    private RedisConnectionFactory redisConnectionFactory;

    @MockitoBean
    private ReactiveRedisConnectionFactory reactiveRedisConnectionFactory;

    private String userToken;
    private String adminToken;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext)
                .apply(org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity())
                .build();

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
    }

    @Test
    void testProductCrudAndStateTransitions() throws Exception {
        // 1. Create a Product (Admin only)
        Product newProduct = Product.builder()
                .name("Smartphone")
                .description("Latest generation smartphone")
                .coverImg("http://example.com/phone.jpg")
                .price(new BigDecimal("799.99"))
                .build();

        // Attempt creation as Normal User -> Should fail with 403
        mockMvc.perform(post("/admin/products")
                        .header("Authorization", userToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(newProduct)))
                .andExpect(status().isForbidden());

        // Creation as Admin -> Should succeed
        MvcResult createResult = mockMvc.perform(post("/admin/products")
                        .header("Authorization", adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(newProduct)))
                .andExpect(status().isCreated())
                .andReturn();

        Product createdProduct = objectMapper.readValue(createResult.getResponse().getContentAsString(), Product.class);
        assertNotNull(createdProduct.getProductId());
        assertEquals("Smartphone", createdProduct.getName());
        assertEquals("INACTIVE", createdProduct.getStatus()); // Default status as per requirement

        // 2. Get All Products
        MvcResult getAllResult = mockMvc.perform(get("/products")
                        .header("Authorization", userToken))
                .andExpect(status().isOk())
                .andReturn();

        List<Product> products = objectMapper.readValue(getAllResult.getResponse().getContentAsString(),
                objectMapper.getTypeFactory().constructCollectionType(List.class, Product.class));
        assertFalse(products.isEmpty());
        assertEquals(1, products.size());

        // 3. Get Product By ID
        MvcResult getByIdResult = mockMvc.perform(get("/products/" + createdProduct.getProductId())
                        .header("Authorization", userToken))
                .andExpect(status().isOk())
                .andReturn();

        Product fetched = objectMapper.readValue(getByIdResult.getResponse().getContentAsString(), Product.class);
        assertEquals(createdProduct.getProductId(), fetched.getProductId());

        // 4. Update Product (Admin only)
        Product updateData = Product.builder()
                .name("Smartphone Pro")
                .description("Upgraded pro version")
                .coverImg("http://example.com/phone_pro.jpg")
                .price(new BigDecimal("999.99"))
                .build();

        mockMvc.perform(put("/admin/products/" + createdProduct.getProductId())
                        .header("Authorization", adminToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(updateData)))
                .andExpect(status().isOk());

        Product updated = productRepository.findById(createdProduct.getProductId()).orElse(null);
        assertNotNull(updated);
        assertEquals("Smartphone Pro", updated.getName());
        assertEquals(new BigDecimal("999.99"), updated.getPrice());

        // 5. Activate Product (Admin only)
        mockMvc.perform(patch("/admin/products/" + createdProduct.getProductId() + "/activate")
                        .header("Authorization", adminToken))
                .andExpect(status().isOk());

        Product activated = productRepository.findById(createdProduct.getProductId()).orElse(null);
        assertNotNull(activated);
        assertEquals("ACTIVE", activated.getStatus());

        // 6. Deactivate Product (Admin only)
        mockMvc.perform(patch("/admin/products/" + createdProduct.getProductId() + "/deactivate")
                        .header("Authorization", adminToken))
                .andExpect(status().isOk());

        Product deactivated = productRepository.findById(createdProduct.getProductId()).orElse(null);
        assertNotNull(deactivated);
        assertEquals("INACTIVE", deactivated.getStatus());
    }
}
