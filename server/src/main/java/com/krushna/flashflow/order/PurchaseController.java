package com.krushna.flashflow.order;

import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
@Slf4j
@RequiredArgsConstructor
@Tag(name = "Purchase", description = "Endpoints for initiating concurrent flash sale purchase transactions")
public class PurchaseController {

    private final PurchaseService purchaseService;

    @PostMapping("/purchase")
    @Operation(summary = "Initiate flash sale purchase", description = "Validates user/product availability, reserves Redis stock, and schedules order processing synchronously or asynchronously.")
    public ResponseEntity<PurchaseResponseDto> purchase(@RequestBody PurchaseRequestDto request) {
        log.info("Received purchase request for user: {}, product: {}", request.getUserId(), request.getProductId());
        PurchaseResponseDto response = purchaseService.purchase(request);
        log.info("Purchase request successfully accepted. Reservation: {}", response.getReservationId());
        return ResponseEntity.accepted()
                .header("X-Trace-Id", response.getReservationId().toString())
                .body(response);
    }
}
