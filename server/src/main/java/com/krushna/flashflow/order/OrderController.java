package com.krushna.flashflow.order;

import com.krushna.flashflow.auth.Role;
import com.krushna.flashflow.common.exception.ResourceNotFoundException;
import com.krushna.flashflow.payment.Payment;
import com.krushna.flashflow.payment.PaymentRepository;
import com.krushna.flashflow.reservation.Reservation;
import com.krushna.flashflow.reservation.ReservationRepository;
import com.krushna.flashflow.user.User;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.UUID;
import com.krushna.flashflow.inventory.redis.RedisReservationService;

@RestController
@Slf4j
@RequiredArgsConstructor
public class OrderController {

    private final OrderRepository orderRepository;
    private final ReservationRepository reservationRepository;
    private final PaymentRepository paymentRepository;
    private final RedisReservationService redisReservationService;
    private final org.springframework.data.redis.core.StringRedisTemplate stringRedisTemplate;

    @GetMapping("/orders/{orderId}")
    public ResponseEntity<Order> getOrderById(
            @PathVariable UUID orderId,
            @AuthenticationPrincipal User authenticatedUser) {
        log.info("Request to get order by ID: {}", orderId);
        Order order = orderRepository.findById(orderId)
                .orElseThrow(() -> new ResourceNotFoundException("Order not found with id: " + orderId));

        // Enforce ownership unless user is Admin
        if (authenticatedUser.getRole() != Role.ADMIN && !order.getUserId().equals(authenticatedUser.getUserId())) {
            throw new AccessDeniedException("You are not authorized to view this order");
        }

        return ResponseEntity.ok(order);
    }

    @GetMapping("/orders")
    public ResponseEntity<List<Order>> getOrders(
            @RequestParam(required = false) UUID userId,
            @AuthenticationPrincipal User authenticatedUser) {
        log.info("Request to get orders for user: {}", userId);

        UUID targetUserId = userId;
        if (targetUserId == null) {
            targetUserId = authenticatedUser.getUserId();
        } else if (authenticatedUser.getRole() != Role.ADMIN && !targetUserId.equals(authenticatedUser.getUserId())) {
            throw new AccessDeniedException("You are not authorized to view orders for this user");
        }

        List<Order> orders = orderRepository.findByUserId(targetUserId);
        return ResponseEntity.ok(orders);
    }

    @GetMapping("/admin/orders")
    public ResponseEntity<List<Order>> getAllOrdersForAdmin() {
        log.info("Admin request to get all orders");
        List<Order> orders = orderRepository.findAll();
        return ResponseEntity.ok(orders);
    }

    @GetMapping("/admin/reservations")
    public ResponseEntity<List<Reservation>> getAllReservationsForAdmin() {
        log.info("Admin request to get all reservations");
        List<Reservation> reservations = reservationRepository.findAll();
        return ResponseEntity.ok(reservations);
    }

    @GetMapping("/purchase/{reservationId}/status")
    public ResponseEntity<PurchaseStatusResponse> getPurchaseStatus(
            @PathVariable UUID reservationId,
            @AuthenticationPrincipal User authenticatedUser) {
        log.info("Request to get purchase status for reservation: {}", reservationId);

        Reservation reservation = reservationRepository.findById(reservationId)
                .orElse(null);

        String reservationStatusStr = null;
        if (reservation == null) {
            // Check Redis fallback status
            reservationStatusStr = redisReservationService.getReservationStatus(reservationId);
            if (reservationStatusStr == null) {
                throw new ResourceNotFoundException("Reservation not found with id: " + reservationId);
            }
        } else {
            // Check authorization
            if (authenticatedUser.getRole() != Role.ADMIN && !reservation.getUserId().equals(authenticatedUser.getUserId())) {
                throw new AccessDeniedException("You are not authorized to view the status of this reservation");
            }
            reservationStatusStr = reservation.getStatus().name();
        }

        Order order = orderRepository.findByReservationId(reservationId).orElse(null);
        Payment payment = null;
        if (order != null) {
            payment = paymentRepository.findByOrderId(order.getOrderId()).orElse(null);
        }

        PurchaseStatusResponse response = PurchaseStatusResponse.builder()
                .reservationId(reservationId)
                .reservationStatus(reservationStatusStr)
                .orderId(order != null ? order.getOrderId() : null)
                .orderStatus(order != null ? order.getStatus().name() : null)
                .paymentStatus(payment != null ? payment.getStatus().name() : null)
                .build();

        return ResponseEntity.ok(response);
    }

    @GetMapping("/api/v1/trace/{traceId}")
    public ResponseEntity<java.util.Map<String, Object>> traceRequest(@PathVariable String traceId) {
        log.info("Tracing request for trace ID: {}", traceId);

        java.util.Map<String, Object> result = new java.util.HashMap<>();
        result.put("traceId", traceId);

        // 1. Query Redis State
        String reservationKey = "reservation:" + traceId;
        String reservationMetaKey = "reservation:" + traceId + ":meta";

        String redisStatus = stringRedisTemplate.opsForValue().get(reservationKey);
        String redisMeta = stringRedisTemplate.opsForValue().get(reservationMetaKey);

        java.util.Map<String, Object> redisState = new java.util.HashMap<>();
        redisState.put("statusKey", reservationKey);
        redisState.put("statusValue", redisStatus);
        redisState.put("metaKey", reservationMetaKey);
        redisState.put("metaValue", redisMeta);
        result.put("redisState", redisState);

        // 2. Query Postgres State
        UUID uuid;
        try {
            uuid = UUID.fromString(traceId);
        } catch (Exception e) {
            uuid = null;
        }

        if (uuid != null) {
            Reservation dbReservation = reservationRepository.findById(uuid).orElse(null);
            result.put("postgresReservation", dbReservation);

            Order dbOrder = orderRepository.findByReservationId(uuid).orElse(null);
            result.put("postgresOrder", dbOrder);

            if (dbOrder != null) {
                Payment dbPayment = paymentRepository.findByOrderId(dbOrder.getOrderId()).orElse(null);
                result.put("postgresPayment", dbPayment);
            } else {
                result.put("postgresPayment", null);
            }
        } else {
            result.put("postgresReservation", null);
            result.put("postgresOrder", null);
            result.put("postgresPayment", null);
        }

        return ResponseEntity.ok(result);
    }
}
