package com.krushna.flashflow.order;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.time.LocalDateTime;
import java.util.UUID;

@Repository
public interface IdempotencyRepository extends JpaRepository<Idempotency, IdempotencyId> {
    Optional<Idempotency> findByOrderId(UUID orderId);
    List<Idempotency> findByStatusAndCreatedAtBefore(IdempotencyStatus status, LocalDateTime dateTime);
}
