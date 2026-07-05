import prisma from '../db';
import { WorkerStatus, JobStatus } from '@prisma/client';
import { calculateNextRunAt } from './retry';
import { io } from '../server';

let reaperInterval: NodeJS.Timeout | null = null;
let isReaping = false;

async function reapDeadWorkers() {
  if (isReaping) return;
  isReaping = true;

  try {
    const timeoutThreshold = new Date(Date.now() - 15000); // 15 seconds timeout

    // 1. Identify workers who haven't sent a heartbeat recently and are not already marked DEAD
    const deadWorkers = await prisma.worker.findMany({
      where: {
        status: { in: [WorkerStatus.ACTIVE, WorkerStatus.DRAINING] },
        lastHeartbeatAt: { lt: timeoutThreshold }
      }
    });

    for (const worker of deadWorkers) {
      console.warn(`[Reaper] Worker ${worker.id} has missed heartbeats. Initiating reaping...`);

      // Update worker status to DEAD
      await prisma.worker.update({
        where: { id: worker.id },
        data: { status: WorkerStatus.DEAD }
      });

      // Find all jobs that this worker was executing (status CLAIMED or RUNNING)
      const hijackedJobs = await prisma.job.findMany({
        where: {
          workerId: worker.id,
          status: { in: [JobStatus.CLAIMED, JobStatus.RUNNING] }
        },
        include: {
          queue: {
            include: { defaultRetryPolicy: true }
          }
        }
      });

      for (const job of hijackedJobs) {
        try {
          await prisma.$transaction(async (tx) => {
            const errorMessage = `Worker node ${worker.id} crashed/lost heartbeat during execution.`;
            const now = new Date();

            // Find current active execution and fail it
            const activeExecution = await tx.jobExecution.findFirst({
              where: { jobId: job.id, workerId: worker.id, finishedAt: null },
              orderBy: { startedAt: 'desc' }
            });

            if (activeExecution) {
              await tx.jobExecution.update({
                where: { id: activeExecution.id },
                data: {
                  status: JobStatus.FAILED,
                  finishedAt: now,
                  errorMessage,
                  durationMs: now.getTime() - activeExecution.startedAt.getTime()
                }
              });

              await tx.jobLog.create({
                data: {
                  jobId: job.id,
                  executionId: activeExecution.id,
                  level: 'error',
                  message: `Execution failed: ${errorMessage}`
                }
              });
            }

            // Determine if we retry or DLQ
            if (job.attemptCount >= job.maxAttempts) {
              // Move to DLQ
              await tx.job.update({
                where: { id: job.id },
                data: {
                  status: JobStatus.DEAD_LETTER,
                  workerId: null
                }
              });

              await tx.deadLetterEntry.create({
                data: {
                  jobId: job.id,
                  finalError: errorMessage,
                  originalQueueId: job.queueId,
                  payloadSnapshot: job.payload || {}
                }
              });

              await tx.jobLog.create({
                data: {
                  jobId: job.id,
                  level: 'error',
                  message: `Job exceeded maximum attempts (${job.maxAttempts}). Moved to DLQ.`
                }
              });
            } else {
              // Reschedule job according to policy
              let nextRunAt = new Date();
              if (job.queue.defaultRetryPolicy) {
                const policy = job.queue.defaultRetryPolicy;
                nextRunAt = calculateNextRunAt(
                  policy.strategy,
                  policy.baseDelayMs,
                  policy.maxDelayMs,
                  job.attemptCount
                );
              }

              await tx.job.update({
                where: { id: job.id },
                data: {
                  status: JobStatus.QUEUED,
                  runAt: nextRunAt,
                  workerId: null
                }
              });

              await tx.jobLog.create({
                data: {
                  jobId: job.id,
                  level: 'warn',
                  message: `Job rescheduled for retry attempt ${job.attemptCount + 1}/${job.maxAttempts} at ${nextRunAt.toISOString()}`
                }
              });
            }
          });

          if (io) {
            io.emit('job:updated', { id: job.id, status: JobStatus.FAILED });
          }
        } catch (jobErr: any) {
          console.error(`[Reaper] Failed to fail-safe job ${job.id}:`, jobErr.message);
        }
      }

      // Notify clients of worker change
      if (io) {
        io.emit('worker:updated', { id: worker.id, status: WorkerStatus.DEAD });
      }
    }
  } catch (error: any) {
    console.error('[Reaper] Error running worker reaper:', error.message);
  } finally {
    isReaping = false;
  }
}

export function startReaper(intervalMs = 5000) {
  if (reaperInterval) return;
  console.log('[Reaper] Dead worker reaper service started.');
  reaperInterval = setInterval(reapDeadWorkers, intervalMs);
}

export function stopReaper() {
  if (reaperInterval) {
    clearInterval(reaperInterval);
    reaperInterval = null;
    console.log('[Reaper] Dead worker reaper service stopped.');
  }
}
