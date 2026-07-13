# Resilience Strategies

FlashFlow employs several strategies to ensure system stability and data consistency under immense load.

## 1. Idempotency at API and DB Level
* **API Level**: Every `POST /purchase` requires a unique `idempotencyKey`. Redis caches this key and its response status (`idempotency:<userId>:<key>`). If a duplicate request arrives during processing, a `409 Conflict` (for "PROCESSING" or "ORDER_CREATED") is returned. If it is already completed, the cached response snapshot is returned directly from Redis, bypassing downstream operations.
* **DB Level**: The `Idempotency` table in PostgreSQL records the final processing state. Unique constraints (such as `reservation_id` in the `orders` table) act as the final database-level guarantee against race conditions.

## 2. Redis Atomic Operations (Lua)
* To prevent overselling, stock check and deduction in Redis are executed inside a Lua script. This guarantees thread-safety and strict atomicity by checking if `stock >= requested_quantity` and executing the decrement `decrby` in a single, block-free Redis instruction.

## 3. Asynchronous Database-Free Stock Control
* The synchronous checkout path is database-free. Stock is reserved atomically in Redis. PostgreSQL inventory is updated asynchronously when the `OrderRequestedConsumer` fulfills the order.
* If a payment fails (e.g. mock amounts > 50,000) or if a reservation expires (via `ReservationExpiryService`), the system releases the stock in PostgreSQL and syncs the updated stock level back to Redis.

## 4. Kafka Retry, Jittered Backoff, and Dead Letter Topics (DLT)
* **Write Lock Retries**: For PostgreSQL concurrency conflicts (`OptimisticLockingFailureException`), consumers in `OrderRequestedConsumer` and `PaymentRequestedConsumer` retry up to **10 times** with a randomized backoff (`30ms + random(40ms)`) to allow database locks to clear without failing the message.
* **Dead Letter Topics**: For persistent failures (e.g. serialize exceptions, unexpected runtime issues), Spring's `CommonErrorHandler` retries the consumer up to 2 times (3 total attempts) with a `FixedBackOff(1000L, 2L)` before routing the message to the corresponding dead letter topic (`flashflow.orders.DLT` or `flashflow.payments.DLT`).

## 5. Background Reconciliation Sweeper (Orphan Solver)
* If an API server crashes or network issues occur after a Redis stock reserve but before the Kafka event is published, stock would be leaked.
* The `ReservationReconciliationScheduler` runs every 30 seconds to reconcile active Redis reservations with PostgreSQL. It attempts to republish orphaned records to Kafka up to 3 times. If they cannot be reconciled, it automatically expires the reservation and releases the stock in Redis.

## 6. DB Unique Constraints as Final Safety Net
* While Redis handles high-speed fast-path checks, the PostgreSQL database is the ultimate source of truth. Unique database constraints (e.g. `user_id` + `product_id` for single-purchase sales, or unique `reservation_id` on the `orders` table) prevent duplicate processing even if cache sync delay occurs.

## 7. Backpressure & Decoupling
* By offloading database writes (reservation records, orders, payments) and payment gateway integration to Kafka consumers, the client connection thread is released immediately (returning a `202 Accepted` response). This absorbs traffic spikes, prevents Tomcat thread exhaustion, and handles traffic backpressure gracefully.

## 8. Circuit Breaker for Payment (Production Recommendation)
* In a production environment, integration with the external Payment Gateway is wrapped in a Circuit Breaker (e.g. via Resilience4j).
* If the gateway experiences high latency or error rates, the circuit opens, immediately failing new payment requests to prevent thread starvation and cascading failures in our system.
* *Note: The current POC leverages a deterministic mock validation (amounts > 50,000 fail; amounts <= 50,000 succeed) for test predictability, but does not deploy an active Resilience4j state.*


