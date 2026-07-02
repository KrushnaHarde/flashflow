package com.krushna.flashflow.reservation;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@EnableScheduling
@Slf4j
@RequiredArgsConstructor
public class ReservationExpiryScheduler {

    private final ReservationExpiryService reservationExpiryService;

    @Scheduled(fixedDelay = 30000)
    public void scheduleReservationExpiry() {
        log.info("Running reservation expiry checker task...");
        try {
            reservationExpiryService.expireReservations();
        } catch (Exception e) {
            log.error("Error occurred while processing reservation expiration", e);
        }
    }
}
