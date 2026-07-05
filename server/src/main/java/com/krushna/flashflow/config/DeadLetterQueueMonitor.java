package com.krushna.flashflow.config;

import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.messaging.handler.annotation.Header;
import org.springframework.messaging.handler.annotation.Payload;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

@Component
@RestController
@Slf4j
public class DeadLetterQueueMonitor {

    private final AtomicLong ordersDltCount = new AtomicLong(0);
    private final AtomicLong paymentsDltCount = new AtomicLong(0);
    private final List<String> recentDltMessages = Collections.synchronizedList(new ArrayList<>());

    @KafkaListener(topics = "flashflow.orders.DLT", groupId = "flashflow-dlt-monitor")
    public void listenOrdersDlt(@Payload String message, @Header(org.springframework.kafka.support.KafkaHeaders.RECEIVED_PARTITION) int partition) {
        ordersDltCount.incrementAndGet();
        String logMsg = "DLT Received [flashflow.orders.DLT] partition=" + partition + " payload=" + message;
        log.error(logMsg);
        trackMessage(logMsg);
    }

    @KafkaListener(topics = "flashflow.payments.DLT", groupId = "flashflow-dlt-monitor")
    public void listenPaymentsDlt(@Payload String message, @Header(org.springframework.kafka.support.KafkaHeaders.RECEIVED_PARTITION) int partition) {
        paymentsDltCount.incrementAndGet();
        String logMsg = "DLT Received [flashflow.payments.DLT] partition=" + partition + " payload=" + message;
        log.error(logMsg);
        trackMessage(logMsg);
    }

    private void trackMessage(String msg) {
        recentDltMessages.add(0, msg);
        if (recentDltMessages.size() > 50) {
            recentDltMessages.remove(recentDltMessages.size() - 1);
        }
    }

    @GetMapping("/admin/dlt/stats")
    public Map<String, Object> getDltStats() {
        return Map.of(
            "ordersDltCount", ordersDltCount.get(),
            "paymentsDltCount", paymentsDltCount.get(),
            "recentMessages", recentDltMessages
        );
    }
}
