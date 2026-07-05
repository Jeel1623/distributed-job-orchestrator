import dotenv from 'dotenv';
import os from 'os';
import crypto from 'crypto';

// Load env vars from root or local
dotenv.config({ path: '../.env' });
dotenv.config();

import prisma from 'backend/db';
import { WorkerStatus, JobStatus } from '@prisma/client';
import { claimNextJob, finishJob, failJob } from './poll';
import { executeHttpJob, executeDataProcessingJob, executeFlakyJob } from './handlers';

const WORKER_ID = process.env.WORKER_ID || `worker-${crypto.randomUUID()}`;
const CONCURRENCY = parseInt(process.env.WORKER_CONCURRENCY || '5', 10);
const HEARTBEAT_INTERVAL_MS = 5000;
const POLL_INTERVAL_MS = 1000;

let activeJobsCount = 0;
let isShuttingDown = false;
let heartbeatInterval: NodeJS.Timeout | null = null;
let pollTimeout: NodeJS.Timeout | null = null;

// Track active jobs in memory so we can wait for them on shutdown
const activeJobExecutions = new Map<string, Promise<void>>();

async function registerWorker() {
  const hostname = os.hostname();
  console.log(`[Worker] Registering worker ${WORKER_ID} (host: ${hostname}) with capacity ${CONCURRENCY}`);

  await prisma.worker.upsert({
    where: { id: WORKER_ID },
    create: {
      id: WORKER_ID,
      hostname,
      status: WorkerStatus.ACTIVE,
      concurrencyCapacity: CONCURRENCY,
      currentLoad: 0
    },
    update: {
      hostname,
      status: WorkerStatus.ACTIVE,
      concurrencyCapacity: CONCURRENCY,
      currentLoad: 0,
      lastHeartbeatAt: new Date()
    }
  });
}

async function sendHeartbeat() {
  if (isShuttingDown) return;

  try {
    const now = new Date();
    // System metrics
    const cpuLoad = os.loadavg()[0];
    const memUsage = process.memoryUsage().heapUsed / 1024 / 1024; // in MB

    await prisma.$transaction(async (tx) => {
      // 1. Update Worker heartbeat timestamp and load
      await tx.worker.update({
        where: { id: WORKER_ID },
        data: {
          lastHeartbeatAt: now,
          currentLoad: activeJobsCount
        }
      });

      // 2. Insert Heartbeat record
      await tx.workerHeartbeat.create({
        data: {
          workerId: WORKER_ID,
          timestamp: now,
          cpuUsage: cpuLoad,
          memoryUsage: memUsage
        }
      });
    });

  } catch (error: any) {
    console.error(`[Worker ${WORKER_ID}] Heartbeat failed:`, error.message);
  }
}

async function runJob(jobId: string, executionId: string, payload: any, type: string) {
  const logHelper = async (level: string, message: string) => {
    try {
      await prisma.jobLog.create({
        data: {
          jobId,
          executionId,
          level,
          message: `[Worker ${WORKER_ID}] ${message}`
        }
      });
    } catch (e: any) {
      console.error(`[Worker ${WORKER_ID}] Log write failed:`, e.message);
    }
  };

  const ctx = {
    jobId,
    executionId,
    attemptCount: 1, // Will be updated on reload from DB if needed, but ctx mostly logs
    idempotencyKey: payload?.idempotencyKey || null,
    log: logHelper
  };

  try {
    // 1. Set state to RUNNING in database
    await prisma.$transaction([
      prisma.job.update({
        where: { id: jobId },
        data: { status: JobStatus.RUNNING }
      }),
      prisma.jobExecution.update({
        where: { id: executionId },
        data: { status: JobStatus.RUNNING }
      })
    ]);

    await logHelper('info', `Switched job status to RUNNING. Executing handler...`);

    // 2. Select and execute the correct handler
    let result: any;
    if (payload?.url) {
      result = await executeHttpJob(payload, ctx);
    } else if (payload?.items || payload?.operation) {
      result = await executeDataProcessingJob(payload, ctx);
    } else if (payload?.flaky) {
      result = await executeFlakyJob(payload, ctx);
    } else {
      // Generic payload
      await logHelper('info', 'Executing generic handler (no matching schema found)');
      await new Promise(resolve => setTimeout(resolve, 500));
      result = { status: 'success', message: 'Generic payload completed' };
    }

    // 3. Mark job as finished successfully
    await finishJob(jobId, executionId, WORKER_ID, result);
    console.log(`[Worker ${WORKER_ID}] Job ${jobId} finished successfully.`);

  } catch (error: any) {
    console.error(`[Worker ${WORKER_ID}] Job ${jobId} failed:`, error.message);
    await failJob(jobId, executionId, WORKER_ID, error);
  } finally {
    activeJobsCount--;
    activeJobExecutions.delete(jobId);
    // Trigger greedy polling immediately after job completion
    triggerPoll(0);
  }
}

