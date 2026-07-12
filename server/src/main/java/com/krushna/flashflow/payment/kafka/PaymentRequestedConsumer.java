package com.krushna.flashflow.payment.kafka;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.krushna.flashflow.order.Order;
import com.krushna.flashflow.payment.PaymentFulfillmentService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.stereotype.Service;

@Service
@Slf4j
@RequiredArgsConstructor
public class PaymentRequestedConsumer {

    private final PaymentFulfillmentService paymentFulfillmentService;
    private final ObjectMapper objectMapper = new ObjectMapper()
            .registerModule(new com.fasterxml.jackson.datatype.jsr310.JavaTimeModule());

    @KafkaListener(topics = "flashflow.payments", groupId = "flashflow-group", concurrency = "8")
    public void consume(String message) throws Exception {
        log.info("Received Kafka message from flashflow.payments topic");
        Order order = objectMapper.readValue(message, Order.class);
        log.info("Successfully deserialized order ID: {} from payments topic. Processing payment...", order.getOrderId());
        
        int attempts = 0;
        while (true) {
            attempts++;
            try {
                paymentFulfillmentService.fulfillPayment(order);
                break;
            } catch (org.springframework.dao.OptimisticLockingFailureException e) {
                if (attempts >= 10) {
                    log.error("Optimistic locking failed after 10 attempts for order {}", order.getOrderId(), e);
                    throw e;
                }
                log.warn("Optimistic locking failure on attempt {} for order {}, retrying...", attempts, order.getOrderId());
                Thread.sleep(30 + new java.util.Random().nextInt(40));
            }
        }
    }
}
