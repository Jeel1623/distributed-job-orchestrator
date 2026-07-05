import { Request, Response } from 'express';
import { z } from 'zod';
import cronParser from 'cron-parser';
import prisma from '../db';
import { JobStatus, JobType, Prisma } from '@prisma/client';
import { io } from '../server'; // Socket.IO instance to push live updates

// Validation Schemas
export const CreateJobSchema = z.object({
  body: z.object({
    queueId: z.string(),
    payload: z.any(),
    priority: z.number().int().min(1).optional().default(1),
    runAt: z.string().datetime().optional(),
    idempotencyKey: z.string().optional(),
    dependsOnJobIds: z.array(z.string()).optional(),
    maxAttempts: z.number().int().min(1).max(20).optional().default(3)
  })
});

export const CreateRecurringJobSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    cronExpression: z.string(),
    queueId: z.string(),
    payload: z.any(),
    priority: z.number().int().min(1).optional().default(1),
    maxAttempts: z.number().int().min(1).max(20).optional().default(3)
  })
});

export const CreateBatchSchema = z.object({
  body: z.object({
    queueId: z.string(),
    jobs: z.array(
      z.object({
        payload: z.any(),
        priority: z.number().int().min(1).optional().default(1),
        idempotencyKey: z.string().optional(),
        maxAttempts: z.number().int().min(1).optional().default(3)
      })
    ).min(1)
  })
});

export const ListJobsQuerySchema = z.object({
  query: z.object({
    queueId: z.string().optional(),
    status: z.nativeEnum(JobStatus).optional(),
    batchId: z.string().optional(),
    page: z.string().regex(/^\d+$/).optional().default('1'),
    limit: z.string().regex(/^\d+$/).optional().default('20'),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional()
  })
});

// Create single Job (Immediate or Delayed)
export async function createJob(req: Request, res: Response) {
  const orgId = req.user!.orgId;
  const { queueId, payload, priority, runAt, idempotencyKey, dependsOnJobIds, maxAttempts } = req.body;

  try {
    // Verify queue belongs to user's org
    const queue = await prisma.queue.findFirst({
      where: { id: queueId, project: { orgId } }
    });

    if (!queue) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Queue not found in your organization' }
      });
    }

    // Verify dependencies exist and are in the same org
    if (dependsOnJobIds && dependsOnJobIds.length > 0) {
      const depCount = await prisma.job.count({
        where: {
          id: { in: dependsOnJobIds },
          queue: { project: { orgId } }
        }
      });
      if (depCount !== dependsOnJobIds.length) {
        return res.status(400).json({
          error: { code: 'BAD_REQUEST', message: 'One or more dependency jobs do not exist or are unauthorized' }
        });
      }
    }

    const type = runAt ? JobType.DELAYED : JobType.IMMEDIATE;
    const scheduledRunAt = runAt ? new Date(runAt) : new Date();

    const jobData: Prisma.JobCreateInput = {
      queue: { connect: { id: queueId } },
      type,
      status: JobStatus.QUEUED,
      payload: payload ?? {},
      priority,
      runAt: scheduledRunAt,
      idempotencyKey: idempotencyKey || null,
      maxAttempts
    };

    const job = await prisma.$transaction(async (tx) => {
      // Create job
      const createdJob = await tx.job.create({ data: jobData });

      // Create dependency links
      if (dependsOnJobIds && dependsOnJobIds.length > 0) {
        await tx.jobDependency.createMany({
          data: dependsOnJobIds.map((depId: string) => ({
            parentJobId: depId,
            childJobId: createdJob.id
          }))
        });
      }

      // Create initial log
      await tx.jobLog.create({
        data: {
          jobId: createdJob.id,
          level: 'info',
          message: `Job created. Type: ${type}, Status: QUEUED.`
        }
      });

      return createdJob;
    });

    // Notify clients of live update
    if (io) {
      io.emit('job:created', { id: job.id, queueId: job.queueId, status: job.status });
    }

    return res.status(201).json(job);
  } catch (error: any) {
    // Unique key check (queueId + idempotencyKey)
    if (error.code === 'P2002' && idempotencyKey) {
      const existing = await prisma.job.findUnique({
        where: {
          queueId_idempotencyKey: { queueId, idempotencyKey }
        }
      });
      return res.json(existing);
    }

    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: error.message }
    });
  }
}

