# FlashFlow Performance & Throughput Report

This report outlines the expected performance metrics, system throughput benchmarks, latency characteristics, and hardware/configuration considerations for the **FlashFlow** high-concurrency flash sale backend. It also details the design strategies required to achieve the horizontal scalability targets specified in the [README](../../README.md).

---

## 1. Concurrency & Throughput Matrix

The system's performance varies dynamically depending on the request type and whether the request hits the **Redis Fast Path** (cache-only) or requires a **PostgreSQL Transaction** (database write path).

| Metric | Best Case (Fast Path Hit) | Average Case (Successful Booking) | Worst Case (Cold Starts & Failures) |
| :--- | :--- | :--- | :--- |
| **Description** | Requests rejected by Rate Limiting, Out of Stock, or Idempotency cache hits in Redis. | Successful request: Rate limit check + Redis stock decrement + DB Reservation & Outbox insert + Redis cache write. | Cache stampede (concurrent cache misses), DB connection pool exhaustion, or downstream Kafka broker failures. |
| **Throughput (TPS)** | **10,000 – 15,000+ requests/sec** (Per Spring Boot instance) | **1,500 – 3,000 requests/sec** (Limited by DB transaction commit speed) | **100 – 300 requests/sec** (Saturated pool / database bottleneck) |
| **Avg. Latency** | **2ms – 5ms** | **15ms – 25ms** | **150ms – 500ms+** (Or timeouts) |
| **DB Utilization** | **0%** (Fully intercepted at Redis layer) | **Moderate to High** (Writes to 3 tables: Reservation, Outbox, Idempotency) | **100% CPU Saturation** (Write lock queuing / connection starvation) |
| **Redis Ops/sec** | High (~20,000+ ops/sec) | Moderate (~5,000 ops/sec) | Low (due to blocking downstream DB waits) |

---

## 2. Server & Redis Infrastructure Considerations

To sustain the throughput figures listed above under production loads, the application server, database, and Redis configuration must be fine-tuned:

### A. Application Server (Spring Boot / Tomcat)
1. **Thread Pool Saturation:** Tomcat's default maximum thread count is **200**. In a flash sale event where thousands of users hit the server, if a slight DB delay increases latency to 100ms, the Tomcat thread pool will saturate in **20 milliseconds**, resulting in immediate `502 Bad Gateway` errors.
   * *Mitigation:* Keep the synchronous Tomcat threads light. Throw out rate-limited or out-of-stock requests at the absolute entrance of the filter chain.
2. **Database Connection Pool (HikariCP):** HikariCP defaults to **10 connections**. For 3,000 TPS on writes, 10 connections will result in massive queue waits.
   * *Mitigation:* Increase connection pool capacity (e.g. `maximum-pool-size=50-100`) and scale PostgreSQL `max_connections` correspondingly.

### B. Redis Layer (Fast-Path Store)
1. **Atomic Lua Script Blocking:** Redis is single-threaded and executes Lua scripts atomically. If a Lua script contains complex operations, it will block the entire Redis instance.
   * *Assessment:* FlashFlow's stock reservation and rate-limiting Lua scripts have an **O(1) time complexity** and are highly optimal.
   * *Mitigation:* Use Redis Sentinel or Redis Cluster. Direct read-only traffic (like active sale check or rate limiting) to replicas, and keep write traffic (stock reservations) on the master node.

### C. Database Layer (PostgreSQL)
1. **Insert Contention:** Because the critical path only performs database inserts (Reservation, OutboxEvent, Idempotency) instead of row updates, the database avoids row locking contentions.
   * *Mitigation:* Partition database tables by date/product and use UUIDs strategically to prevent index insertion bottlenecks.

---

## 3. Road to Achieving the README Concurrency Vision

The README states that FlashFlow is designed to *"prevent system crashes and data inconsistencies when thousands of users attempt to purchase limited inventory simultaneously."* To fully achieve this target, the following optimizations are recommended:

```mermaid
graph TD
    Client[Client Request] --> Filter[JWT & Signature Filter]
    Filter -- "1. Validate User Role/Claims (0 DB Hits)" --> CacheCheck[Redis Cache Validation]
    
    subgraph Redis Entrance Gate (No DB Hits)
        CacheCheck -- "2. Check Rate Limit (Lua)" --> RateL[Rate Limiter]
        CacheCheck -- "3. Check Idempotency Cache" --> Idemp[Idempotency Cache]
        CacheCheck -- "4. Check Product Catalog Cache" --> ProdC[Product Catalog Cache]
        CacheCheck -- "5. Reserve Stock (Lua)" --> Stock[Stock Reservation]
    end
    
    Stock -- "6. Valid & Reserved" --> DBTrans[DB Transaction: Save Reservation, Idempotency, Outbox]
    
    subgraph Database Write Path
        DBTrans
    end
```

### 🚀 Optimization 1: Zero-DB Read Path for Purchase Requests
Currently, every purchase request performs two synchronous database read operations to validate the user and product:
* `userRepository.findById(userId)` in `PurchaseService.java:110`
* `productService.getProductById(productId)` in `PurchaseService.java:121`

If 20,000 users attempt to purchase, PostgreSQL is queried **40,000 times** just for validation.
* **Solution:**
  1. **Leverage Cryptographic JWT Claims:** The JWT token signature already validates that the user is authenticated and registered. We do not need to query the `User` table to verify their details.
  2. **Cache the Product Catalog:** Cache product details (price, status, name) in Redis. Validate the product and its price directly from the Redis cache during purchase checks.
  * *Result:* The validation phase becomes **0 DB Hits**. Saturated or invalid requests are dropped entirely in Redis, preserving 100% of PostgreSQL's resources for actual purchase writes.

### 🚀 Optimization 2: Log-Based Change Data Capture (CDC)
The current transactional outbox pattern uses a polling scheduler (`OutboxPublisherScheduler`) that queries the `outbox_events` table for `PENDING` events every 5 seconds.
* **The Problem:** Polling introduces continuous read overhead on the database and delays event propagation to Kafka, degrading the user checkout experience.
* **Solution:** Replace the polling scheduler with **Debezium** or a log-miner that tails PostgreSQL's Write-Ahead Log (WAL) and streams outbox events to Kafka in real-time.
  * *Result:* Zero read query overhead on the DB, and near-zero latency from database transaction commit to Kafka dispatch.

### 🚀 Optimization 3: Asynchronous Database Write Batching
Instead of making database writes synchronously during the HTTP thread:
* Write the reservation request to a high-speed memory ring buffer (e.g. LMAX Disruptor) or Redis stream.
* Perform bulk inserts into PostgreSQL in batches (e.g. 50 reservations at once).
  * *Result:* Reduces database commit overhead by up to **80%**, lifting write throughput to **10,000+ bookings/sec**.
