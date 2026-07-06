# FlashFlow Architecture

This document describes the high-level architecture of FlashFlow, designed for high-concurrency e-commerce scenarios.

## Core Components

1. **Vite/React Frontend Client**: Modern React SPA (`client/`) powered by Tailwind CSS 4 that coordinates authentication, catalog browsing, purchase requests (sending idempotency keys), and polling order status.
2. **Spring Boot App**: The main application server (`server/`) exposing REST endpoints, managing authentication filters, handling transactional outbox events, and running background schedules.
3. **PostgreSQL**: The primary database for persistent data (Users, Products, Inventory, Orders, Payments, Idempotency keys, Outbox Events).
4. **Redis**: In-memory data store for handling high-concurrency tasks, such as rate limiting, idempotency checks, and pre-deducting stock/reservations to avoid overwhelming the database.
5. **Kafka**: Event-streaming platform for asynchronous processing. Helps decouple order creation, payment processing, and notifications.

## Architecture Diagram

```mermaid
graph TD
    Client[React Frontend Client] -- "1. HTTP Request (JWT + Idempotency)" --> API[Spring Boot API]
    API --> Redis[(Redis Cache)]
    API --> DB[(PostgreSQL)]
    API --> Kafka[Kafka Topics]
    
    subgraph Data Layer
        Redis
        DB
    end
    
    subgraph Event Driven Async Workers
        Kafka --> OrderProcessor[Order Processing Worker]
        Kafka --> PaymentProcessor[Payment Processing Worker]
    end
```
![alt text](Architecture_diagram_2.png)

## Data Model Overview

* **User**: Customer credentials and role mapping (USER, ADMIN).
* **Product**: Item details and state control (ACTIVE, INACTIVE, OUT_OF_STOCK).
* **Inventory**: Stock tracking (Total, Available, Reserved) with pessimistic/optimistic JPA version checks.
* **Reservation**: Temporary hold on stock during checkout (ACTIVE, CONFIRMED, EXPIRED, CANCELLED).
* **Order**: Finalized purchase record (CREATED, CONFIRMED, FAILED, CANCELLED).
* **Payment**: Transaction status for the order (PENDING, SUCCESS, FAILED).
* **Idempotency**: Tracking API requests to prevent duplicate processing (PROCESSING, COMPLETED, FAILED).
* **OutboxEvent**: Events waiting to be published to Kafka (Transactional Outbox Pattern).

## Database Schema Migrations (Flyway)
Database tables and schemas are managed incrementally via Flyway:
* `V1__init.sql`: Initial base schema defining core tables and optimization indexes.
* `V2__create_flash_sale.sql`: Introduces flash sale configurations and join relations.
* `V3__add_flash_sale_product_index.sql`: Adds indexing on flash-sale active products to optimize hot lookup queries.
* `V4__add_csrf_token_to_refresh_token.sql`: Adds Double-Submit CSRF cookie protections on refresh tokens.

## Background Schedulers
The backend employs periodic background schedulers to keep databases clean and synchronized:
* **FlashSaleScheduler:** Synchronizes product status updates between Postgres and Redis caches.
* **ReservationExpiryScheduler:** Periodically scans for expired active reservations, releases Redis stock, and updates database records.
* **IdempotencySweepScheduler:** Resolves transactions stuck in `PROCESSING` status after a timeout (5 minutes) to unlock retries.
* **RefreshTokenCleanupScheduler:** Cleans up expired refresh token entries from PostgreSQL to keep the table footprint compact.

## Domain Class Diagram

![alt text](flashflow_domain_class_diagram.png)

## Sequence Diagram

![alt text](Architecture_diagram.png)
![diagram2](Sequence_diagram.png)


