import cronParser from 'cron-parser';
import prisma from '../db';
import { io } from '../server';

let schedulerInterval: NodeJS.Timeout | null = null;
let isPolling = false;

async function pollScheduledJobs() {
  if (isPolling) return;
  isPolling = true;

  try {
    // 1. Find scheduled jobs that are due
    // We select IDs without locking first, to process them one-by-one in isolated transactions.
    const now = new Date();
    const dueJobs = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id FROM scheduled_jobs WHERE next_run_at <= $1`,
      now
    );

    for (const job of dueJobs) {
      try {
        await prisma.$transaction(async (tx) => {
          // Lock individual row FOR UPDATE. If another instance locked it, skip or wait.
          const lockedRows = await tx.$queryRawUnsafe<any[]>(
            `SELECT * FROM scheduled_jobs WHERE id = $1 FOR UPDATE`,
            job.id
          );

          if (lockedRows.length === 0) return;
          const scheduled = lockedRows[0];

          // Double check run time
          if (new Date(scheduled.next_run_at) > new Date()) {
            return; // Already updated by another scheduler instance
          }

          // Calculate next execution time
          const interval = cronParser.parseExpression(scheduled.cron_expression);
          const nextRun = interval.next().toDate();

          // Spawn the actual Job instance
          const spawnedJob = await tx.job.create({
            data: {
              queueId: scheduled.queue_id,
              type: 'RECURRING',
              status: 'QUEUED',
              payload: scheduled.payload || {},
              priority: scheduled.priority,
              runAt: new Date(), // executes immediately
              maxAttempts: scheduled.max_attempts,
              cronExpression: scheduled.cron_expression
            }
          });

          // Log scheduling event
          await tx.jobLog.create({
            data: {
              jobId: spawnedJob.id,
              level: 'info',
              message: `Job spawned automatically from scheduled definition: "${scheduled.name}".`
            }
          });

          // Update recurring template next run
          await tx.scheduledJob.update({
            where: { id: scheduled.id },
            data: {
              lastRunAt: new Date(),
              nextRunAt: nextRun
            }
          });

          // Notify frontend via WebSocket
          if (io) {
            io.emit('job:created', { id: spawnedJob.id, queueId: spawnedJob.queueId, status: spawnedJob.status });
          }
        });
      } catch (err: any) {
        console.error(`[Scheduler] Failed to trigger recurring job ${job.id}:`, err.message);
      }
    }
  } catch (error: any) {
    console.error('[Scheduler] Error polling scheduled jobs:', error.message);
  } finally {
    isPolling = false;
  }
}

export function startScheduler(intervalMs = 2000) {
  if (schedulerInterval) return;
  console.log('[Scheduler] Recurring job scheduler service started.');
  schedulerInterval = setInterval(pollScheduledJobs, intervalMs);
}

export function stopScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    console.log('[Scheduler] Recurring job scheduler service stopped.');
  }
}
