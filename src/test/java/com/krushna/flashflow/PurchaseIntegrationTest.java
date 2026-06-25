package com.krushna.flashflow;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.krushna.flashflow.auth.Role;
import com.krushna.flashflow.common.OutboxEvent;
import com.krushna.flashflow.common.OutboxEventRepository;
import com.krushna.flashflow.config.JwtService;
import com.krushna.flashflow.inventory.*;
import com.krushna.flashflow.inventory.redis.RateLimiterService;
import com.krushna.flashflow.inventory.redis.RedisIdempotencyService;
import com.krushna.flashflow.inventory.redis.RedisInventoryService;
import com.krushna.flashflow.inventory.redis.RedisReservationService;
import com.krushna.flashflow.order.*;
import com.krushna.flashflow.order.event.OrderRequestedEvent;
import com.krushna.flashflow.order.kafka.OrderRequestedConsumer;
import com.krushna.flashflow.payment.Payment;
import com.krushna.flashflow.payment.PaymentRepository;
import com.krushna.flashflow.reservation.Reservation;
import com.krushna.flashflow.reservation.ReservationRepository;
import com.krushna.flashflow.user.User;
import com.krushna.flashflow.user.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.data.redis.connection.ReactiveRedisConnectionFactory;
import org.springframework.data.redis.connection.RedisConnectionFactory;
import org.springframework.http.MediaType;
import org.springframework.kafka.core.KafkaTemplate;
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
import java.util.concurrent.CompletableFuture;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@ActiveProfiles("test")
public class PurchaseIntegrationTest {

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
    private ReservationRepository reservationRepository;

    @Autowired
    private OrderRepository orderRepository;

    @Autowired
    private PaymentRepository paymentRepository;

    @Autowired
    private OutboxEventRepository outboxEventRepository;

    @Autowired
    private IdempotencyRepository idempotencyRepository;

    @Autowired
    private PasswordEncoder passwordEncoder;

    @Autowired
    private JwtService jwtService;

    @Autowired
    private OrderRequestedConsumer orderRequestedConsumer;

    @MockitoBean
    private RedisConnectionFactory redisConnectionFactory;

    @MockitoBean
    private ReactiveRedisConnectionFactory reactiveRedisConnectionFactory;

    @MockitoBean
    private RateLimiterService rateLimiterService;

    @MockitoBean
    private RedisInventoryService redisInventoryService;

    @MockitoBean
    private RedisReservationService redisReservationService;

    @MockitoBean
    private RedisIdempotencyService redisIdempotencyService;

    @Autowired
    private KafkaTemplate<String, String> mockKafkaTemplate;

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

        // Mock KafkaTemplate return value to avoid NPEs
        when(mockKafkaTemplate.send(anyString(), anyString(), anyString()))
                .thenReturn(CompletableFuture.completedFuture(null));

        orderRepository.deleteAll();
        paymentRepository.deleteAll();
        outboxEventRepository.deleteAll();
        idempotencyRepository.deleteAll();
        reservationRepository.deleteAll();
        inventoryRepository.deleteAll();
        productRepository.deleteAll();
        userRepository.deleteAll();

        // Create User
        normalUser = User.builder()
                .userId(UUID.randomUUID())
                .name("Normal User")
                .email("user@example.com")
                .password(passwordEncoder.encode("pass"))
                .role(Role.USER)
                .enabled(true)
                .build();
        userRepository.save(normalUser);
        userToken = "Bearer " + jwtService.generateToken(normalUser.getEmail());

