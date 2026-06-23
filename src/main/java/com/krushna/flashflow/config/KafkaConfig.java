package com.krushna.flashflow.config;

import org.apache.kafka.clients.admin.NewTopic;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.config.TopicBuilder;

@Configuration
public class KafkaConfig {

    // Skeleton configuration for Kafka
    
    @Bean
    public NewTopic ordersTopic() {
        return TopicBuilder.name("flashflow.orders")
                .partitions(3)
                .replicas(1)
                .build();
    }
    
    @Bean
    public NewTopic paymentsTopic() {
        return TopicBuilder.name("flashflow.payments")
                .partitions(3)
                .replicas(1)
                .build();
    }
}
