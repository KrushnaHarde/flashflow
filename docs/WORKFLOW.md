# FlashFlow Workflow

This document details the standard request flow and asynchronous processing workflows in FlashFlow.

## High-Level Request Flow

1. **Client Request**: Client calls `POST /purchase` with `userId`, `productId`, `quantity`, and an `idempotencyKey`.
2. **Idempotency Check**: System checks Redis/DB for the `idempotencyKey`. If it exists, return the cached response.
3. **Rate Limiting**: Check if the user has exceeded their request limit in Redis.
4. **Stock Reservation**: 
    * System tries to decrement the available stock in Redis atomically.
    * If successful, a `Reservation` is created in DB (ACTIVE).
5. **Async Processing Initiation**:
    * An `OutboxEvent` (e.g., `OrderRequestedEvent`) is saved in the DB transaction.
    * The API returns `202 Accepted` to the client containing the `reservationId`.
6. **Client Polling**:
    * The client immediately redirects to `/purchase/:reservationId/status` and begins polling the backend for final booking status.

---

## Complete End-to-End Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor User as Client Browser
    participant Client as React Client
    participant API as API Server (Tomcat)
    participant Redis as Redis Cache
    participant DB as Postgres Database
    participant Kafka as Kafka Broker
    participant Worker as Async Workers (Kafka Consumers)

    %% Step 1: Initial API Call
    User->>Client: Click Buy Now
    Client->>API: POST /purchase (IdempotencyKey, UserId, ProductId, Qty)
    
    %% Step 2: Entrance Gate Validations (Redis Fast Path)
    API->>Redis: Rate Limit Check (Lua Script)
    Redis-->>API: Allowed
    API->>Redis: Check Idempotency Key
    Redis-->>API: Cache Miss (New Request)
    API->>Redis: Decrement Stock (Lua Script)
    Redis-->>API: Stock Decremented Successfully
    
    %% Step 3: Fast Database Transaction
    API->>DB: Open Transaction
    API->>DB: Save Idempotency (Status: PROCESSING)
    API->>DB: Save Reservation (Status: ACTIVE)
    API->>DB: Save OutboxEvent (Type: ORDER_REQUESTED)
    API->>DB: Commit Transaction
    
    %% Step 4: Immediate 202 Accepted Response
    API-->>Client: 202 Accepted (Reservation ID)
    Client->>User: Show "Processing Purchase..." Page
    
    %% Step 5: Asynchronous Event Relay
    loop Outbox Publisher
        API->>DB: Query PENDING outbox events
        DB-->>API: Returns PENDING event
        API->>Kafka: Publish event to topic flashflow.orders
        API->>DB: Mark outbox event status = SENT
    end

    %% Step 6: Order Fulfillment Worker
    Worker->>Kafka: Poll flashflow.orders topic
    Kafka-->>Worker: Consume ORDER_REQUESTED event
    Worker->>DB: Open Transaction
    Worker->>DB: Update Reservation (Status: CONFIRMED)
    Worker->>DB: Create Order (Status: CREATED) & Payment (Status: PENDING)
    Worker->>DB: Decrement DB Inventory availableStock & totalStock
    Worker->>DB: Save OutboxEvent (Type: ORDER_CREATED)
    Worker->>DB: Commit Transaction
    
    %% Step 7: Payment Fulfillment Worker
    loop Outbox Publisher
        API->>DB: Query PENDING outbox events
        DB-->>API: Returns PENDING event
        API->>Kafka: Publish event to topic flashflow.payments
        API->>DB: Mark outbox event status = SENT
    end

    Worker->>Kafka: Poll flashflow.payments topic
    Kafka-->>Worker: Consume ORDER_CREATED event
    
    alt Payment Successful (Amount <= 50,000)
        Worker->>DB: Open Transaction
        Worker->>DB: Update Payment (Status: SUCCESS) & Order (Status: CONFIRMED)
        Worker->>DB: Commit Transaction
        Worker->>Redis: Confirm Reservation Cache
        Worker->>Redis: Save Idempotency Cache (Status: COMPLETED + Response Snapshot)
    else Payment Failed (Amount > 50,000)
        Worker->>DB: Open Transaction
        Worker->>DB: Update Payment (Status: FAILED), Order (Status: FAILED), & Reservation (Status: CANCELLED)
        Worker->>DB: Rollback DB Stock: Add quantity back to availableStock & totalStock
        Worker->>DB: Commit Transaction
        Worker->>Redis: Release Redis Stock (Increment back)
        Worker->>Redis: Save Idempotency Cache (Status: FAILED)
    end

    %% Step 8: Client Polling Loop
    loop Every 1 - 2 seconds
        Client->>API: GET /orders/reservation/:reservationId
        API->>DB: Query Order Status
        DB-->>API: Returns status (CONFIRMED or FAILED)
        API-->>Client: 200 OK (Status)
    end
    Client->>User: Show final checkout status page (Success/Error)
```