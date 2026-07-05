import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import prisma from '../db';
import { claimNextJob } from '../../../worker/src/poll';
import { JobStatus, RetryStrategy } from '@prisma/client';

describe('Atomic Claiming and Concurrency Tests', () => {
  let project: any;
  let queue: any;

  beforeAll(async () => {
    // Ensure test tables are clean
    await prisma.jobDependency.deleteMany({});
    await prisma.deadLetterEntry.deleteMany({});
    await prisma.jobLog.deleteMany({});
    await prisma.jobExecution.deleteMany({});
    await prisma.job.deleteMany({});
    await prisma.queue.deleteMany({});
    await prisma.project.deleteMany({});
    await prisma.organization.deleteMany({});

    // Seed test structures
    const org = await prisma.organization.create({
      data: { name: 'Test Org' }
    });

    project = await prisma.project.create({
      data: { name: 'Test Project', orgId: org.id }
    });

    const policy = await prisma.retryPolicy.create({
      data: {
        name: 'Test Fixed',
        strategy: RetryStrategy.FIXED,
        baseDelayMs: 1000,
        maxRetries: 3,
        maxDelayMs: 1000
      }
    });

    queue = await prisma.queue.create({
      data: {
        name: 'concurrency-test-queue',
        priority: 5,
        maxConcurrency: 3, // Capacity limit of 3 concurrent jobs
        projectId: project.id,
        defaultRetryPolicyId: policy.id
      }
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('should atomically claim jobs concurrently without double execution', async () => {
    // 1. Create 5 jobs in the queue
    const jobs = await Promise.all([
      prisma.job.create({
        data: {
          queueId: queue.id,
          type: 'IMMEDIATE',
          status: JobStatus.QUEUED,
          payload: { task: 1 },
          runAt: new Date()
        }
      }),
      prisma.job.create({
        data: {
          queueId: queue.id,
          type: 'IMMEDIATE',
          status: JobStatus.QUEUED,
          payload: { task: 2 },
          runAt: new Date()
        }
      }),
      prisma.job.create({
        data: {
          queueId: queue.id,
          type: 'IMMEDIATE',
          status: JobStatus.QUEUED,
          payload: { task: 3 },
          runAt: new Date()
        }
      }),
      prisma.job.create({
        data: {
          queueId: queue.id,
          type: 'IMMEDIATE',
          status: JobStatus.QUEUED,
          payload: { task: 4 },
          runAt: new Date()
        }
      }),
      prisma.job.create({
        data: {
          queueId: queue.id,
          type: 'IMMEDIATE',
          status: JobStatus.QUEUED,
          payload: { task: 5 },
          runAt: new Date()
        }
      })
    ]);

    // 2. Perform concurrent claiming using 5 different worker IDs
    const workerIds = ['w-1', 'w-2', 'w-3', 'w-4', 'w-5'];
    
    // Trigger claims concurrently
    const claims = await Promise.all(
      workerIds.map(wId => claimNextJob(wId))
    );

    // 3. Assertions:
    const successfulClaims = claims.filter((c: any): c is NonNullable<typeof c> => c !== null);
    
    // Since queue maxConcurrency = 3, we should have at most 3 jobs claimed!
    expect(successfulClaims.length).toBeLessThanOrEqual(3);
    
    const claimedJobIds = successfulClaims.map((c: any) => c.job.id);
    const uniqueClaimedJobIds = [...new Set(claimedJobIds)];

    // Verify that every claimed job is unique (no two workers claimed the same job!)
    expect(claimedJobIds.length).toBe(uniqueClaimedJobIds.length);

    // Clean up
    await prisma.jobExecution.deleteMany({});
    await prisma.job.deleteMany({});
  });
});
