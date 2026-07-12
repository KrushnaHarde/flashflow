package com.krushna.flashflow.order.event;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.util.UUID;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class OrderRequestedEvent {
    private UUID reservationId;
    private UUID userId;
    private UUID productId;
    private Integer quantity;
    private BigDecimal totalAmount;
    private BigDecimal unitPrice;
    private java.time.LocalDateTime expiresAt;
    private String idempotencyKey;
}
