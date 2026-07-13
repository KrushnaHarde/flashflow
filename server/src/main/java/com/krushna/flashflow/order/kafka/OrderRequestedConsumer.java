package com.krushna.flashflow.order.kafka;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.krushna.flashflow.order.OrderFulfillmentService;
import com.krushna.flashflow.order.event.OrderRequestedEvent;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;
import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Counter;
import jakarta.annotation.PostConstruct;

@Service
@Slf4j
@RequiredArgsConstructor
public class OrderRequestedConsumer {

    private final OrderFulfillmentService orderFulfillmentService;
    private final ObjectMapper objectMapper = new ObjectMapper()
            .registerModule(new com.fasterxml.jackson.datatype.jsr310.JavaTimeModule());
    private final MeterRegistry meterRegistry;
    private Counter confirmedCounter;
    private Counter optLockRetryCounter;

    @PostConstruct
    public void init() {
        this.confirmedCounter = meterRegistry.counter("orders.confirmed.count");
        this.optLockRetryCounter = meterRegistry.counter("optimistic.lock.retry.count");
    }

    public void consume(String message) throws Exception {
        consume(message, null, null);
    }

    @KafkaListener(topics = "flashflow.orders", groupId = "flashflow-group", concurrency = "8")
    public void consume(String message, 
                        @org.springframework.messaging.handler.annotation.Header(value = org.springframework.kafka.support.KafkaHeaders.RECEIVED_KEY, required = false) String key, 
                        @org.springframework.messaging.handler.annotation.Headers org.springframework.messaging.MessageHeaders headers) throws Exception {
        log.info("Received Kafka message from flashflow.orders topic");
        String traceId = null;
        if (headers != null) {
            byte[] traceIdBytes = (byte[]) headers.get("traceId");
            if (traceIdBytes != null) {
                traceId = new String(traceIdBytes, java.nio.charset.StandardCharsets.UTF_8);
            }
        }
        if (traceId == null) {
            traceId = key;
        }

        OrderRequestedEvent event = objectMapper.readValue(message, OrderRequestedEvent.class);
        if (traceId == null) {
            traceId = event.getReservationId() != null ? event.getReservationId().toString() : "UNKNOWN";
        }
        
        log.info("{\"traceId\":\"{}\", \"event\":\"consumed by Worker\"}", traceId);
        log.info("Successfully deserialized message to OrderRequestedEvent for reservation: {}", event.getReservationId());
        
        int attempts = 0;
        while (true) {
            attempts++;
            try {
                orderFulfillmentService.fulfillOrder(event);
                confirmedCounter.increment();
                break;
            } catch (org.springframework.dao.OptimisticLockingFailureException e) {
                optLockRetryCounter.increment();
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
