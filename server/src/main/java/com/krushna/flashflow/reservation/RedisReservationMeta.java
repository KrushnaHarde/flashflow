package com.krushna.flashflow.reservation;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.UUID;

@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RedisReservationMeta {
    private UUID reservationId;
    private UUID userId;
    private UUID productId;
    private Integer quantity;
    private BigDecimal unitPrice;
    private BigDecimal totalAmount;
    private String idempotencyKey;
    private String traceId;
    private int retryCount;
    private LocalDateTime expiresAt;
    private LocalDateTime createdAt;
}
