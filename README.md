# FlashFlow: High-Concurrency Flash Sale Platform

Welcome to **FlashFlow**, a high-performance, full-stack application designed to handle sudden, massive traffic spikes typical of "flash sale" or "limited drop" events. The core challenge of such systems is preventing server crashes and database inconsistencies (such as overselling or negative inventory) under thousands of concurrent requests.

This project implements a **Modular Monolith** architecture utilizing a split client-server model to distribute operations across memory, caches, message brokers, and persistent databases.

---

## 🏗️ Repository Layout & Structure

The repository is structured into two main deployable modules:

```
flashflow/
├── client/                 # React + Vite + Tailwind CSS 4 Frontend
│   ├── src/
│   │   ├── context/        # Authentication Context & Token Lifecycle
│   │   ├── pages/          # Catalog, Detail pages, Purchase status tracker, Admin dashboards
│   │   └── services/       # Axios API integrations
│   └── package.json
│
├── server/                 # Java 21 + Spring Boot 3.x Backend Monolith
│   ├── src/main/java/com/krushna/flashflow/
│   │   ├── auth/           # JWT authentications, filters, Refresh Token sweepers
│   │   ├── common/         # Transactional Outbox models, repository, publisher scheduler
│   │   ├── config/         # Security configs, Redis configs, Kafka listener configurations
│   │   ├── inventory/      # Product management, Redis-backed fast path check, pre-warming
│   │   ├── order/          # Purchase flow orchestration, asynchronous fulfillment
│   │   └── payment/        # Asynchronous payment worker and failure rollback handler
│   └── pom.xml
│
├── docs/                   # Architectural & Strategy Documentation
│   ├── ARCHITECTURE.md     # Core layout and database schemas
│   ├── PERFORMANCE_REPORT.md # Throughput analysis (Best/Worst/Average Cases)
│   ├── RESILIENCE_STRATEGIES.md # Idempotency, Redis Lua scripting, safety nets
│   └── WORKFLOW.md         # Sequential step-by-step checkout execution
│
└── docker-compose.yml      # Local dev environment orchestration
```

---

## 🛠️ Tech Stack & Key Technologies

* **Frontend:**
  * **React 19** with **Vite** (hot module replacement)
  * **Tailwind CSS 4** for styling
  * **React Router 7** for layouts and route protection guards
  * **Vitest & JSDOM** for frontend contract and component testing
* **Backend:**
  * **Java 21 + Spring Boot 3.x**
  * **PostgreSQL** as the primary source of truth (via Spring Data JPA)
  * **Redis 7** as the in-memory fast-path inventory counter, user rate limiter, and idempotency store
  * **Apache Kafka** as the event broker for asynchronous order creation and payment workers
  * **Flyway** for incremental database version schema migrations

---

## 🛡️ Core Concurrency & Resilience Patterns

1. **Redis Fast-Path Stock Check (Lua Scripting):** Stock is decremented atomically inside Redis. Rejections for out-of-stock items happen instantly in memory, preventing database load.
2. **Direct Kafka Publishing on Hot Checkout Path:** To eliminate database bottlenecks, the `/purchase` API path bypasses PostgreSQL entirely. It performs all checks and stock reserves in Redis, then publishes the checkout request directly to Kafka.
3. **Transactional Outbox Pattern Downstream:** The Outbox pattern is utilized during downstream asynchronous processing (e.g., in `OrderFulfillmentService` and `ReservationExpiryService`). When workers update the database, they insert an `OutboxEvent` in the same transaction to guarantee reliable propagation of subsequent states (e.g. `ORDER_CREATED` or `RESERVATION_EXPIRED`) to other microservices/topics.
4. **Reconciliation & Orphan Sweepers:** Checkout reliability is guaranteed by a background `ReservationReconciliationScheduler` that matches transient Redis reservations with PostgreSQL. If a reservation is orphaned due to Kafka publish delays or server crashes, it is automatically republished or safely expired.
5. **Idempotency & Rate Limiting:** Every checkout request requires a unique `idempotencyKey` and is guarded by a Redis token-bucket rate limiter.
6. **Observed Performance Matrix:** A detailed analysis of expected throughput (up to 15,000 TPS) is documented in the [Performance Report](docs/PERFORMANCE_REPORT.md).


---

## 🚀 Running the Project Locally

### 1. Prerequisite Infrastructure
Ensure you have Docker and Docker Compose installed. Start PostgreSQL, Redis, Zookeeper, and Kafka using the docker-compose setup from the project root:

```bash
docker compose up -d postgres redis zookeeper kafka
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env` at the root and verify the default connection values:

```bash
cp .env.example .env
```

### 3. Start the Spring Boot Backend
Navigate to the `server/` directory, verify Flyway migrations apply correctly, and run the server boot task:

```bash
cd server
./mvnw spring-boot:run
```
*The backend API will start on `http://localhost:8080`.*

### 4. Start the React Frontend Client
Navigate to the `client/` directory, install package dependencies, and launch Vite dev server:

```bash
cd ../client
npm install
npm run dev
```
*The React client will start on `http://localhost:5173`.*

---

## 🧪 Running the Test Suites

### Backend Unit & Integration Tests:
Run all Spring Boot testing profiles (which boot Flyway, Kafka configurations, Redis stubs, and H2 in-memory databases):
```bash
cd server
./mvnw test
```

### Frontend Unit & Contract Tests:
Navigate to the client module and run Vitest:
```bash
cd client
npm run test
```

---

## 📂 Detailed Documentation Reference
For deep dives into particular architectural decisions and system strategies, refer to:
* [Architecture Design](docs/ARCHITECTURE.md)
* [Checkout Workflow Sequence](docs/WORKFLOW.md)
* [Resilience and Safety Nets](docs/RESILIENCE_STRATEGIES.md)
* [Failure Mechanisms, Handling & Recovery Report](docs/FAILURE_HANDLING_AND_RECOVERY_REPORT.md)
* [Failure Conditions & Handlers Summary](docs/FAILURE_CONDITIONS.md)
* [Redis & Kafka Technical Deep-Dive Report](docs/REDIS_KAFKA_REPORT.md)
* [Performance and Throughput Matrix](docs/PERFORMANCE_REPORT.md)
