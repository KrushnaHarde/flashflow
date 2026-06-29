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
    private final ObjectMapper objectMapper = new ObjectMapper();

    @KafkaListener(topics = "flashflow.payments", groupId = "flashflow-group")
    public void consume(String message) {
        log.info("Received Kafka message from flashflow.payments topic");
        try {
            Order order = objectMapper.readValue(message, Order.class);
            log.info("Successfully deserialized order ID: {} from payments topic. Processing payment...", order.getOrderId());
            paymentFulfillmentService.fulfillPayment(order);
        } catch (Exception e) {
            log.error("Failed to process payment event: {}", message, e);
        }
    }
}
