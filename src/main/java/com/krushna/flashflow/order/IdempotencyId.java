package com.krushna.flashflow.order;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;
import java.util.UUID;

@Data
@NoArgsConstructor
@AllArgsConstructor
public class IdempotencyId implements Serializable {
    private String idempotencyKey;
    private UUID userId;
}
