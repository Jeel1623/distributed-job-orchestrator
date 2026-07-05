import { Request, Response } from 'express';
import prisma from '../db';
import { JobStatus, WorkerStatus } from '@prisma/client';
import { io } from '../server';

// ==========================================
// 1. WORKERS ENDPOINTS
// ==========================================

export async function listWorkers(req: Request, res: Response) {
  try {
    const workers = await prisma.worker.findMany({
      include: {
        _count: {
          select: { jobs: true }
        }
      },
      orderBy: { lastHeartbeatAt: 'desc' }
    });
    return res.json(workers);
  } catch (error: any) {
    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: error.message }
    });
  }
}

export async function getWorker(req: Request, res: Response) {
  const { id } = req.params;

  try {
    const worker = await prisma.worker.findUnique({
      where: { id },
      include: {
        heartbeats: {
          orderBy: { timestamp: 'desc' },
          take: 30
        },
        jobs: {
          where: { status: { in: ['CLAIMED', 'RUNNING'] } },
          include: { queue: true }
        }
      }
    });

    if (!worker) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Worker not found' }
      });
    }

    return res.json(worker);
  } catch (error: any) {
    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: error.message }
    });
  }
}

// ==========================================
// 2. DEAD LETTER QUEUE (DLQ) ENDPOINTS
// ==========================================

export async function listDLQ(req: Request, res: Response) {
  const orgId = req.user!.orgId;
  const { page = '1', limit = '20' } = req.query as any;

  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const skip = (pageNum - 1) * limitNum;

  try {
    const [entries, total] = await prisma.$transaction([
      prisma.deadLetterEntry.findMany({
        where: {
          queue: { project: { orgId } }
        },
        include: {
          job: {
            include: {
              executions: {
                orderBy: { startedAt: 'desc' },
                take: 1
              }
            }
          },
          queue: true
        },
        orderBy: { movedAt: 'desc' },
        skip,
        take: limitNum
      }),
      prisma.deadLetterEntry.count({
        where: {
          queue: { project: { orgId } }
        }
      })
    ]);

    return res.json({
      entries,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error: any) {
    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: error.message }
    });
  }
}

export async function retryDLQJob(req: Request, res: Response) {
  const orgId = req.user!.orgId;
  const { jobId } = req.params;

  try {
    const entry = await prisma.deadLetterEntry.findFirst({
      where: {
        jobId,
        queue: { project: { orgId } }
      }
    });

    if (!entry) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'DLQ entry not found for this job' }
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Delete DLQ entry
      await tx.deadLetterEntry.delete({ where: { id: entry.id } });

      // Reset job to QUEUED
      const j = await tx.job.update({
        where: { id: jobId },
        data: {
          status: JobStatus.QUEUED,
          attemptCount: 0,
          runAt: new Date()
        }
      });

      await tx.jobLog.create({
        data: {
          jobId,
          level: 'info',
          message: 'Job retried from DLQ.'
        }
      });

      return j;
    });

    if (io) {
      io.emit('job:updated', { id: updated.id, status: updated.status });
    }

    return res.json({ success: true, job: updated });
  } catch (error: any) {
    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: error.message }
    });
  }
}

export async function bulkRetryDLQ(req: Request, res: Response) {
  const orgId = req.user!.orgId;
  const { jobIds } = req.body; // Expect array of job IDs

  if (!Array.isArray(jobIds) || jobIds.length === 0) {
    return res.status(400).json({
      error: { code: 'BAD_REQUEST', message: 'jobIds must be a non-empty array' }
    });
  }

  try {
    const entries = await prisma.deadLetterEntry.findMany({
      where: {
        jobId: { in: jobIds },
        queue: { project: { orgId } }
      }
    });

    const validJobIds = entries.map(e => e.jobId);
    const validEntryIds = entries.map(e => e.id);

    if (validJobIds.length === 0) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'No matching DLQ entries found' }
      });
    }

    await prisma.$transaction(async (tx) => {
      // Delete entries
      await tx.deadLetterEntry.deleteMany({
        where: { id: { in: validEntryIds } }
      });

      // Update jobs
      await tx.job.updateMany({
        where: { id: { in: validJobIds } },
        data: {
          status: JobStatus.QUEUED,
          attemptCount: 0,
          runAt: new Date()
        }
      });

      // Create logs
      await tx.jobLog.createMany({
        data: validJobIds.map(jobId => ({
          jobId,
          level: 'info',
          message: 'Job retried via bulk DLQ operation.'
        }))
      });
    });

    if (io) {
      validJobIds.forEach(id => {
        io.emit('job:updated', { id, status: JobStatus.QUEUED });
      });
    }

    return res.json({ success: true, retriedCount: validJobIds.length });
  } catch (error: any) {
    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: error.message }
    });
  }
}