// Create Recurring Job Definition (ScheduledJob)
export async function createRecurringJob(req: Request, res: Response) {
  const orgId = req.user!.orgId;
  const { name, cronExpression, queueId, payload, priority, maxAttempts } = req.body;

  try {
    // Verify queue belongs to user's org
    const queue = await prisma.queue.findFirst({
      where: { id: queueId, project: { orgId } }
    });

    if (!queue) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Queue not found in your organization' }
      });
    }

    // Validate Cron Expression
    let nextRun: Date;
    try {
      const interval = cronParser.parseExpression(cronExpression);
      nextRun = interval.next().toDate();
    } catch (e) {
      return res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'Invalid cron expression' }
      });
    }

    const scheduled = await prisma.scheduledJob.create({
      data: {
        name,
        cronExpression,
        queueId,
        payload: payload ?? {},
        priority,
        maxAttempts,
        nextRunAt: nextRun
      }
    });

    return res.status(201).json(scheduled);
  } catch (error: any) {
    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: error.message }
    });
  }
}

// Create Batch of Jobs
export async function createBatch(req: Request, res: Response) {
  const orgId = req.user!.orgId;
  const { queueId, jobs } = req.body;

  try {
    const queue = await prisma.queue.findFirst({
      where: { id: queueId, project: { orgId } }
    });

    if (!queue) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Queue not found in your organization' }
      });
    }

    const batchId = crypto.randomUUID ? crypto.randomUUID() : require('crypto').randomUUID();

    const createdJobs = await prisma.$transaction(async (tx) => {
      const results = [];
      for (const jobDef of jobs) {
        // Try creating individual job to safely handle potential idempotency conflicts in batch
        try {
          const job = await tx.job.create({
            data: {
              queueId,
              type: JobType.BATCH,
              status: JobStatus.QUEUED,
              payload: jobDef.payload ?? {},
              priority: jobDef.priority ?? 1,
              runAt: new Date(),
              idempotencyKey: jobDef.idempotencyKey || null,
              maxAttempts: jobDef.maxAttempts ?? 3,
              batchId
            }
          });

          await tx.jobLog.create({
            data: {
              jobId: job.id,
              level: 'info',
              message: `Job created as part of batch ${batchId}.`
            }
          });

          results.push(job);
        } catch (err: any) {
          if (err.code === 'P2002' && jobDef.idempotencyKey) {
            const existing = await tx.job.findUnique({
              where: {
                queueId_idempotencyKey: { queueId, idempotencyKey: jobDef.idempotencyKey }
              }
            });
            if (existing) results.push(existing);
          } else {
            throw err;
          }
        }
      }
      return results;
    });

    if (io) {
      io.emit('batch:created', { batchId, count: createdJobs.length });
    }

    return res.status(201).json({ batchId, jobs: createdJobs });
  } catch (error: any) {
    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: error.message }
    });
  }
}

// Get Job by ID (Includes logs and execution history)
export async function getJob(req: Request, res: Response) {
  const orgId = req.user!.orgId;
  const { id } = req.params;

  try {
    const job = await prisma.job.findFirst({
      where: {
        id,
        queue: { project: { orgId } }
      },
      include: {
        queue: {
          include: { project: true }
        },
        executions: {
          orderBy: { startedAt: 'desc' }
        },
        logs: {
          orderBy: { timestamp: 'desc' }
        },
        deadLetter: true,
        dependencies: {
          include: { parentJob: true }
        },
        dependents: {
          include: { childJob: true }
        }
      }
    });

    if (!job) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Job not found' }
      });
    }

    return res.json(job);
  } catch (error: any) {
    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: error.message }
    });
  }
}

