package com.krushna.flashflow.order;

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
public class PurchaseResponseDto {
    private UUID reservationId;
    private String status;
    private BigDecimal totalAmount;
}
