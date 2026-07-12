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

    @org.springframework.beans.factory.annotation.Value("${flashflow.schedulers.enabled:true}")
    private boolean schedulersEnabled;

    @Scheduled(fixedDelay = 30000)
    public void scheduleReservationExpiry() {
        if (!schedulersEnabled) {
            log.debug("ReservationExpiryScheduler is disabled by config.");
            return;
        }
        log.info("Running reservation expiry checker task...");
        int attempts = 0;
        while (true) {
            attempts++;
            try {
                reservationExpiryService.expireReservations();
                break;
            } catch (org.springframework.dao.OptimisticLockingFailureException e) {
                if (attempts >= 10) {
                    log.error("Reservation expiration failed after 10 attempts due to optimistic locking", e);
                    break;
                }
                log.warn("Optimistic locking failure during reservation expiration, attempt {}, retrying...", attempts);
                try {
                    Thread.sleep(30 + new java.util.Random().nextInt(40));
                } catch (InterruptedException ie) {
                    Thread.currentThread().interrupt();
                    break;
                }
            } catch (Exception e) {
                log.error("Error occurred while processing reservation expiration", e);
                break;
            }
        }
    }
}