// List Jobs with filters and pagination
export async function listJobs(req: Request, res: Response) {
  const orgId = req.user!.orgId;
  const { queueId, status, batchId, page, limit, startDate, endDate } = req.query as any;

  const pageNum = parseInt(page, 10);
  const limitNum = parseInt(limit, 10);
  const skip = (pageNum - 1) * limitNum;

  const whereClause: Prisma.JobWhereInput = {
    queue: { project: { orgId } }
  };

  if (queueId) whereClause.queueId = queueId;
  if (status) whereClause.status = status;
  if (batchId) whereClause.batchId = batchId;

  if (startDate || endDate) {
    whereClause.createdAt = {};
    if (startDate) whereClause.createdAt.gte = new Date(startDate);
    if (endDate) whereClause.createdAt.lte = new Date(endDate);
  }

  try {
    const [jobs, total] = await prisma.$transaction([
      prisma.job.findMany({
        where: whereClause,
        include: {
          queue: true
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum
      }),
      prisma.job.count({ where: whereClause })
    ]);

    return res.json({
      jobs,
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

// Cancel a Queued/Scheduled Job
export async function cancelJob(req: Request, res: Response) {
  const orgId = req.user!.orgId;
  const { id } = req.params;

  try {
    const job = await prisma.job.findFirst({
      where: {
        id,
        queue: { project: { orgId } }
      }
    });

    if (!job) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Job not found' }
      });
    }

    if (job.status !== JobStatus.QUEUED && job.status !== JobStatus.SCHEDULED) {
      return res.status(400).json({
        error: {
          code: 'INVALID_STATE',
          message: `Cannot cancel job in ${job.status} state. Only QUEUED or SCHEDULED jobs can be cancelled.`
        }
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.job.update({
        where: { id },
        data: { status: JobStatus.FAILED }
      });

      await tx.jobLog.create({
        data: {
          jobId: id,
          level: 'warn',
          message: 'Job cancelled by user request.'
        }
      });

      return u;
    });

    if (io) {
      io.emit('job:updated', { id: updated.id, status: updated.status });
    }

    return res.json(updated);
  } catch (error: any) {
    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: error.message }
    });
  }
}

// Manually retry a failed/DLQ Job
export async function retryJob(req: Request, res: Response) {
  const orgId = req.user!.orgId;
  const { id } = req.params;

  try {
    const job = await prisma.job.findFirst({
      where: {
        id,
        queue: { project: { orgId } }
      },
      include: { deadLetter: true }
    });

    if (!job) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Job not found' }
      });
    }

    if (job.status !== JobStatus.FAILED && job.status !== JobStatus.DEAD_LETTER) {
      return res.status(400).json({
        error: {
          code: 'INVALID_STATE',
          message: `Cannot retry job in ${job.status} state. Only FAILED or DEAD_LETTER jobs can be retried.`
        }
      });
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Delete from DLQ if exists
      if (job.deadLetter) {
        await tx.deadLetterEntry.delete({
          where: { jobId: id }
        });
      }

      // Reset job status to QUEUED, set attempts to 0, run immediately
      const u = await tx.job.update({
        where: { id },
        data: {
          status: JobStatus.QUEUED,
          attemptCount: 0,
          runAt: new Date()
        }
      });

      await tx.jobLog.create({
        data: {
          jobId: id,
          level: 'info',
          message: 'Job manually retried. Attempt count reset. Status set to QUEUED.'
        }
      });

      return u;
    });

    if (io) {
      io.emit('job:updated', { id: updated.id, status: updated.status });
    }

    return res.json(updated);
  } catch (error: any) {
    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: error.message }
    });
  }
}
