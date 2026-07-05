import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../db';

export const CreateQueueSchema = z.object({
  body: z.object({
    name: z.string().min(1),
    projectId: z.string(),
    priority: z.number().int().min(1).default(1),
    maxConcurrency: z.number().int().min(1).default(5),
    defaultRetryPolicyId: z.string().optional()
  })
});

export async function listRetryPolicies(req: Request, res: Response) {
  try {
    const policies = await prisma.retryPolicy.findMany({
      orderBy: { name: 'asc' }
    });
    return res.json(policies);
  } catch (error: any) {
    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: error.message }
    });
  }
}

export const UpdateQueueSchema = z.object({
  body: z.object({
    priority: z.number().int().min(1).optional(),
    maxConcurrency: z.number().int().min(1).optional(),
    defaultRetryPolicyId: z.string().optional().nullable()
  })
});

// List all queues for projects in the user's Organization
export async function listQueues(req: Request, res: Response) {
  const orgId = req.user!.orgId;

  try {
    const queues = await prisma.queue.findMany({
      where: {
        project: { orgId }
      },
      include: {
        project: true,
        defaultRetryPolicy: true
      },
      orderBy: { createdAt: 'desc' }
    });
    return res.json(queues);
  } catch (error: any) {
    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: error.message }
    });
  }
}

export async function getQueue(req: Request, res: Response) {
  const orgId = req.user!.orgId;
  const { id } = req.params;

  try {
    const queue = await prisma.queue.findFirst({
      where: {
        id,
        project: { orgId }
      },
      include: {
        project: true,
        defaultRetryPolicy: true
      }
    });

    if (!queue) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Queue not found' }
      });
    }

    return res.json(queue);
  } catch (error: any) {
    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: error.message }
    });
  }
}

export async function createQueue(req: Request, res: Response) {
  const orgId = req.user!.orgId;
  const { name, projectId, priority, maxConcurrency, defaultRetryPolicyId } = req.body;

  try {
    // Ensure the project belongs to the user's org
    const project = await prisma.project.findFirst({
      where: { id: projectId, orgId }
    });

    if (!project) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Project not found in your organization' }
      });
    }

    // Check if queue name already exists in project
    const existingQueue = await prisma.queue.findUnique({
      where: {
        projectId_name: { projectId, name }
      }
    });

    if (existingQueue) {
      return res.status(409).json({
        error: { code: 'CONFLICT', message: `Queue with name '${name}' already exists in this project.` }
      });
    }

    const queue = await prisma.queue.create({
      data: {
        name,
        projectId,
        priority,
        maxConcurrency,
        defaultRetryPolicyId
      },
      include: {
        defaultRetryPolicy: true
      }
    });

    return res.status(201).json(queue);
  } catch (error: any) {
    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: error.message }
    });
  }
}

export async function updateQueue(req: Request, res: Response) {
  const orgId = req.user!.orgId;
  const { id } = req.params;
  const { priority, maxConcurrency, defaultRetryPolicyId } = req.body;

  try {
    const queue = await prisma.queue.findFirst({
      where: {
        id,
        project: { orgId }
      }
    });

    if (!queue) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Queue not found' }
      });
    }

    const updated = await prisma.queue.update({
      where: { id },
      data: {
        priority: priority !== undefined ? priority : undefined,
        maxConcurrency: maxConcurrency !== undefined ? maxConcurrency : undefined,
        defaultRetryPolicyId: defaultRetryPolicyId !== undefined ? defaultRetryPolicyId : undefined
      },
      include: {
        defaultRetryPolicy: true
      }
    });

    return res.json(updated);
  } catch (error: any) {
    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: error.message }
    });
  }
}

export async function deleteQueue(req: Request, res: Response) {
  const orgId = req.user!.orgId;
  const { id } = req.params;

  try {
    const queue = await prisma.queue.findFirst({
      where: {
        id,
        project: { orgId }
      }
    });

    if (!queue) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Queue not found' }
      });
    }

    // Check if jobs exist (FK constraint on Job -> Queue is Restrict)
    const jobsCount = await prisma.job.count({ where: { queueId: id } });
    if (jobsCount > 0) {
      return res.status(400).json({
        error: {
          code: 'PRECONDITION_FAILED',
          message: 'Cannot delete queue because it contains jobs. Delete jobs first or purge queue.'
        }
      });
    }

    await prisma.queue.delete({ where: { id } });
    return res.json({ success: true });
  } catch (error: any) {
    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: error.message }
    });
  }
}

export async function pauseQueue(req: Request, res: Response) {
  const orgId = req.user!.orgId;
  const { id } = req.params;

  try {
    const queue = await prisma.queue.findFirst({
      where: { id, project: { orgId } }
    });

    if (!queue) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Queue not found' }
      });
    }

    const updated = await prisma.queue.update({
      where: { id },
      data: { isPaused: true }
    });

    return res.json(updated);
  } catch (error: any) {
    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: error.message }
    });
  }
}

export async function resumeQueue(req: Request, res: Response) {
  const orgId = req.user!.orgId;
  const { id } = req.params;

  try {
    const queue = await prisma.queue.findFirst({
      where: { id, project: { orgId } }
    });

    if (!queue) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Queue not found' }
      });
    }

    const updated = await prisma.queue.update({
      where: { id },
      data: { isPaused: false }
    });

    return res.json(updated);
  } catch (error: any) {
    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: error.message }
    });
  }
}

export async function getQueueStats(req: Request, res: Response) {
  const orgId = req.user!.orgId;
  const { id } = req.params;

  try {
    const queue = await prisma.queue.findFirst({
      where: { id, project: { orgId } }
    });

    if (!queue) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Queue not found' }
      });
    }

    // Depth: QUEUED + SCHEDULED
    const depth = await prisma.job.count({
      where: { queueId: id, status: { in: ['QUEUED', 'SCHEDULED'] } }
    });

    // Running: CLAIMED + RUNNING
    const running = await prisma.job.count({
      where: { queueId: id, status: { in: ['CLAIMED', 'RUNNING'] } }
    });

    // Total finished counts for success rate calculation
    const completedCount = await prisma.job.count({
      where: { queueId: id, status: 'COMPLETED' }
    });
    const failedCount = await prisma.job.count({
      where: { queueId: id, status: { in: ['FAILED', 'DEAD_LETTER'] } }
    });

    const totalFinished = completedCount + failedCount;
    const successRate = totalFinished > 0 ? (completedCount / totalFinished) * 100 : 100;

    // Average Duration of completed jobs
    const durationAggregate = await prisma.jobExecution.aggregate({
      where: {
        job: { queueId: id },
        status: 'COMPLETED',
        durationMs: { not: null }
      },
      _avg: {
        durationMs: true
      }
    });
    const avgDurationMs = durationAggregate._avg.durationMs ? Math.round(durationAggregate._avg.durationMs) : 0;

    // Throughput (completed in last 24h)
    const past24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const throughput24h = await prisma.jobExecution.count({
      where: {
        job: { queueId: id },
        status: 'COMPLETED',
        finishedAt: { gte: past24h }
      }
    });

    return res.json({
      queueId: id,
      queueName: queue.name,
      depth,
      running,
      completedCount,
      failedCount,
      successRate: Math.round(successRate * 100) / 100,
      avgDurationMs,
      throughput24h
    });
  } catch (error: any) {
    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: error.message }
    });
  }
}
