# Distributed Job Scheduling Platform

A production-grade, horizontally-scalable, distributed job scheduling platform built with Node.js, Express, TypeScript, React, and PostgreSQL. 

The platform supports atomic job claiming via PostgreSQL row-level locks (`SELECT ... FOR UPDATE SKIP LOCKED`), cron-parser recurring schedules, job-level DAG dependency flows, sliding-window telemetry statistics, and real-time frontend updates over WebSockets (Socket.IO).

---

## 🚀 Single-Command Start (Docker Compose)

To spin up the entire platform (Postgres + Express API + 2 Worker nodes + Nginx React Frontend), run:

```bash
docker-compose up --build
```

- **Frontend Dashboard**: [http://localhost](http://localhost) (or port 80)
- **API Server & Socket.IO**: [http://localhost:5000](http://localhost:5000)
- **OpenAPI Swagger documentation**: [http://localhost:5000/api/docs](http://localhost:5000/api/docs)
- **Seed User Login**:
  - **Email**: `admin@acme.com`
  - **Password**: `admin123`

---

## 🛠️ Local Development Setup

If you prefer to run the components locally for debugging:

### 1. Prerequisites
- Node.js (v20+ recommended)
- PostgreSQL running locally (e.g. `localhost:5432`)

### 2. Configure Environment Variables
Create a `.env` file inside the `backend` directory (and root if desired):

```env
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/scheduler?schema=public"
JWT_SECRET="production_grade_super_secret_key_123!"
PORT=5000
NODE_ENV=development
# GEMINI_API_KEY="" # Optional: Add to enable AI DLQ failure summaries
```

### 3. Install Workspace Dependencies
Install all packages in the monorepo from the root directory:

```bash
npm install
```

### 4. Apply Database Migrations & Seed
Run Prisma migrations and seed the database with demo tasks:

```bash
cd backend
npx prisma migrate dev
npm run prisma:seed
cd ..
```

### 5. Start Services Locally
Open separate terminal tabs and run:

- **Start API Server**:
  ```bash
  npm run dev:backend
  ```
- **Start Standalone Worker(s)**:
  ```bash
  npm run dev:worker
  ```
- **Start Vite React Frontend**:
  ```bash
  npm run dev:frontend
  ```

---

## 🧪 Running the Automated Test Suite

We wrote integration tests verifying concurrency-safe claim locks, retry calculations, and DAG blocking.
To run the Vitest test suite:

```bash
cd backend
npm run test
```

---

## 🔍 Step-by-Step Manual Verification Guide

Use the following recipes to verify core engine reliability features on the Frontend Dashboard:

### 1. Retry Backoff & DLQ Promotion
To see a job fail repeatedly and land in the DLQ:
1. Log in to the dashboard (`admin@acme.com` / `admin123`).
2. Go to **Job Explorer** and click **Submit Job**.
3. Select the `flaky-queue` from the queue selector.
4. Set the Payload JSON to:
   ```json
   { "flaky": true, "failureRate": 1.0 }
   ```
5. Click **Queue Job**.
6. Switch to **Job Explorer** and click the submitted job to open details.
7. You will see the job transition: `QUEUED` ➡️ `RUNNING` ➡️ `FAILED` (under attempt 1), then schedule a retry.
8. After 3 attempts fail, the job is promoted to `DEAD_LETTER` status.
9. Navigate to the **Dead Letter Queue (DLQ)** tab. You will see the job listed, complete with the final stack trace and an **AI-generated root cause diagnosis**!

### 2. Workflow Dependencies (DAG Blocking)
To verify that child jobs are blocked until their parent completes:
1. Open **Job Explorer** and submit a parent job in the `default` queue. Copy its `Job ID` from the table.
2. Click **Submit Job** again, select the `default` queue, and under **Depends On Job IDs**, paste the parent's `Job ID`.
3. Set the payload for the child job:
   ```json
   { "task": "child-run" }
   ```
4. Submit the job.
5. In the **Job Explorer** list, notice that the parent job runs and finishes. The child job remains in `QUEUED` state until the parent completes.
6. Once the parent transitions to `COMPLETED`, the child is immediately claimed by a worker and executes.

### 3. Distributed Concurrency & Load Balance
1. Look at the **Worker Monitor** tab.
2. You will see both `scheduler-worker-1` and `scheduler-worker-2` listed in `ACTIVE` state.
3. Submit a batch of jobs via **Job Explorer** -> **Submit Job** -> select **BATCH** execution profile.
4. Set payload to:
   ```json
   { "items": [10, 20, 30], "operation": "sum" }
   ```
5. Click **Queue Job**.
6. Navigate immediately to the **Worker Monitor** tab. You will see both worker instances claiming and executing jobs in parallel, demonstrating load balancing and showing CPU/RAM graphs in real-time.

---

## ☁️ Cloud PaaS Deployment (Render & Railway)

### 1. Deploying on Render (using Blueprints)
This codebase includes a `render.yaml` blueprint file for zero-config infrastructure setup:
1. Push this workspace folder to a private or public **GitHub Repository**.
2. Log in to your **[Render Dashboard](https://dashboard.render.com/)**.
3. Click **New +** ➡️ select **Blueprint**.
4. Link your GitHub repository and click **Apply**.
5. Render will automatically read `render.yaml` and provision:
   - **PostgreSQL Database** (`scheduler-db`)
   - **Express API Web Service** (`scheduler-backend`)
   - **Frontend Nginx Web Service** (`scheduler-frontend` - automatically linked to the API's public URL)
   - **Worker 1 & Worker 2 Background Workers** (`scheduler-worker-1`, `scheduler-worker-2`)
6. Render will automatically deploy, apply migrations, seed the database, and spin up the live dashboard!

### 2. Deploying on Railway
1. Push this project to a **GitHub Repository**.
2. Log in to **[Railway](https://railway.app/)** and click **New Project** ➡️ select **Provision PostgreSQL**.
3. Click **New** ➡️ **GitHub Repo** and import your repository to create these services:
   - **API Backend**: Set Dockerfile to `backend/Dockerfile` and Root Directory to `/`. Set Env Variables:
     - `DATABASE_URL` ➡️ `${{Postgres.DATABASE_URL}}` (Railway automatically binds this)
     - `JWT_SECRET` ➡️ *(Generate a secret)*
     - `PORT` ➡️ `5000`
   - **Worker 1 & 2**: Import the repo twice, set Dockerfile to `worker/Dockerfile` and Root Directory to `/`. Set Env Variables:
     - `DATABASE_URL` ➡️ `${{Postgres.DATABASE_URL}}`
     - `WORKER_ID` ➡️ `worker-1` (and `worker-2` for the second service)
   - **Frontend**: Import the repo, set Dockerfile to `frontend/Dockerfile` and Root Directory to `/`. Under settings, add these **Railway Build Variables**:
     - `VITE_API_URL` ➡️ `https://your-backend-railway-url.up.railway.app/api`
     - `VITE_SOCKET_URL` ➡️ `https://your-backend-railway-url.up.railway.app`
