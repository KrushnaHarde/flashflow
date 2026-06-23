package com.krushna.flashflow.order;

import lombok.Data;
import java.util.UUID;

@Data
public class PurchaseRequestDto {
    private UUID userId;
    private UUID productId;
    private Integer quantity;
    private String idempotencyKey;
}
