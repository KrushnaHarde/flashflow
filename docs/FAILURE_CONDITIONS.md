# Failure Conditions & Handling

In a high-concurrency environment, failures are expected. FlashFlow is designed to degrade gracefully or handle failures systematically.

## 1. Redis Failure
* **Condition**: Redis goes down or becomes unreachable.
* **Impact**: Rate limiting, idempotency checks, and fast stock deductions fail.
* **Handling**: 
    * System degrades to rejecting requests (`503 Service Unavailable`) to protect the database from sudden spikes.
    * Alternatively, fall back to DB with strict rate-limiting, though this risks DB overload during a flash sale.

## 2. Kafka Duplicate Delivery
* **Condition**: Kafka delivers the same event multiple times (at-least-once delivery).
* **Impact**: Duplicate order creation or double payment.
* **Handling**: Handled via idempotency. Every consumer must check the `Idempotency` table or process events idempotently based on `eventId` or `reservationId`.

## 3. Worker Crash
* **Condition**: An asynchronous worker crashes while processing an event.
* **Impact**: An order might be stuck in "Processing" state.
* **Handling**: 
    * The Kafka offset is not committed. The message will be redelivered.
    * If a message continuously fails, it is moved to a Dead Letter Queue (DLQ) for manual inspection.

## 4. Database Failure
* **Condition**: PostgreSQL becomes temporarily unavailable or times out.
* **Impact**: Cannot save reservations, orders, or outbox events.
* **Handling**: 
    * API returns `500 Internal Server Error`.
    * Client should retry with exponential backoff using the *same* `idempotencyKey`.

## 5. TTL Expiry Race
* **Condition**: A reservation expires before the order creation process is completed.
* **Impact**: Order is created for stock that was released back to the pool.
* **Handling**: 
    * Revalidation before order creation. The worker must check `expiresAt` of the reservation.
    * If expired, the order creation is aborted and the reservation is marked `EXPIRED`.

## 6. Payment Retry
* **Condition**: Payment gateway times out or network fails.
* **Impact**: Unknown payment status.
* **Handling**: Idempotent payment handling. The system retries checking the payment status with the gateway using the same `orderId` or `paymentId` before attempting a new charge.
