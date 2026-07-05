package com.krushna.flashflow.order.kafka;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.krushna.flashflow.order.OrderFulfillmentService;
import com.krushna.flashflow.order.event.OrderRequestedEvent;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;

@Service
@Slf4j
@RequiredArgsConstructor
public class OrderRequestedConsumer {

    private final OrderFulfillmentService orderFulfillmentService;
    private final ObjectMapper objectMapper = new ObjectMapper();

    @KafkaListener(topics = "flashflow.orders", groupId = "flashflow-group")
    public void consume(String message) throws Exception {
        log.info("Received Kafka message from flashflow.orders topic");
        OrderRequestedEvent event = objectMapper.readValue(message, OrderRequestedEvent.class);
        log.info("Successfully deserialized message to OrderRequestedEvent for reservation: {}", event.getReservationId());
        
        int attempts = 0;
        while (true) {
            attempts++;
            try {
                orderFulfillmentService.fulfillOrder(event);
                break;
            } catch (org.springframework.dao.OptimisticLockingFailureException e) {
                if (attempts >= 10) {
                    log.error("Optimistic locking failed after 10 attempts for reservation {}", event.getReservationId(), e);
                    throw e;
                }
                log.warn("Optimistic locking failure on attempt {} for reservation {}, retrying...", attempts, event.getReservationId());
                Thread.sleep(30 + new java.util.Random().nextInt(40));
            }
        }
    }
}
