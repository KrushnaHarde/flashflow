package com.krushna.flashflow.order;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/purchase")
public class PurchaseController {

    @PostMapping
    public ResponseEntity<Void> purchase(@RequestBody PurchaseRequestDto request) {
        // Minimal stub implementation. 
        // 202 Accepted signifies the request has been accepted for processing, 
        // but the processing has not been completed (async flow).
        return ResponseEntity.accepted().build();
    }
}
