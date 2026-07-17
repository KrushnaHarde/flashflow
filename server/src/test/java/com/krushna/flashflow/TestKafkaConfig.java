package com.krushna.flashflow;

import org.mockito.Mockito;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.kafka.core.KafkaTemplate;

@Configuration
@Profile("test")
public class TestKafkaConfig {

    @Bean
    @SuppressWarnings("unchecked")
    public KafkaTemplate<String, String> kafkaTemplate() {
        return Mockito.mock(KafkaTemplate.class);
    }

    @Bean
    public org.springframework.data.redis.core.StringRedisTemplate stringRedisTemplate() {
        return Mockito.mock(org.springframework.data.redis.core.StringRedisTemplate.class, Mockito.RETURNS_DEEP_STUBS);
    }
}
