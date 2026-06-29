package com.krushna.flashflow.payment;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;

@Service
@Slf4j
@RequiredArgsConstructor
public class PaymentService {

    public String processPayment(BigDecimal amount) {
        log.info("Processing mock payment for amount: {}", amount);

        // Deterministic mock logic:
        // amount <= 50000 -> SUCCESS
        // amount > 50000 -> FAILED
        if (amount.compareTo(new BigDecimal("50000")) <= 0) {
            log.info("Mock payment success for amount: {}", amount);
            return "SUCCESS";
        } else {
            log.warn("Mock payment failed for amount: {} (amount exceeds 50000 limit)", amount);
            return "FAILED";
        }
    }
}