export async function deleteDLQJob(req: Request, res: Response) {
  const orgId = req.user!.orgId;
  const { jobId } = req.params;

  try {
    const entry = await prisma.deadLetterEntry.findFirst({
      where: {
        jobId,
        queue: { project: { orgId } }
      }
    });

    if (!entry) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'DLQ entry not found for this job' }
      });
    }

    // Deleting the job will cascade delete the deadLetterEntry, executions, and logs
    await prisma.job.delete({
      where: { id: jobId }
    });

    if (io) {
      io.emit('job:deleted', { id: jobId });
    }

    return res.json({ success: true });
  } catch (error: any) {
    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: error.message }
    });
  }
}

// ==========================================
// 3. METRICS / DASHBOARD ENDPOINTS
// ==========================================

export async function getMetricsSummary(req: Request, res: Response) {
  const orgId = req.user!.orgId;

  try {
    // 1. Queues Count
    const queuesCount = await prisma.queue.count({
      where: { project: { orgId } }
    });

    // 2. Active Workers
    const activeWorkers = await prisma.worker.count({
      where: { status: WorkerStatus.ACTIVE }
    });

    // 3. Queue Depth across all queues in organization
    const depth = await prisma.job.count({
      where: {
        queue: { project: { orgId } },
        status: { in: [JobStatus.QUEUED, JobStatus.SCHEDULED] }
      }
    });

    // 4. Running jobs
    const running = await prisma.job.count({
      where: {
        queue: { project: { orgId } },
        status: { in: [JobStatus.CLAIMED, JobStatus.RUNNING] }
      }
    });

    // 5. Total completed & failed jobs in organization
    const completed = await prisma.job.count({
      where: {
        queue: { project: { orgId } },
        status: JobStatus.COMPLETED
      }
    });

    const failed = await prisma.job.count({
      where: {
        queue: { project: { orgId } },
        status: JobStatus.FAILED
      }
    });

    const dlqCount = await prisma.deadLetterEntry.count({
      where: {
        queue: { project: { orgId } }
      }
    });

    return res.json({
      queuesCount,
      activeWorkers,
      depth,
      running,
      completed,
      failed,
      dlqCount,
      systemHealth: activeWorkers > 0 ? 'HEALTHY' : 'DEGRADED'
    });
  } catch (error: any) {
    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: error.message }
    });
  }
}

export async function getThroughputMetrics(req: Request, res: Response) {
  const orgId = req.user!.orgId;

  try {
    // We want hourly completed/failed job counts for the last 24 hours.
    const past24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const executions = await prisma.jobExecution.findMany({
      where: {
        job: { queue: { project: { orgId } } },
        finishedAt: { gte: past24h },
        status: { in: ['COMPLETED', 'FAILED', 'DEAD_LETTER'] }
      },
      select: {
        status: true,
        finishedAt: true
      }
    });

    // Initialize 24 hourly buckets
    const hourlyBuckets: Record<string, { hour: string; completed: number; failed: number }> = {};
    for (let i = 23; i >= 0; i--) {
      const d = new Date(Date.now() - i * 60 * 60 * 1000);
      d.setMinutes(0, 0, 0);
      const key = d.toISOString();
      const displayHour = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      hourlyBuckets[key] = { hour: displayHour, completed: 0, failed: 0 };
    }

    // Populate buckets
    executions.forEach(exec => {
      if (!exec.finishedAt) return;
      const d = new Date(exec.finishedAt);
      d.setMinutes(0, 0, 0);
      const key = d.toISOString();
      if (hourlyBuckets[key]) {
        if (exec.status === 'COMPLETED') {
          hourlyBuckets[key].completed++;
        } else {
          hourlyBuckets[key].failed++;
        }
      }
    });

    const chartData = Object.values(hourlyBuckets);
    return res.json(chartData);
  } catch (error: any) {
    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: error.message }
    });
  }
}

export async function getQueueBreakdown(req: Request, res: Response) {
  const orgId = req.user!.orgId;

  try {
    const queues = await prisma.queue.findMany({
      where: { project: { orgId } },
      include: {
        project: true
      }
    });

    const breakdown = await Promise.all(
      queues.map(async q => {
        const depth = await prisma.job.count({
          where: { queueId: q.id, status: { in: ['QUEUED', 'SCHEDULED'] } }
        });

        const running = await prisma.job.count({
          where: { queueId: q.id, status: { in: ['CLAIMED', 'RUNNING'] } }
        });

        const completed = await prisma.job.count({
          where: { queueId: q.id, status: 'COMPLETED' }
        });

        const failed = await prisma.job.count({
          where: { queueId: q.id, status: { in: ['FAILED', 'DEAD_LETTER'] } }
        });

        return {
          queueId: q.id,
          queueName: q.name,
          projectName: q.project.name,
          priority: q.priority,
          maxConcurrency: q.maxConcurrency,
          isPaused: q.isPaused,
          depth,
          running,
          completed,
          failed
        };
      })
    );

    return res.json(breakdown);
  } catch (error: any) {
    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: error.message }
    });
  }
}
