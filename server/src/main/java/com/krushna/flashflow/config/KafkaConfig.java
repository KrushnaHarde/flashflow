package com.krushna.flashflow.config;

import org.apache.kafka.clients.admin.NewTopic;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.config.TopicBuilder;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.kafka.listener.CommonErrorHandler;
import org.springframework.kafka.listener.DeadLetterPublishingRecoverer;
import org.springframework.kafka.listener.DefaultErrorHandler;
import org.springframework.util.backoff.FixedBackOff;

@Configuration
public class KafkaConfig {

    @Bean
    public NewTopic ordersTopic() {
        return TopicBuilder.name("flashflow.orders")
                .partitions(8)
                .replicas(1)
                .build();
    }
    
    @Bean
    public NewTopic paymentsTopic() {
        return TopicBuilder.name("flashflow.payments")
                .partitions(8)
                .replicas(1)
                .build();
    }

    @Bean
    public NewTopic reservationsTopic() {
        return TopicBuilder.name("flashflow.reservations")
                .partitions(8)
                .replicas(1)
                .build();
    }

    @Bean
    public NewTopic ordersDltTopic() {
        return TopicBuilder.name("flashflow.orders.DLT")
                .partitions(1)
                .replicas(1)
                .build();
    }

    @Bean
    public NewTopic paymentsDltTopic() {
        return TopicBuilder.name("flashflow.payments.DLT")
                .partitions(1)
                .replicas(1)
                .build();
    }

    @Bean
    public CommonErrorHandler errorHandler(KafkaTemplate<String, String> template) {
        DeadLetterPublishingRecoverer recoverer = new DeadLetterPublishingRecoverer(template);
        return new DefaultErrorHandler(recoverer, new FixedBackOff(1000L, 2L));
    }
}