async function pollAndExecute() {
  if (isShuttingDown) return;

  // Verify worker limits
  if (activeJobsCount >= CONCURRENCY) {
    // Max concurrency reached, defer polling
    triggerPoll(POLL_INTERVAL_MS);
    return;
  }

  try {
    const claim = await claimNextJob(WORKER_ID);

    if (claim) {
      const { job, executionId } = claim;
      console.log(`[Worker ${WORKER_ID}] Claimed job ${job.id} from queue ${job.queueId}`);
      
      activeJobsCount++;

      // Execute job in background
      const jobExecution = runJob(job.id, executionId, job.payload, job.type);
      activeJobExecutions.set(job.id, jobExecution);

      // Greedy polling: claim again immediately if there are more jobs
      triggerPoll(0);
    } else {
      // No jobs claimed, backoff
      triggerPoll(POLL_INTERVAL_MS);
    }
  } catch (error: any) {
    console.error(`[Worker ${WORKER_ID}] Polling loop error:`, error.message);
    triggerPoll(POLL_INTERVAL_MS);
  }
}

function triggerPoll(delayMs: number) {
  if (isShuttingDown) return;
  if (pollTimeout) clearTimeout(pollTimeout);
  pollTimeout = setTimeout(pollAndExecute, delayMs);
}

// Graceful Shutdown
async function handleShutdown(signal: string) {
  if (isShuttingDown) return;
  console.log(`\n[Worker ${WORKER_ID}] Received ${signal}. Initiating graceful shutdown...`);
  isShuttingDown = true;

  // Stop polling and timers
  if (pollTimeout) clearTimeout(pollTimeout);
  if (heartbeatInterval) clearInterval(heartbeatInterval);

  try {
    // 1. Mark worker as DRAINING in DB
    await prisma.worker.update({
      where: { id: WORKER_ID },
      data: { status: WorkerStatus.DRAINING }
    });

    console.log(`[Worker ${WORKER_ID}] Status set to DRAINING. Waiting for ${activeJobExecutions.size} active jobs to finish...`);

    // 2. Wait for active jobs to complete (max 10 seconds timeout)
    const activePromises = Array.from(activeJobExecutions.values());
    
    if (activePromises.length > 0) {
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Shutdown timeout reached')), 10000)
      );

      await Promise.race([
        Promise.all(activePromises),
        timeoutPromise
      ]).catch((err) => {
        console.warn(`[Worker ${WORKER_ID}] Some jobs did not finish gracefully in time:`, err.message);
      });
    }

    // 3. Mark worker as DEAD cleanly
    await prisma.worker.update({
      where: { id: WORKER_ID },
      data: { status: WorkerStatus.DEAD }
    });

    console.log(`[Worker ${WORKER_ID}] Deregistered cleanly. Bye!`);
    process.exit(0);

  } catch (error: any) {
    console.error(`[Worker ${WORKER_ID}] Error during graceful shutdown:`, error.message);
    process.exit(1);
  }
}

// Bootstrap
async function main() {
  try {
    await registerWorker();
    
    // Start heartbeat loop
    heartbeatInterval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS);
    // Initial heartbeat
    await sendHeartbeat();

    // Start polling loop
    triggerPoll(0);

    // Register process signals
    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('SIGINT', () => handleShutdown('SIGINT'));

  } catch (error: any) {
    console.error('[Worker] Bootstrap failed:', error.message);
    process.exit(1);
  }
}

main();
