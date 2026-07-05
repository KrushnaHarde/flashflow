package com.krushna.flashflow.reservation;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.UUID;

@Repository
public interface ReservationRepository extends JpaRepository<Reservation, UUID> {
    java.util.List<Reservation> findByStatusAndExpiresAtBefore(ReservationStatus status, java.time.LocalDateTime now);
}
