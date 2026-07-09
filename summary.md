# Executive Performance Report: FlashFlow Stress Capacity

## Executive Summary

- **Maximum Sustained Throughput**: 83 RPS
- **Maximum Sustained Concurrent Users**: 50 VUs
- **First SLA Breach**: 500_rps (Target 500 RPS)
- **Breaking Point / Knee Point**: 1k_rps (Target 1000 RPS)
- **Primary Bottleneck**: Database Lock Contention / Async Overhead
- **Overall Correctness**: 72 / 100
- **Overall Score**: 24 / 100

## Environment Summary

| Parameter | Value |
| :--- | :--- |
| testMode | Capacity / Regression Testing |
| execution | Local |
| os | Windows (10.0.26200) |
| cpu | AMD Ryzen 7 5800HS with Radeon Graphics         |
| ram | 15.4 GB |
| javaVersion | Unknown |
| springBootVersion | 3.4.1 |
| redisVersion | 7.4.9 |
| kafkaVersion | 3.8.1 (cp-kafka:7.4.0) |
| postgresVersion | 15.18 |
| k6Version | k6.exe v2.1.0 (commit/83a87a41e2, go1.26.4, windows/amd64) |

## Staged Metrics & Performance Matrix

| Stage | Target RPS | Actual RPS | Req Count | p95 Latency | p99 Latency | Error Rate | CPU Max | Hikari Active | SLA Status |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **1_rps** | 1 | 0.8 | 12 | 138.7 ms | 203.7 ms | 0.00% | 96% | 0.0 | PASS |
| **10_rps** | 10 | 8.3 | 125 | 76.6 ms | 91.6 ms | 0.00% | 39% | 0.1 | PASS |
| **100_rps** | 100 | 83.3 | 1249 | 54.5 ms | 66.3 ms | 0.00% | 50% | 1.6 | PASS |
| **500_rps** | 500 | 280.9 | 4213 | 9821.6 ms | 11414.7 ms | 0.00% | 70% | 4.3 | FAIL |
| **1k_rps** | 1000 | 157.3 | 2360 | 33269.4 ms | 35317.5 ms | 0.00% | 0% | 0.0 | FAIL |
| **5k_rps** | 5000 | 265.4 | 3981 | 0.0 ms | 43716.6 ms | 95.00% | 0% | 0.0 | FAIL |
| **10k_rps** | 10000 | 1394.9 | 20924 | 0.0 ms | 0.0 ms | 100.00% | 0% | 0.0 | FAIL |

## Bottleneck Analysis per Stage

### Stage: 1_rps (PASS)
- **Likely Cause**: None
- **Evidence**: N/A
- **Recommendation**: N/A

### Stage: 10_rps (PASS)
- **Likely Cause**: None
- **Evidence**: N/A
- **Recommendation**: N/A

### Stage: 100_rps (PASS)
- **Likely Cause**: None
- **Evidence**: N/A
- **Recommendation**: N/A

### Stage: 500_rps (FAIL)
- **Likely Cause**: Database Connection Pool Saturation
- **Evidence**: Hikari active connections peaked at 4.3/10. Active threads waiting for pool: 142.
- **Recommendation**: Increase spring.datasource.hikari.maximum-pool-size in the application properties or optimize slow DB queries.

### Stage: 1k_rps (FAIL)
- **Likely Cause**: Database Lock Contention / Async Overhead
- **Evidence**: Thread saturation observed (live threads: normal).
- **Recommendation**: Move heavy database persistence fully behind Kafka and make order processing fully event-driven.

### Stage: 5k_rps (FAIL)
- **Likely Cause**: Tomcat Connector Backlog/OS Port Exhaustion
- **Evidence**: Error rate reached 95.0% due to connection refusals.
- **Recommendation**: Increase server.tomcat.threads.max or apply OS registry fixes to increase TCP max ports.

### Stage: 10k_rps (FAIL)
- **Likely Cause**: Tomcat Connector Backlog/OS Port Exhaustion
- **Evidence**: Error rate reached 100.0% due to connection refusals.
- **Recommendation**: Increase server.tomcat.threads.max or apply OS registry fixes to increase TCP max ports.

## Actionable Optimization Recommendations

### Database Connection Pool
Increase the HikariCP pool size (e.g. spring.datasource.hikari.maximum-pool-size=50) and evaluate slow queries. Ensure the tables have proper indexes (particularly reservations and outbox_events). Enable Hibernate JDBC batching properties.

### Redis Cache Layer
Optimize Lettuce Redis connection sharing. Use Redis pipeline operations or wrap multiple commands into single atomized Lua scripts inside RateLimiterService and RedisInventoryService to reduce roundtrip execution cycles.

### JVM / Host CPU Scaling
Run Spring Boot with optimized JVM Garbage Collection settings (e.g., -XX:+UseG1GC) or allocate more CPU cores to the hosting node. Profile code path threads using jstack during high load.

### Load Generation & OS Backlog
When local loopback connection limits are hit (resulting in refused connections at 5k+ RPS), scale load testing horizontally by running distributed k6 nodes or optimize local Windows registry TCP backlog configurations (MaxUserPort and TcpTimedWaitDelay).

