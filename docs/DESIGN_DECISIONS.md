# Design Decisions - Distributed Job Scheduler

This document details the engineering choices, trade-offs, and design rationale implemented in the platform.

---

## 1. PostgreSQL Row-Level Locking vs. Redis (BullMQ)

### The Choice
We choose PostgreSQL with row-level locking (`SELECT ... FOR UPDATE SKIP LOCKED`) inside ACID transactions to manage the queue states, rather than Redis/BullMQ.

### Rationale
1. **ACID Transaction Invariants**: Job scheduling platforms require complex guarantees. In our platform, before worker processes claim a job, they must evaluate:
   - Is the queue active or paused?
   - Does claiming the job exceed the queue's `max_concurrency` capacity?
   - Are all parent workflow dependencies (`JobDependency` DAG) in a `COMPLETED` state?
   
   To solve this atomically in Redis, we would need to write complex Lua scripts, manage distributed locks, or risk race conditions. In PostgreSQL, we lock the queue row and run subqueries in a single database transaction, achieving 100% safety under concurrency.
2. **SKIP LOCKED Performance**: Naive locking (e.g. `SELECT ... FOR UPDATE`) serializes workers, causing them to block each other and degrade performance. `SKIP LOCKED` instructs PostgreSQL to bypass already-locked rows. This permits workers to scan and claim different jobs concurrently, maintaining horizontal scalability.
3. **Reduced Infrastructure Overhead**: No additional caching/message brokers are required. The database serves as the source of truth for both state and telemetry.

---

## 2. Normalization & Cascading Deletes

We followed 3NF (Third Normal Form) database design. The cascade behavior is configured as follows:

| Parent Table | Child Table | Delete Rule | Rationale |
| :--- | :--- | :--- | :--- |
| `Organization` | `Project` | `CASCADE` | If an organization is removed, all its projects are deleted. |
| `Project` | `Queue` | `RESTRICT` | A project cannot be deleted if active queues exist. This prevents losing telemetry. |
| `Queue` | `Job` | `RESTRICT` | Queues containing jobs cannot be deleted, preserving execution audit trails. |
| `Job` | `JobExecution` | `CASCADE` | If a job is purged, all its attempt history rows are cleaned up. |
| `Job` | `JobLog` | `CASCADE` | Logs belong to the job instance and are deleted along with the job. |
| `Job` | `DeadLetterEntry`| `CASCADE` | Purging a job from the DLQ automatically cleans up its DLQ entry. |

---

## 3. Retry Policy & DLQ Design

The platform supports a flexible retry architecture:
- **Strategies**:
  - `FIXED`: Delay remains constant on every retry: \(d = \text{baseDelay}\).
  - `LINEAR`: Delay scales linearly with the attempt count: \(d = \text{baseDelay} \times \text{attemptCount}\).
  - `EXPONENTIAL`: Delay scales exponentially: \(d = \text{baseDelay} \times 2^{\text{attemptCount} - 1}\).
- **Capping**: All strategies cap the calculated delay at `max_delay_ms` to avoid scheduling retries days into the future.
- **DLQ Promotion**: When `attempt_count >= max_attempts`, the status changes to `DEAD_LETTER` and a record is created in the `DeadLetterEntry` table. 

---

## 4. Idempotency Enforcement

Idempotency guarantees that side effects are not duplicated if requests are retried. We enforce this at two layers:

1. **Job Submission Layer**:
   - We enforce a database-level unique constraint on `(queue_id, idempotency_key)`.
   - If a client submits a duplicate job, the insert fails with a unique constraint violation. The API catches this error, queries the existing job, and returns it.
2. **Worker Execution Layer**:
   - When a job is re-claimed (e.g., after worker loss), the handler receives the `idempotency_key` and `attemptCount`.
   - The `HTTP` handler attaches this key as an `X-Idempotency-Key` header to outbound requests, delegating downstream safety.
   - The `DATA_PROCESSING` handler queries system cache/state before performing calculations.

---

## 5. Scalability & Future Trade-offs

If scaling this system to support thousands of claims per second:
1. **Queue Sharding**: Postgres connection pools and row locking can become bottlenecks. We would partition the `jobs` table by `queue_id` using Postgres declarative table partitioning.
2. **Hybrid Queuing**: We would use Redis (using streams or sorted sets) as a fast ingestion layer, flushing job states to Postgres asynchronously to offload row-locking overhead.
