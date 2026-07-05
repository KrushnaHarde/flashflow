package com.krushna.flashflow.order;

public enum IdempotencyStatus {
    PROCESSING,
    ORDER_CREATED,
    COMPLETED,
    FAILED
}
