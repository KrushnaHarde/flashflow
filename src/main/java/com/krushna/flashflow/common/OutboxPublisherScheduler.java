package com.krushna.flashflow.common;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
@EnableScheduling
@Slf4j
@RequiredArgsConstructor
public class OutboxPublisherScheduler {

    private final OutboxService outboxService;
    private final KafkaTemplate<String, String> kafkaTemplate;

    @Value("${flashflow.outbox.max-retries:3}")
    private int maxRetries;

    @Scheduled(fixedDelayString = "${flashflow.outbox.relay-interval-ms:5000}")
    public void publishPendingEvents() {
        List<OutboxEvent> pendingEvents = outboxService.getPendingEvents();
        if (pendingEvents.isEmpty()) {
            return;
        }

        log.info("Found {} pending outbox events to publish", pendingEvents.size());

        for (OutboxEvent event : pendingEvents) {
            String topic = resolveTopic(event);
            if (topic == null) {
                log.error("Unable to resolve Kafka topic for aggregate: {}", event.getAggregateType());
                outboxService.handleFailure(event.getEventId(), maxRetries);
                continue;
            }

            try {
                log.info("Publishing outbox event {} to topic {} with key {}", 
                        event.getEventId(), topic, event.getAggregateId());

                // Synchronously wait for publish to finish to guarantee at-least-once delivery
                kafkaTemplate.send(topic, event.getAggregateId().toString(), event.getPayload())
                        .get();

                outboxService.markAsSent(event.getEventId());
            } catch (Exception e) {
                log.error("Failed to publish outbox event {} to topic {}", event.getEventId(), topic, e);
                outboxService.handleFailure(event.getEventId(), maxRetries);
            }
        }
    }

    private String resolveTopic(OutboxEvent event) {
        String type = event.getAggregateType();
        if ("ORDER".equalsIgnoreCase(type) || "PAYMENT".equalsIgnoreCase(type)) {
            return "flashflow.payments";
        }
        return null;
    }
}
