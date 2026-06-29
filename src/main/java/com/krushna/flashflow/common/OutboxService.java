package com.krushna.flashflow.common;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

@Service
@Slf4j
@RequiredArgsConstructor
public class OutboxService {

    private final OutboxEventRepository outboxEventRepository;

    @Transactional(readOnly = true)
    public List<OutboxEvent> getPendingEvents() {
        log.debug("Fetching pending outbox events");
        return outboxEventRepository.findByStatus("PENDING");
    }

    @Transactional
    public void markAsSent(UUID eventId) {
        log.info("Marking outbox event {} as SENT", eventId);
        outboxEventRepository.findById(eventId).ifPresent(event -> {
            event.setStatus("SENT");
            outboxEventRepository.save(event);
        });
    }

    @Transactional
    public void handleFailure(UUID eventId, int maxRetries) {
        log.warn("Handling failure for outbox event {}", eventId);
        outboxEventRepository.findById(eventId).ifPresent(event -> {
            int newRetryCount = event.getRetryCount() + 1;
            event.setRetryCount(newRetryCount);
            if (newRetryCount >= maxRetries) {
                log.error("Outbox event {} reached maximum retries ({}). Marking as FAILED.", eventId, maxRetries);
                event.setStatus("FAILED");
            } else {
                log.info("Incremented retry count for outbox event {} to {}", eventId, newRetryCount);
            }
            outboxEventRepository.save(event);
        });
    }
}
