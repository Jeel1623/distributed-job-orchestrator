# Distributed Job Orchestrator - Academic Submission Report

## 1. Executive Summary & Architecture
This project presents a highly scalable, production-grade distributed job scheduling and orchestration platform designed to handle background tasks under heavy concurrent loads. The system implements a robust decoupled monorepo architecture consisting of an Express API server, independent worker daemons, and an interactive React-based administration dashboard.

Unlike conventional queues that rely on memory-based brokers (such as Redis) which are prone to data loss upon node crashes, this platform uses a relational database model in 3rd Normal Form (3NF) built on PostgreSQL. Transaction isolation and database row-level locking are leveraged to guarantee atomic operations, preventing double-claiming of jobs and resource starvation under distributed horizontal scaling.

---

## 2. 3NF Database Schema Design
The database schema is structured strictly in 3rd Normal Form (3NF) to avoid data redundancy and ensure transactional integrity. Enums and relations enforce rigid validation at the database level.

### Entity Relationship Definitions
- **users**: System administrators with role-based auth (ADMIN, MANAGER, USER).
- **projects**: Logical isolation boundaries for user jobs and configurations.
- **queues**: Independent channels with unique concurrency and priority limits.
- **jobs**: Tasks representing payload, state, priority, and run schedules. Indexed on `(status, run_at)`.
- **job_dependencies**: Composite PK linking parent to child enforcing Directed Acyclic Graph (DAG) execution constraints.
- **job_executions**: Execution audits tracking start, finish, worker node, duration, and stack traces.
- **workers**: Active worker daemons tracking load factors and operational states.
- **dead_letter_entries**: Storage for permanently failed tasks with AI analysis logs.

---

## 3. Distributed Concurrency & Claim Locking
In a distributed environment with multiple worker nodes polling the same database, race conditions can cause multiple workers to claim the same job or exceed queue capacity limits. 

This platform resolves these issues through a **Double-Lock Transactional Claim Algorithm** implemented in SQL:
1. **Queue Lock (Mutex)**: The worker starts a transaction and selects the target queue for update:
   ```sql
   SELECT * FROM "queues" WHERE "id" = $1 FOR UPDATE;
   ```
2. **Capacity Evaluation**: The worker counts the number of running jobs in this queue. If `runningCount >= maxConcurrency`, the transaction is committed, releasing the queue lock.
3. **Atomic Job Selection (Skip Locked)**: If capacity allows, the worker queries a single qualifying job using row-level locking:
   ```sql
   SELECT "id" FROM "jobs" 
   WHERE "queueId" = $1 
     AND "status" = 'QUEUED' 
     AND "runAt" <= NOW()
     AND NOT EXISTS (
       SELECT 1 FROM "job_dependencies" jd
       JOIN "jobs" p ON p.id = jd."parentJobId"
       WHERE jd."childJobId" = jobs.id AND p.status != 'COMPLETED'
     )
   ORDER BY "priority" DESC, "runAt" ASC 
   LIMIT 1 FOR UPDATE SKIP LOCKED;
   ```

---

## 4. Fault Tolerance & Retry Backoffs

### Retry Backoff Implementation
When a job execution fails, the worker calculates the delay before the next attempt using the queue's default policy:
- **FIXED**: `Delay = BaseDelay`
- **LINEAR**: `Delay = BaseDelay * Attempt`
- **EXPONENTIAL**: `Delay = min(BaseDelay * 2^(Attempt - 1), MaxDelay)`

### Dead Worker Reaper Service
If a worker node crashes mid-execution:
1. The worker's heartbeat ceases.
2. The API's background **Dead Worker Reaper Service** runs every 10 seconds. It detects workers whose last heartbeat is older than 15 seconds.
3. The reaper marks the worker node as `DEAD` and reclaims any jobs currently marked as `RUNNING` under that worker.
4. If the job has retry attempts remaining, it is returned to `QUEUED` status with an exponential backoff delay. If attempts are exhausted, it is moved to the **Dead Letter Queue (DLQ)**.

### Dead Letter Queue (DLQ) & AI Summaries
Jobs that fail all attempts are moved to the `dead_letter_entries` table. When promoted, the backend triggers an asynchronous call to the **Gemini 1.5 Flash API**. The AI reads the final error message and stack trace, diagnoses the root cause, and writes a human-readable diagnosis report to the DLQ entry, allowing operators to understand and resolve failures instantly.

---

## 5. API Specification & Setup Guide

### Core Endpoints
- `POST /api/auth/login`: Authenticates administrator and returns JWT Access + Refresh tokens.
- `POST /api/jobs`: Submits a job (Immediate, Delayed, DAG). Supports idempotency keys.
- `POST /api/jobs/:id/cancel`: Cancels a queued or running job. Sends SIGTERM to running worker thread.
- `GET /api/workers`: Returns active worker list, CPU/RAM telemetry history, and workload counts.
- `POST /api/dlq/retry-bulk`: Retries a list of DLQ jobs, re-queueing them in their original queues.

---

## 6. Manual Verification Protocol
To verify that all features work correctly, launch the Docker environment (`docker compose up --build`) and follow this verification protocol:
1. **Submit a Failing Job**: Go to **Job Explorer** ➡️ click **Submit Job** ➡️ select queue `flaky-queue` ➡️ set payload JSON:
   ```json
   { "flaky": true, "failureRate": 1.0, "errorMessage": "Network Timeout!" }
   ```
   Click **Queue Job**. Click on the job to slide open details and watch attempts increment and backoff calculation take place.
2. **Inspect AI DLQ Summary**: Once the job fails 3 times, click on the **Dead Letter Queue** tab. Click the failed job card and observe the **AI Failure Diagnosis** card summarizing the cause and resolution.
3. **Test DAG Workflow Blocking**: Submit a parent job in the `default` queue. Copy its Job ID. Submit a second job, placing the parent's Job ID in the **Depends On Job IDs** field. Observe the child job remaining in `QUEUED` status until the parent transitions to `COMPLETED`.
