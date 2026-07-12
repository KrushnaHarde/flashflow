package com.krushna.flashflow.common;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;

@Component
@EnableScheduling
@Slf4j
@RequiredArgsConstructor
public class OutboxPublisherScheduler {

    private final OutboxService outboxService;
    private final KafkaTemplate<String, String> kafkaTemplate;

    @Value("${flashflow.outbox.max-retries:3}")
    private int maxRetries;

    @Value("${flashflow.schedulers.enabled:true}")
    private boolean schedulersEnabled;

    @Scheduled(fixedDelayString = "${flashflow.outbox.relay-interval-ms:5000}")
    public void publishPendingEvents() {
        if (!schedulersEnabled) {
            log.debug("OutboxPublisherScheduler is disabled by config.");
            return;
        }

        List<OutboxEvent> pendingEvents = outboxService.getPendingEvents();
        if (pendingEvents.isEmpty()) {
            return;
        }

        log.info("Found {} pending outbox events to publish", pendingEvents.size());

        List<CompletableFuture<Boolean>> futures = new ArrayList<>();

        for (OutboxEvent event : pendingEvents) {
            String topic = resolveTopic(event);
            if (topic == null) {
                log.debug("Skipping outbox event {} (no topic resolved/ignored aggregate: {})", 
                        event.getEventId(), event.getAggregateType());
                continue;
            }

            try {
                log.info("Publishing outbox event {} to topic {} with key {}", 
                        event.getEventId(), topic, event.getAggregateId());

                // Asynchronously send to Kafka
                CompletableFuture<Boolean> future = kafkaTemplate.send(topic, event.getAggregateId().toString(), event.getPayload())
                        .thenApply(result -> true)
                        .exceptionally(ex -> false);

                futures.add(future.thenApply(success -> {
                    if (success) {
                        outboxService.markAsSent(event.getEventId());
                    } else {
                        outboxService.handleFailure(event.getEventId(), maxRetries);
                    }
                    return success;
                }));
            } catch (Exception e) {
                log.error("Failed to publish outbox event {} to topic {}", event.getEventId(), topic, e);
                outboxService.handleFailure(event.getEventId(), maxRetries);
            }
        }

        // Wait for all publishes to finish at the end of the polling cycle
        if (!futures.isEmpty()) {
            try {
                CompletableFuture.allOf(futures.toArray(new CompletableFuture[0])).get();
            } catch (Exception e) {
                log.error("Error waiting for async outbox publishes", e);
            }
        }
    }

    private String resolveTopic(OutboxEvent event) {
        String eventType = event.getEventType();
        if ("ORDER_REQUESTED".equalsIgnoreCase(eventType)) {
            return null; // Bypass ORDER_REQUESTED outbox events (handled directly by PurchaseService)
        }
        String type = event.getAggregateType();
        if ("ORDER".equalsIgnoreCase(type) || "PAYMENT".equalsIgnoreCase(type)) {
            return "flashflow.payments";
        } else if ("RESERVATION".equalsIgnoreCase(type)) {
            return "flashflow.reservations";
        }
        return null;
    }
}
