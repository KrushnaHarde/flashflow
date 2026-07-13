# Failure Conditions & Handling

In a high-concurrency environment, failures are expected. FlashFlow is designed to degrade gracefully and recover consistency systematically.

## 1. Redis Failure
* **Condition**: Redis goes down or becomes unreachable during checkout.
* **Impact**: Rate limiting, idempotency checks, and fast stock reservations fail.
* **Handling**: 
    * The driver throws a connection exception which propagates to the `GlobalExceptionHandler`, returning `500 Internal Server Error` (in a real production setup, we return `503 Service Unavailable` or degrade gracefully to protect PostgreSQL from traffic spikes).
    * **Prevention**: Active profile `redis-sentinel` configuration (`application-redis-sentinel.properties`) defines Sentinel nodes monitoring a master with read replicas (`redis-master`, `redis-slave`) for automatic failover.

## 2. Kafka Publish Failure on Hot Path
* **Condition**: The API server successfully decrements stock in Redis but fails to publish the `OrderRequestedEvent` to Kafka due to broker timeouts.
* **Impact**: Stock is locked in Redis, but no order is ever scheduled for creation.
* **Handling**:
    * `PurchaseService.java` catches any exception during `kafkaTemplate.send()`.
    * It immediately executes a rollback: calling `redisInventoryService.releaseStock()` to add the decremented quantity back to Redis.
    * It returns a `500 Internal Server Error` to the client.

## 3. Kafka Duplicate Delivery & At-Least-Once Semantics
* **Condition**: Kafka delivers the same event multiple times due to networking hiccups or rebalancing.
* **Impact**: Duplicate order creation or double payment.
* **Handling**:
    * **Order Consumer**: `OrderFulfillmentService.java` queries PostgreSQL to see if the `reservationId` or an order for that reservation already exists in the database. If so, it returns immediately without processing.
    * **Payment Consumer**: `PaymentFulfillmentService.java` queries PostgreSQL to verify the payment record is still in `PENDING` state. If it is already `SUCCESS` or `FAILED`, it returns immediately.
    * Database unique constraints (e.g. unique `reservation_id` on the `orders` table) act as the final guard.

## 4. Worker Crash during Event Processing
* **Condition**: An asynchronous consumer worker crashes midway through processing.
* **Impact**: Database transaction is rolled back, but the Kafka offset is not committed.
* **Handling**:
    * Kafka broker detects worker disconnect, triggers a partition rebalance, and re-delivers the uncommitted message to another active worker.
    * If a message is a "poison pill" (re-triggering a constraint check or serialisation error), Spring's `CommonErrorHandler` configured in `KafkaConfig.java` uses `DeadLetterPublishingRecoverer` to route it to `flashflow.orders.DLT` or `flashflow.payments.DLT` after 2 retries (3 total attempts). The admin panel can monitor this via `/admin/dlt/stats`.

## 5. PostgreSQL Write Lock Contention (Optimistic Locking)
* **Condition**: Concurrent consumer workers try to update the same Product Inventory or Order records, triggering write conflicts.
* **Impact**: Transaction aborts due to `OptimisticLockingFailureException`.
* **Handling**:
    * Both `OrderRequestedConsumer.java` and `PaymentRequestedConsumer.java` intercept `OptimisticLockingFailureException`.
    * They implement a retry loop of up to **10 attempts** with jittered sleep (`30ms + random(40ms)`) before failing. This resolves database contention gracefully.

## 6. Orphan Redis Reservations (API Crash)
* **Condition**: The API server successfully reserves stock in Redis, writes `ACTIVE` state to Redis, but crashes *before* the Kafka publisher registers the event.
* **Impact**: Redis stock is permanently leaked, and the reservation is left in limbo.
* **Handling**:
    * **Reconciliation Sweeper**: The `ReservationReconciliationScheduler.java` runs every 30 seconds.
    * It scans Redis keys matching `reservation:*:meta`. If a reservation has been in `ACTIVE` state for over 15 seconds, it queries Postgres.
    * If the reservation is NOT in Postgres, the sweeper attempts to republish the event to Kafka (up to 3 retries).
    * If it still cannot reconcile after 3 attempts, it marks the reservation as `EXPIRED` in Redis, deletes the metadata, and calls `redisInventoryService.releaseStock()` to release the stock back to the pool.

## 7. TTL Expiry Race
* **Condition**: A reservation expires before the order creation process is completed.
* **Impact**: Order is created for stock that was released back to the pool.
* **Handling**:
    * The reservation expire scheduler (`ReservationExpiryService.java`) runs in the background.
    * It marks reservation as `EXPIRED` in DB, inserts an `OutboxEvent` (`RESERVATION_EXPIRED`), and in a post-commit hook, updates the Redis reservation status to `EXPIRED` and calls `redisInventoryService.releaseStock()`.
    * If a worker attempts order creation, it checks the database state. If the reservation is already expired/cancelled, it skips fulfillment.

## 8. Payment Failures & Rollback
* **Condition**: Payment processing fails (mocked for amounts > 50,000).
* **Impact**: Order cannot be confirmed.
* **Handling**:
    * `PaymentFulfillmentService.java` transitions the Payment to `FAILED` and Order to `FAILED`.
    * It cancels the Reservation in DB (`CANCELLED`).
    * It increments the DB inventory stock back (adding the quantity back to `availableStock` and `totalStock`).
    * Post-commit, it updates the Redis reservation cache to `CANCELLED` and syncs the restored stock level back to Redis.

