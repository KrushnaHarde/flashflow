package com.krushna.flashflow;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.krushna.flashflow.user.AuthResponse;
import com.krushna.flashflow.user.LoginRequest;
import com.krushna.flashflow.user.RefreshRequest;
import com.krushna.flashflow.user.RegisterRequest;
import com.krushna.flashflow.user.User;
import com.krushna.flashflow.user.UserRepository;
import com.krushna.flashflow.user.Role;
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

import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@ActiveProfiles("test")
public class AuthenticationIntegrationTest {

    private MockMvc mockMvc;

    @Autowired
    private WebApplicationContext webApplicationContext;

    @Autowired
    private UserRepository userRepository;

    @Autowired
    private PasswordEncoder passwordEncoder;

    private final ObjectMapper objectMapper = new ObjectMapper()
            .registerModule(new com.fasterxml.jackson.datatype.jsr310.JavaTimeModule());

    @MockitoBean
    private RedisConnectionFactory redisConnectionFactory;

    @MockitoBean
    private ReactiveRedisConnectionFactory reactiveRedisConnectionFactory;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(webApplicationContext)
                .apply(org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity())
                .build();
        userRepository.deleteAll();
    }

    @Test
    void testRegistrationFlow() throws Exception {
        RegisterRequest request = RegisterRequest.builder()
                .name("Alice")
                .email("alice@example.com")
                .password("password123")
                .build();

        mockMvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isCreated());

        // Verify user created in DB
        User user = userRepository.findByEmail("alice@example.com").orElse(null);
        assertNotNull(user);
        assertEquals("Alice", user.getName());
        assertEquals(Role.USER, user.getRole());
        assertTrue(user.isEnabled());
        assertTrue(passwordEncoder.matches("password123", user.getPassword()));

        // Try registering with same email again
        mockMvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void testLoginFlow() throws Exception {
        // Pre-register user
        User user = User.builder()
                .userId(UUID.randomUUID())
                .name("Bob")
                .email("bob@example.com")
                .password(passwordEncoder.encode("bobsecure"))
                .role(Role.USER)
                .enabled(true)
                .build();
        userRepository.save(user);

        // Login with correct credentials
        LoginRequest correctLogin = LoginRequest.builder()
                .email("bob@example.com")
                .password("bobsecure")
                .build();

        MvcResult result = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(correctLogin)))
                .andExpect(status().isOk())
                .andReturn();

        String responseBody = result.getResponse().getContentAsString();
        AuthResponse authResponse = objectMapper.readValue(responseBody, AuthResponse.class);
        assertNotNull(authResponse.getAccessToken());
        assertNotNull(authResponse.getRefreshToken());
        assertTrue(authResponse.getExpiresIn() > 0);

        // Login with wrong credentials
        LoginRequest incorrectLogin = LoginRequest.builder()
                .email("bob@example.com")
                .password("wrongpassword")
                .build();

        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(incorrectLogin)))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void testRefreshTokenRotationFlow() throws Exception {
        // Pre-register user
        User user = User.builder()
                .userId(UUID.randomUUID())
                .name("Charlie")
                .email("charlie@example.com")
                .password(passwordEncoder.encode("password"))
                .role(Role.USER)
                .enabled(true)
                .build();
        userRepository.save(user);

        // Login to get tokens
        LoginRequest loginRequest = LoginRequest.builder()
                .email("charlie@example.com")
                .password("password")
                .build();

        MvcResult loginResult = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(loginRequest)))
                .andReturn();

        AuthResponse initialTokens = objectMapper.readValue(loginResult.getResponse().getContentAsString(), AuthResponse.class);
        String oldRefreshToken = initialTokens.getRefreshToken();

        // Refresh with valid token
        RefreshRequest refreshRequest = RefreshRequest.builder()
                .refreshToken(oldRefreshToken)
                .build();

        MvcResult refreshResult = mockMvc.perform(post("/api/v1/auth/refresh")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(refreshRequest)))
                .andExpect(status().isOk())
                .andReturn();

        AuthResponse rotatedTokens = objectMapper.readValue(refreshResult.getResponse().getContentAsString(), AuthResponse.class);
        assertNotNull(rotatedTokens.getAccessToken());
        assertNotNull(rotatedTokens.getRefreshToken());
        assertNotEquals(oldRefreshToken, rotatedTokens.getRefreshToken());

        // Refreshing with the old (rotated) token should fail
        mockMvc.perform(post("/api/v1/auth/refresh")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(refreshRequest)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void testEndpointSecurity() throws Exception {
        // Endpoint: /products requires authentication
        mockMvc.perform(get("/products"))
                .andExpect(status().isUnauthorized());

        // Register a USER and an ADMIN
        User userUser = User.builder()
                .userId(UUID.randomUUID())
                .name("Normal User")
                .email("user@example.com")
                .password(passwordEncoder.encode("pass"))
                .role(Role.USER)
                .enabled(true)
                .build();
        userRepository.save(userUser);

        User userAdmin = User.builder()
                .userId(UUID.randomUUID())
                .name("Admin User")
                .email("admin@example.com")
                .password(passwordEncoder.encode("pass"))
                .role(Role.ADMIN)
                .enabled(true)
                .build();
        userRepository.save(userAdmin);

        // Login as USER
        MvcResult userLoginResult = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new LoginRequest("user@example.com", "pass"))))
                .andReturn();
        AuthResponse userTokens = objectMapper.readValue(userLoginResult.getResponse().getContentAsString(), AuthResponse.class);

        // Login as ADMIN
        MvcResult adminLoginResult = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(new LoginRequest("admin@example.com", "pass"))))
                .andReturn();
        AuthResponse adminTokens = objectMapper.readValue(adminLoginResult.getResponse().getContentAsString(), AuthResponse.class);

        // USER accesses /products -> Should succeed (returns 404 since it's not implemented yet, but not 401/403)
        int productsStatus = mockMvc.perform(get("/products")
                        .header("Authorization", "Bearer " + userTokens.getAccessToken()))
                .andReturn().getResponse().getStatus();
        assertTrue(productsStatus == 200 || productsStatus == 404);

        // USER accesses /admin/products -> Should fail with 403 Forbidden
        mockMvc.perform(post("/admin/products")
                        .header("Authorization", "Bearer " + userTokens.getAccessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isForbidden());

        // ADMIN accesses /admin/products -> Should NOT fail with 403 Forbidden
        int adminProductStatus = mockMvc.perform(post("/admin/products")
                        .header("Authorization", "Bearer " + adminTokens.getAccessToken())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"Test Product\",\"price\":10.0}"))
                .andReturn().getResponse().getStatus();
        assertNotEquals(401, adminProductStatus);
        assertNotEquals(403, adminProductStatus);
    }
}
