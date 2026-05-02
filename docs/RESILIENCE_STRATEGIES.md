# Resilience Strategies

FlashFlow employs several strategies to ensure system stability under immense load.

## 1. Idempotency at API and DB Level
* **API Level**: Every `POST /purchase` requires an `idempotencyKey`. Redis stores this key temporarily. If a duplicate request arrives, the cached response is returned.
* **DB Level**: The `Idempotency` table stores the final processing state. Unique constraints on tables (e.g., `reservation_id` in `Order` table) act as a safety net against race conditions.

## 2. Redis Atomic Operations (Lua)
* To prevent overselling, stock checks and deductions in Redis are performed using Lua scripts. This guarantees atomicity, ensuring that `stock >= requested_quantity` and decrementing it happens in a single, thread-safe operation.

## 3. Reservation-based Stock Control
* When a user requests to purchase, stock is temporarily "reserved" (moved from `available_stock` to `reserved_stock`), and a `Reservation` record with an expiration time is created.
* If the user fails to complete payment or the async process fails within the TTL, a background job or event releases the `reserved_stock` back to `available_stock`.

## 4. Kafka Retry and Dead Letter Queue (DLQ)
* Asynchronous processes (e.g., payment processing, order fulfillment) rely on Kafka.
* If processing fails due to a transient issue (e.g., 3rd party API down), the message is retried.
* If processing fails repeatedly, the message is routed to a DLQ for operational review, preventing the partition from being blocked (poison pill).

## 5. DB Unique Constraints as Final Safety Net
* While Redis handles the initial high-throughput checks, the database serves as the ultimate source of truth.
* Unique constraints (e.g., `user_id` + `product_id` for one-per-user sales, or `order_id` on the `Payment` table) ensure data consistency even if caching layers fail or sync delays occur.

## 6. Backpressure Handling
* By offloading order processing and payment integrations to Kafka, the API servers are not blocked waiting for slow downstream systems. This allows the API to handle more concurrent requests and provide backpressure (e.g., scaling workers) asynchronously.

## 7. Circuit Breaker for Payment
* Integration with the external Payment Gateway is wrapped in a Circuit Breaker.
* If the gateway experiences high latency or error rates, the circuit opens, immediately failing new payment requests to prevent thread starvation and cascading failures in our system.
