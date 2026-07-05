import prisma from 'backend/db';
import { Job, JobExecution, JobStatus, Queue } from '@prisma/client';
import { calculateNextRunAt } from 'backend/services/retry';
import { generateFailureSummary } from 'backend/services/ai';

export interface ClaimedJob {
  job: Job;
  executionId: string;
}

export async function claimNextJob(workerId: string): Promise<ClaimedJob | null> {
  // 1. Get all active (non-paused) queues ordered by priority desc
  const queues = await prisma.queue.findMany({
    where: { isPaused: false },
    orderBy: { priority: 'desc' }
  });

  for (const queue of queues) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        // 2. Lock the Queue row for update to ensure concurrency limits are checked atomically
        const lockedQueues = await tx.$queryRawUnsafe<Queue[]>(
          `SELECT * FROM queues WHERE id = $1 FOR UPDATE`,
          queue.id
        );

        if (lockedQueues.length === 0) return null;
        const lockedQueue = lockedQueues[0];

        if (lockedQueue.isPaused) return null;

        // 3. Count running jobs in this queue
        const runningCount = await tx.job.count({
          where: {
            queueId: queue.id,
            status: { in: [JobStatus.CLAIMED, JobStatus.RUNNING] }
          }
        });

        if (runningCount >= lockedQueue.maxConcurrency) {
          return null; // Queue is at max capacity
        }

        // 4. Find the next eligible job using SKIP LOCKED
        // Respect job priority and runAt, check dependencies
        const candidateJobs = await tx.$queryRawUnsafe<any[]>(
          `SELECT j.id FROM jobs j
           WHERE j.queue_id = $1
             AND j.status = 'QUEUED'
             AND j.run_at <= NOW()
             -- DAG Dependency check: No parent jobs exist that are NOT completed
             AND NOT EXISTS (
               SELECT 1 FROM job_dependencies jd
               JOIN jobs parent ON parent.id = jd.parent_job_id
               WHERE jd.child_job_id = j.id AND parent.status != 'COMPLETED'
             )
           ORDER BY j.priority DESC, j.run_at ASC
           LIMIT 1
           FOR UPDATE SKIP LOCKED`,
          queue.id
        );

        if (candidateJobs.length === 0) {
          return null; // No jobs ready in this queue
        }

        const jobId = candidateJobs[0].id;
        const now = new Date();

        // 5. Claim the job: Increment attempts, update status, associate worker
        const updatedJob = await tx.job.update({
          where: { id: jobId },
          data: {
            status: JobStatus.CLAIMED,
            attemptCount: { increment: 1 },
            workerId
          }
        });

        // 6. Create JobExecution record
        const execution = await tx.jobExecution.create({
          data: {
            jobId,
            workerId,
            status: JobStatus.CLAIMED,
            startedAt: now
          }
        });

        // 7. Write JobLog
        await tx.jobLog.create({
          data: {
            jobId,
            executionId: execution.id,
            level: 'info',
            message: `Job claimed by worker ${workerId}. Starting attempt ${updatedJob.attemptCount}/${updatedJob.maxAttempts}.`
          }
        });

        return { job: updatedJob, executionId: execution.id };
      });

      if (result) {
        return result;
      }
    } catch (err: any) {
      console.error(`[Worker ${workerId}] Error in claim transaction for queue ${queue.name}:`, err.message);
    }
  }

  return null;
}

export async function finishJob(
  jobId: string,
  executionId: string,
  workerId: string,
  result: any
) {
  const now = new Date();
  try {
    await prisma.$transaction(async (tx) => {
      const exec = await tx.jobExecution.findUnique({ where: { id: executionId } });
      const durationMs = exec ? now.getTime() - exec.startedAt.getTime() : null;

      await tx.job.update({
        where: { id: jobId },
        data: {
          status: JobStatus.COMPLETED,
          workerId: null
        }
      });

      await tx.jobExecution.update({
        where: { id: executionId },
        data: {
          status: JobStatus.COMPLETED,
          finishedAt: now,
          durationMs
        }
      });

      await tx.jobLog.create({
        data: {
          jobId,
          executionId,
          level: 'info',
          message: `Job execution completed successfully. Duration: ${durationMs}ms.`
        }
      });
    });
  } catch (err: any) {
    console.error(`[Worker ${workerId}] Error finishing job ${jobId}:`, err.message);
  }
}

export async function failJob(
  jobId: string,
  executionId: string,
  workerId: string,
  error: Error
) {
  const now = new Date();
  try {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: {
        queue: {
          include: { defaultRetryPolicy: true }
        }
      }
    });

    if (!job) return;

    await prisma.$transaction(async (tx) => {
      const exec = await tx.jobExecution.findUnique({ where: { id: executionId } });
      const durationMs = exec ? now.getTime() - exec.startedAt.getTime() : null;

      // Update the execution record
      await tx.jobExecution.update({
        where: { id: executionId },
        data: {
          status: JobStatus.FAILED,
          finishedAt: now,
          errorMessage: error.message,
          stackTrace: error.stack,
          durationMs
        }
      });

      await tx.jobLog.create({
        data: {
          jobId,
          executionId,
          level: 'error',
          message: `Attempt ${job.attemptCount} failed: ${error.message}`
        }
      });

      // Determine next action: retry or DLQ
      if (job.attemptCount >= job.maxAttempts) {
        // Exceeded max attempts: move to DLQ
        await tx.job.update({
          where: { id: jobId },
          data: {
            status: JobStatus.DEAD_LETTER,
            workerId: null
          }
        });

        await tx.deadLetterEntry.create({
          data: {
            jobId,
            finalError: error.message,
            errorStack: error.stack,
            originalQueueId: job.queueId,
            payloadSnapshot: job.payload || {}
          }
        });

        await tx.jobLog.create({
          data: {
            jobId,
            level: 'error',
            message: `Job failed permanently after ${job.attemptCount} attempts. Moved to Dead Letter Queue.`
          }
        });
      } else {
        // Reschedule
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
          where: { id: jobId },
          data: {
            status: JobStatus.QUEUED,
            runAt: nextRunAt,
            workerId: null
          }
        });

        await tx.jobLog.create({
          data: {
            jobId,
            level: 'warn',
            message: `Job rescheduled for retry attempt ${job.attemptCount + 1}/${job.maxAttempts} at ${nextRunAt.toISOString()}`
          }
        });
      }
    });

    // Asynchronously trigger AI Summary if in DLQ
    if (job.attemptCount >= job.maxAttempts) {
      generateFailureSummary(jobId).catch(aiErr => {
        console.error(`[Worker ${workerId}] AI Summary error:`, aiErr.message);
      });
    }
  } catch (err: any) {
    console.error(`[Worker ${workerId}] Error failing job ${jobId}:`, err.message);
  }
}
