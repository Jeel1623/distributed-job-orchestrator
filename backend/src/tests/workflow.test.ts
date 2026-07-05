import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import prisma from '../db';
import { claimNextJob } from '../../../worker/src/poll';
import { JobStatus, RetryStrategy, JobType } from '@prisma/client';

describe('Workflow Dependency (DAG) Tests', () => {
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

    const org = await prisma.organization.create({
      data: { name: 'Test Org' }
    });

    project = await prisma.project.create({
      data: { name: 'Test Project', orgId: org.id }
    });

    queue = await prisma.queue.create({
      data: {
        name: 'workflow-test-queue',
        priority: 1,
        maxConcurrency: 2,
        projectId: project.id
      }
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('should block child job execution until parent job is COMPLETED', async () => {
    // 1. Create parent job (QUEUED) and child job (QUEUED)
    const parentJob = await prisma.job.create({
      data: {
        queueId: queue.id,
        type: JobType.IMMEDIATE,
        status: JobStatus.QUEUED,
        payload: { step: 'parent' },
        runAt: new Date()
      }
    });

    const childJob = await prisma.job.create({
      data: {
        queueId: queue.id,
        type: JobType.IMMEDIATE,
        status: JobStatus.QUEUED,
        payload: { step: 'child' },
        runAt: new Date()
      }
    });

    // Link parent -> child
    await prisma.jobDependency.create({
      data: {
        parentJobId: parentJob.id,
        childJobId: childJob.id
      }
    });

    // 2. Try to claim a job. The parent job should be claimable, but the child job should NOT!
    // Since child depends on parent and parent is still QUEUED.
    const claim1 = await claimNextJob('worker-test-1');
    expect(claim1).not.toBeNull();
    // It should have claimed the parent job
    expect(claim1?.job.id).toBe(parentJob.id);

    // Try to claim another job. Since the parent is currently CLAIMED (not COMPLETED),
    // the child job should still be blocked!
    const claim2 = await claimNextJob('worker-test-2');
    expect(claim2).toBeNull(); // Blocked!

    // 3. Mark the parent job as COMPLETED
    await prisma.job.update({
      where: { id: parentJob.id },
      data: { status: JobStatus.COMPLETED }
    });

    // 4. Try to claim again. Now the child job should be claimable!
    const claim3 = await claimNextJob('worker-test-3');
    expect(claim3).not.toBeNull();
    expect(claim3?.job.id).toBe(childJob.id);

    // Clean up
    await prisma.jobDependency.deleteMany({});
    await prisma.jobExecution.deleteMany({});
    await prisma.job.deleteMany({});
  });
});
