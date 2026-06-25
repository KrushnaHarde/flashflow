package com.krushna.flashflow.order;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Slf4j
@RequiredArgsConstructor
public class PurchaseController {

    private final PurchaseService purchaseService;

    @PostMapping("/purchase")
    public ResponseEntity<?> purchase(@RequestBody PurchaseRequestDto request) {
        log.info("Received purchase request for user: {}, product: {}", request.getUserId(), request.getProductId());
        try {
            PurchaseResponseDto response = purchaseService.purchase(request);
            log.info("Purchase request successfully accepted. Reservation: {}", response.getReservationId());
            return ResponseEntity.accepted().body(response);
        } catch (IllegalArgumentException e) {
            log.warn("Validation failed for purchase request: {}", e.getMessage());
            return ResponseEntity.badRequest().body(e.getMessage());
        } catch (IllegalStateException e) {
            log.warn("Illegal state/conflict for purchase request: {}", e.getMessage());
            if (e.getMessage().contains("Rate limit")) {
                return ResponseEntity.status(429).body(e.getMessage());
            }
            return ResponseEntity.status(409).body(e.getMessage());
        } catch (Exception e) {
            log.error("Internal error processing purchase request", e);
            return ResponseEntity.internalServerError().body("An internal error occurred: " + e.getMessage());
        }
    }
}
