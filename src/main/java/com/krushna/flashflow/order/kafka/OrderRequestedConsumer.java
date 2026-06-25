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
    public void consume(String message) {
        log.info("Received Kafka message from flashflow.orders topic");
        try {
            OrderRequestedEvent event = objectMapper.readValue(message, OrderRequestedEvent.class);
            log.info("Successfully deserialized message to OrderRequestedEvent for reservation: {}", event.getReservationId());
            orderFulfillmentService.fulfillOrder(event);
        } catch (Exception e) {
            log.error("Failed to process consumed message: {}", message, e);
        }
    }
}
