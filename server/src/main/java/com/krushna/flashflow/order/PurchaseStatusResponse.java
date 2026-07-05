package com.krushna.flashflow.order;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.UUID;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class PurchaseStatusResponse {
    private UUID reservationId;
    private String reservationStatus;
    private UUID orderId;
    private String orderStatus;
    private String paymentStatus;
}
