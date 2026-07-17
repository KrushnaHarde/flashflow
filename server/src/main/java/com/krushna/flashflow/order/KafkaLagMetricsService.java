package com.krushna.flashflow.order;

import io.micrometer.core.instrument.MeterRegistry;
import lombok.extern.slf4j.Slf4j;
import org.apache.kafka.clients.admin.*;
import org.apache.kafka.clients.consumer.OffsetAndMetadata;
import org.apache.kafka.common.TopicPartition;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import jakarta.annotation.PostConstruct;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;

@Service
@Slf4j
public class KafkaLagMetricsService {

    private final MeterRegistry meterRegistry;
    private final String kafkaBootstrapServers;
    private final AtomicLong maxLagValue = new AtomicLong(0);

    public KafkaLagMetricsService(
            MeterRegistry meterRegistry,
            @Value("${spring.kafka.bootstrap-servers:localhost:9092}") String kafkaBootstrapServers) {
        this.meterRegistry = meterRegistry;
        this.kafkaBootstrapServers = kafkaBootstrapServers;
    }

    @PostConstruct
    public void init() {
        // Register the gauge in Micrometer pointing to the atomic maxLagValue
        meterRegistry.gauge("kafka.consumer.lag", maxLagValue);
        log.info("Registered custom Micrometer gauge kafka.consumer.lag");
    }

    @Scheduled(fixedDelay = 5000)
    public void updateKafkaLag() {
        long maxLag = 0;
        String groupName = "flashflow-group";

        Properties props = new Properties();
        props.put(AdminClientConfig.BOOTSTRAP_SERVERS_CONFIG, kafkaBootstrapServers);

        try (AdminClient adminClient = AdminClient.create(props)) {
            // Find active consumer groups matching "flashflow-group"
            Collection<ConsumerGroupListing> groups =
                adminClient.listConsumerGroups().all().get(3, TimeUnit.SECONDS);
            for (ConsumerGroupListing g : groups) {
                if (g.groupId().contains("flashflow-group")) {
                    groupName = g.groupId();
                    break;
                }
            }

            ListConsumerGroupOffsetsResult offsetsResult =
                adminClient.listConsumerGroupOffsets(groupName);
            Map<TopicPartition, OffsetAndMetadata> offsets =
                offsetsResult.partitionsToOffsetAndMetadata().get(3, TimeUnit.SECONDS);

            if (offsets != null && !offsets.isEmpty()) {
                Map<TopicPartition, OffsetSpec> requestOffsets = new HashMap<>();
                for (TopicPartition tp : offsets.keySet()) {
                    requestOffsets.put(tp, OffsetSpec.latest());
                }

                Map<TopicPartition, ListOffsetsResult.ListOffsetsResultInfo> endOffsets =
                    adminClient.listOffsets(requestOffsets).all().get(3, TimeUnit.SECONDS);

                for (Map.Entry<TopicPartition, OffsetAndMetadata> entry : offsets.entrySet()) {
                    TopicPartition tp = entry.getKey();
                    long currentOffset = entry.getValue().offset();
                    ListOffsetsResult.ListOffsetsResultInfo endOffsetInfo = endOffsets.get(tp);
                    if (endOffsetInfo != null) {
                        long endOffset = endOffsetInfo.offset();
                        long lag = endOffset - currentOffset;
                        if (lag > maxLag) {
                            maxLag = lag;
                        }
                    }
                }
            }
        } catch (Exception e) {
            log.warn("Failed to update Kafka consumer group lag for gauge: {}", e.getMessage());
        }

        maxLagValue.set(maxLag);
    }
}
