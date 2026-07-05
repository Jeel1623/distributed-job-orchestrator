import { PrismaClient, Role, JobType, JobStatus, RetryStrategy } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('[Seed] Starting database seeding...');

  // 1. Clean up existing data to ensure idempotency of seed
  await prisma.jobDependency.deleteMany({});
  await prisma.deadLetterEntry.deleteMany({});
  await prisma.jobLog.deleteMany({});
  await prisma.jobExecution.deleteMany({});
  await prisma.job.deleteMany({});
  await prisma.scheduledJob.deleteMany({});
  await prisma.workerHeartbeat.deleteMany({});
  await prisma.worker.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.queue.deleteMany({});
  await prisma.retryPolicy.deleteMany({});
  await prisma.project.deleteMany({});
  await prisma.organization.deleteMany({});

  // 2. Create Organization
  const org = await prisma.organization.create({
    data: { name: 'Acme Corp' }
  });

  // 3. Create Admin User (admin@acme.com / admin123)
  const passwordHash = await bcrypt.hash('admin123', 10);
  const admin = await prisma.user.create({
    data: {
      email: 'admin@acme.com',
      passwordHash,
      role: Role.ADMIN,
      orgId: org.id
    }
  });

  // 4. Create Project
  const project = await prisma.project.create({
    data: {
      name: 'Main Platform',
      orgId: org.id
    }
  });

  // 5. Create Retry Policies
  const policyFixed = await prisma.retryPolicy.create({
    data: {
      name: 'Fixed 3s Retry',
      strategy: RetryStrategy.FIXED,
      baseDelayMs: 3000,
      maxRetries: 3,
      maxDelayMs: 3000
    }
  });

  const policyExponential = await prisma.retryPolicy.create({
    data: {
      name: 'Exponential Backoff',
      strategy: RetryStrategy.EXPONENTIAL,
      baseDelayMs: 1000,
      maxRetries: 4,
      maxDelayMs: 10000
    }
  });

  // 6. Create Queues
  const defaultQueue = await prisma.queue.create({
    data: {
      name: 'default',
      priority: 1,
      maxConcurrency: 3,
      projectId: project.id,
      defaultRetryPolicyId: policyFixed.id
    }
  });

  const highPriorityQueue = await prisma.queue.create({
    data: {
      name: 'high-priority',
      priority: 10,
      maxConcurrency: 5,
      projectId: project.id,
      defaultRetryPolicyId: policyFixed.id
    }
  });

  const flakyQueue = await prisma.queue.create({
    data: {
      name: 'flaky-queue',
      priority: 2,
      maxConcurrency: 2,
      projectId: project.id,
      defaultRetryPolicyId: policyExponential.id
    }
  });

  // 7. Seed Scheduled/Recurring Job
  await prisma.scheduledJob.create({
    data: {
      name: 'Hourly DB Cleanup',
      cronExpression: '*/30 * * * * *', // every 30 seconds for quick demo
      queueId: defaultQueue.id,
      payload: { action: 'vacuum', target: 'jobs' },
      priority: 1,
      maxAttempts: 3,
      nextRunAt: new Date(Date.now() + 5000) // start in 5 seconds
    }
  });

  // 8. Seed immediate / completed job for history
  const finishedJob = await prisma.job.create({
    data: {
      queueId: defaultQueue.id,
      type: JobType.IMMEDIATE,
      status: JobStatus.COMPLETED,
      payload: { taskId: 44, taskType: 'HTTP', url: 'https://httpbin.org/delay/1' },
      priority: 1,
      runAt: new Date(Date.now() - 60000),
      attemptCount: 1,
      maxAttempts: 3
    }
  });

  const startTime = new Date(Date.now() - 60000);
  const endTime = new Date(Date.now() - 58000);
  const exec = await prisma.jobExecution.create({
    data: {
      jobId: finishedJob.id,
      workerId: 'worker-seed',
      startedAt: startTime,
      finishedAt: endTime,
      status: JobStatus.COMPLETED,
      durationMs: 2000
    }
  });

  await prisma.jobLog.create({
    data: {
      jobId: finishedJob.id,
      executionId: exec.id,
      timestamp: startTime,
      level: 'info',
      message: 'Claimed and starting execution on worker-seed'
    }
  });

  await prisma.jobLog.create({
    data: {
      jobId: finishedJob.id,
      executionId: exec.id,
      timestamp: endTime,
      level: 'info',
      message: 'Execution succeeded. Status code 200.'
    }
  });

  // 9. Seed delayed job
  await prisma.job.create({
    data: {
      queueId: defaultQueue.id,
      type: JobType.DELAYED,
      status: JobStatus.QUEUED,
      payload: { reportId: 789, format: 'pdf' },
      priority: 3,
      runAt: new Date(Date.now() + 60000), // run in 60s
      maxAttempts: 3
    }
  });

  // 10. Seed Flaky Job that will fail and retry
  await prisma.job.create({
    data: {
      queueId: flakyQueue.id,
      type: JobType.IMMEDIATE,
      status: JobStatus.QUEUED,
      payload: { action: 'sync-users', flaky: true }, // Flaky handler will trigger error
      priority: 5,
      runAt: new Date(),
      maxAttempts: 3,
      idempotencyKey: 'flaky-seed-key'
    }
  });

  // 11. Seed Workflow Dependency DAG
  // Job A (Completed) -> Job B (Queued, Blocked by C)
  // Job C (Queued, claimable) -> Job D (Queued, Blocked by C)
  const jobParent = await prisma.job.create({
    data: {
      queueId: defaultQueue.id,
      type: JobType.IMMEDIATE,
      status: JobStatus.COMPLETED,
      payload: { step: 'A: extract-data' },
      priority: 2,
      runAt: new Date(),
      attemptCount: 1
    }
  });

  const jobChildClaimable = await prisma.job.create({
    data: {
      id: 'child-claimable-id',
      queueId: defaultQueue.id,
      type: JobType.IMMEDIATE,
      status: JobStatus.QUEUED,
      payload: { step: 'B: transform-data' },
      priority: 2,
      runAt: new Date()
    }
  });

  await prisma.jobDependency.create({
    data: {
      parentJobId: jobParent.id,
      childJobId: jobChildClaimable.id
    }
  });

  // Job C is blocked because its parent is NOT completed
  const jobParentUnfinished = await prisma.job.create({
    data: {
      queueId: defaultQueue.id,
      type: JobType.IMMEDIATE,
      status: JobStatus.QUEUED,
      payload: { step: 'C: long-pre-processing-task' },
      priority: 1,
      runAt: new Date()
    }
  });

  const jobChildBlocked = await prisma.job.create({
    data: {
      queueId: defaultQueue.id,
      type: JobType.IMMEDIATE,
      status: JobStatus.QUEUED,
      payload: { step: 'D: load-data-warehouse' },
      priority: 1,
      runAt: new Date()
    }
  });

  await prisma.jobDependency.create({
    data: {
      parentJobId: jobParentUnfinished.id,
      childJobId: jobChildBlocked.id
    }
  });

  console.log('[Seed] Seeding completed successfully.');
  console.log('[Seed] Admin Credentials: admin@acme.com / admin123');
}

main()
  .catch((e) => {
    console.error('[Seed] Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