        // Create Product
        activeProduct = Product.builder()
                .productId(UUID.randomUUID())
                .name("Limited Edition Shoe")
                .description("Super rare shoe")
                .coverImg("http://example.com/shoe.jpg")
                .price(new BigDecimal("150.00"))
                .status("ACTIVE")
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
    }

    @Test
    void testPurchaseSuccessAndFulfillmentConsumer() throws Exception {
        // 1. Mock Redis Services for a successful booking
        when(rateLimiterService.rateLimit(any(UUID.class), anyInt(), anyInt())).thenReturn(true);
        when(redisInventoryService.getStock(any(UUID.class))).thenReturn(100);
        when(redisInventoryService.reserveStock(any(UUID.class), anyInt())).thenReturn(true);

        PurchaseRequestDto request = new PurchaseRequestDto();
        request.setUserId(normalUser.getUserId());
        request.setProductId(activeProduct.getProductId());
        request.setQuantity(2);
        request.setIdempotencyKey("idemp-key-1");

        // 2. Perform API call POST /purchase (returns 202 Accepted)
        MvcResult mvcResult = mockMvc.perform(post("/purchase")
                        .header("Authorization", userToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isAccepted())
                .andReturn();

        PurchaseResponseDto response = objectMapper.readValue(
                mvcResult.getResponse().getContentAsString(), 
                PurchaseResponseDto.class
        );

        assertNotNull(response.getReservationId());
        assertEquals("ACTIVE", response.getStatus());
        assertEquals(new BigDecimal("300.00"), response.getTotalAmount());

        // Verify Reservation database record exists and inventory is decremented
        Reservation reservation = reservationRepository.findById(response.getReservationId()).orElse(null);
        assertNotNull(reservation);
        assertEquals("ACTIVE", reservation.getStatus());
        assertEquals(2, reservation.getQuantity());

        Inventory updatedInventory = inventoryRepository.findById(activeProduct.getProductId()).orElse(null);
        assertNotNull(updatedInventory);
        assertEquals(98, updatedInventory.getAvailableStock());
        assertEquals(2, updatedInventory.getReservedStock());

        // Verify Kafka event published
        verify(mockKafkaTemplate).send(eq("flashflow.orders"), eq(response.getReservationId().toString()), anyString());

        // 3. Simulate Kafka Consumer Fulfillment Flow
        OrderRequestedEvent event = OrderRequestedEvent.builder()
                .reservationId(response.getReservationId())
                .userId(normalUser.getUserId())
                .productId(activeProduct.getProductId())
                .quantity(2)
                .totalAmount(new BigDecimal("300.00"))
                .idempotencyKey("idemp-key-1")
                .build();

        String eventMessage = objectMapper.writeValueAsString(event);

        // Act: call consumer consume method manually
        orderRequestedConsumer.consume(eventMessage);

        // Assert Order, Payment, OutboxEvent created and stock finalized
        List<Order> orders = orderRepository.findAll();
        assertEquals(1, orders.size());
        Order order = orders.get(0);
        assertEquals(response.getReservationId(), order.getReservationId());
        assertEquals("CREATED", order.getStatus());

        List<Payment> payments = paymentRepository.findAll();
        assertEquals(1, payments.size());
        Payment payment = payments.get(0);
        assertEquals(order.getOrderId(), payment.getOrderId());
        assertEquals("PENDING", payment.getStatus());

        List<OutboxEvent> outboxEvents = outboxEventRepository.findAll();
        assertEquals(1, outboxEvents.size());
        assertEquals("ORDER_CREATED", outboxEvents.get(0).getEventType());

        // Finalized DB inventory: total stock is decremented and reserved stock goes back to 0
        Inventory finalInventory = inventoryRepository.findById(activeProduct.getProductId()).orElse(null);
        assertNotNull(finalInventory);
        assertEquals(98, finalInventory.getTotalStock());
        assertEquals(0, finalInventory.getReservedStock());

        // DB Reservation status updated to CONFIRMED
        Reservation finalReservation = reservationRepository.findById(response.getReservationId()).orElse(null);
        assertNotNull(finalReservation);
        assertEquals("CONFIRMED", finalReservation.getStatus());

        // DB Idempotency updated to COMPLETED
        Idempotency idempotency = idempotencyRepository.findById("idemp-key-1").orElse(null);
        assertNotNull(idempotency);
        assertEquals("COMPLETED", idempotency.getStatus());
        assertEquals(order.getOrderId(), idempotency.getOrderId());
    }

    @Test
    void testPurchaseRateLimited() throws Exception {
        // Mock Rate Limiting to reject the request
        when(rateLimiterService.rateLimit(any(UUID.class), anyInt(), anyInt())).thenReturn(false);

        PurchaseRequestDto request = new PurchaseRequestDto();
        request.setUserId(normalUser.getUserId());
        request.setProductId(activeProduct.getProductId());
        request.setQuantity(1);
        request.setIdempotencyKey("idemp-key-rate-limit");

        mockMvc.perform(post("/purchase")
                        .header("Authorization", userToken)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isTooManyRequests());
    }
}
