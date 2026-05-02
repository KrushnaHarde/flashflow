# FlashFlow Backend

Welcome to the **FlashFlow** backend project. This project is a  for a high-concurrency flash sale system.

## Project Overview

FlashFlow is designed to handle sudden, massive spikes in traffic—typical of "flash sale" or "limited drop" events. The core challenge is preventing system crashes and data inconsistencies (like overselling) when thousands of users attempt to purchase limited inventory simultaneously.

This project demonstrates:
* **Clean Architecture**: Layered design separating controllers, services, repositories, and models.
* **Proper Data Modeling**: Scalable schemas for users, products, inventory, reservations, orders, and payments.
* **High-Concurrency Design**: Asynchronous processing and offloading heavy tasks from the primary database.
* **Fault Tolerance**: Idempotency and resilient patterns.

## Documentation Overview

Detailed documentation has been modularized into the `docs/` directory:

1. **[Architecture](docs/ARCHITECTURE.md)**: System design and components overview (Spring Boot, Postgres, Redis, Kafka).
2. **[Workflow](docs/WORKFLOW.md)**: Request flow and sequence diagrams for the purchase process.
3. **[Failure Conditions](docs/FAILURE_CONDITIONS.md)**: How the system handles failures in Redis, DB, Kafka, or downstream workers.
4. **[Resilience Strategies](docs/RESILIENCE_STRATEGIES.md)**: Techniques used to ensure system stability (Idempotency, Lua scripting, Circuit Breakers).

## Tech Stack

* **Java 21 + Spring Boot 3.x**: The core application framework.
* **PostgreSQL**: Primary database (via Spring Data JPA).
* **Redis**: In-memory data store for caching, idempotency, and fast-path inventory checks.
* **Kafka**: Message broker for event-driven async processing.
* **Maven**: Build tool.

## Project Structure

```
src/main/java/com/krushna/flashflow/
├── config/         # Redis, Kafka configurations
├── controller/     # API endpoints
├── dto/            # Data Transfer Objects
├── exception/      # Global error handling (to be implemented)
├── health/         # Minimal health check API
├── model/entity/   # JPA Entities
├── repository/     # Spring Data JPA Repositories
├── service/        # Business logic layer (to be implemented)
└── util/           # Helper classes (to be implemented)
```

## Running the Project

1. Ensure you have PostgreSQL, Redis, and Kafka running (e.g., via Docker Compose).
2. Update `application.properties` or `application.yml` with your database and connection details (to be configured).
3. Run `mvn spring-boot:run`.

## Future Improvements

* Implement full business logic in the `service` layer.
* Add Docker Compose file for easy setup of dependencies.
* Implement robust global exception handling.
* Add comprehensive unit and integration tests.
* Set up CI/CD pipelines.
