package com.krushna.flashflow.order.kafka;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.krushna.flashflow.order.event.OrderRequestedEvent;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Service;

@Service
@Slf4j
@RequiredArgsConstructor
public class OrderEventProducer {

    private final KafkaTemplate<String, String> kafkaTemplate;
    private final ObjectMapper objectMapper = new ObjectMapper();

    public void publishOrderRequested(OrderRequestedEvent event) {
        log.info("Publishing OrderRequestedEvent for reservation: {}", event.getReservationId());
        try {
            String json = objectMapper.writeValueAsString(event);
            kafkaTemplate.send("flashflow.orders", event.getReservationId().toString(), json)
                    .whenComplete((result, ex) -> {
                        if (ex != null) {
                            log.error("Failed to publish OrderRequestedEvent for reservation: {}", event.getReservationId(), ex);
                        } else {
                            log.info("Successfully published OrderRequestedEvent for reservation: {} to partition: {}", 
                                    event.getReservationId(), result.getRecordMetadata().partition());
                        }
                    });
        } catch (Exception e) {
            log.error("Failed to serialize OrderRequestedEvent for reservation: {}", event.getReservationId(), e);
            throw new RuntimeException("Failed to serialize OrderRequestedEvent", e);
        }
    }
}
