# FlashFlow Workflow

This document details the standard request flow and asynchronous processing workflows in FlashFlow.

## High-Level Request Flow

1. **Client Request**: Client calls `POST /purchase` with `userId`, `productId`, `quantity`, and an `idempotencyKey`.
2. **Idempotency Check**: System checks Redis/DB for the `idempotencyKey`. If it exists, return the cached response.
3. **Rate Limiting**: Check if the user has exceeded their request limit in Redis.
4. **Stock Reservation**: 
    * System tries to decrement the available stock in Redis atomically.
    * If successful, a `Reservation` is created in DB (Pending).
5. **Async Processing Initiation**:
    * An `OutboxEvent` (e.g., `OrderRequestedEvent`) is saved in the DB transaction.
    * The API returns `202 Accepted` to the client.

## Sequence Diagram


```mermaid
sequenceDiagram
    participant Client
    participant API as API Server
    participant Redis
    participant DB
    participant Kafka
    participant Worker as Async Workers

    Client->>API: POST /purchase (IdempotencyKey)
    API->>Redis: Check Idempotency
    Redis-->>API: Not Found (Proceed)
    API->>Redis: Decrement Stock (Lua Script)
    Redis-->>API: Stock Available
    API->>DB: Save Reservation (Status: ACTIVE)
    API->>DB: Save OutboxEvent (OrderRequested)
    API->>DB: Save IdempotencyKey (Status: PROCESSING)
    API-->>Client: 202 Accepted
    
    Note over API,Worker: Async Processing via Outbox Relay
    DB->>Kafka: Relay OutboxEvent (OrderRequested)
    Kafka->>Worker: Consume Event
    Worker->>DB: Create Order (Status: CREATED)
    Worker->>DB: Update Reservation (Status: CONFIRMED)
    Worker->>Kafka: Publish Event (PaymentPending)
```

![alt text](Sequence_diagram.png)

![alt text](Request_flow_diagram.png)