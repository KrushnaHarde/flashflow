package com.krushna.flashflow.payment;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface PaymentRepository extends JpaRepository<Payment, UUID> {
    java.util.Optional<Payment> findByOrderId(UUID orderId);
}
