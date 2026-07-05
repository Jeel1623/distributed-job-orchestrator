import { Router } from 'express';
import { validate } from './middleware/validate';
import { authenticateJWT, requireRole } from './middleware/auth';
import { Role } from '@prisma/client';

import * as authController from './controllers/auth';
import * as projectsController from './controllers/projects';
import * as queuesController from './controllers/queues';
import * as jobsController from './controllers/jobs';
import * as systemController from './controllers/system';

const router = Router();

// ==========================================
// 1. AUTH ROUTES
// ==========================================
router.post('/auth/register', validate(authController.RegisterSchema), authController.register);
router.post('/auth/login', validate(authController.LoginSchema), authController.login);
router.post('/auth/refresh', validate(authController.RefreshSchema), authController.refresh);
router.get('/auth/me', authenticateJWT, authController.me);

// ==========================================
// 2. PROJECT & ORG ROUTES
// ==========================================
router.get('/projects', authenticateJWT, projectsController.listProjects);
router.get('/projects/:id', authenticateJWT, projectsController.getProject);
router.post('/projects', authenticateJWT, validate(projectsController.CreateProjectSchema), projectsController.createProject);
router.put('/projects/:id', authenticateJWT, validate(projectsController.UpdateProjectSchema), projectsController.updateProject);
router.delete('/projects/:id', authenticateJWT, projectsController.deleteProject);

router.get('/organization', authenticateJWT, systemController.getWorker); // dummy path or resolved below
router.get('/org', authenticateJWT, projectsController.getOrganization);
router.put('/org', authenticateJWT, validate(projectsController.UpdateOrgSchema), projectsController.updateOrganization);

// ==========================================
// 3. QUEUE ROUTES
// ==========================================
router.get('/queues', authenticateJWT, queuesController.listQueues);
router.get('/retry-policies', authenticateJWT, queuesController.listRetryPolicies);
router.get('/queues/:id', authenticateJWT, queuesController.getQueue);
router.post('/queues', authenticateJWT, validate(queuesController.CreateQueueSchema), queuesController.createQueue);
router.put('/queues/:id', authenticateJWT, validate(queuesController.UpdateQueueSchema), queuesController.updateQueue);
router.delete('/queues/:id', authenticateJWT, queuesController.deleteQueue);
router.post('/queues/:id/pause', authenticateJWT, queuesController.pauseQueue);
router.post('/queues/:id/resume', authenticateJWT, queuesController.resumeQueue);
router.get('/queues/:id/stats', authenticateJWT, queuesController.getQueueStats);

// ==========================================
// 4. JOB ROUTES
// ==========================================
router.post('/jobs', authenticateJWT, validate(jobsController.CreateJobSchema), jobsController.createJob);
router.post('/jobs/recurring', authenticateJWT, validate(jobsController.CreateRecurringJobSchema), jobsController.createRecurringJob);
router.post('/jobs/batch', authenticateJWT, validate(jobsController.CreateBatchSchema), jobsController.createBatch);
router.get('/jobs', authenticateJWT, jobsController.listJobs);
router.get('/jobs/:id', authenticateJWT, jobsController.getJob);
router.post('/jobs/:id/cancel', authenticateJWT, jobsController.cancelJob);
router.post('/jobs/:id/retry', authenticateJWT, jobsController.retryJob);

// ==========================================
// 5. WORKER ROUTES
// ==========================================
router.get('/workers', authenticateJWT, systemController.listWorkers);
router.get('/workers/:id', authenticateJWT, systemController.getWorker);

// ==========================================
// 6. DLQ ROUTES
// ==========================================
router.get('/dlq', authenticateJWT, systemController.listDLQ);
router.post('/dlq/retry-bulk', authenticateJWT, systemController.bulkRetryDLQ);
router.post('/dlq/:jobId/retry', authenticateJWT, systemController.retryDLQJob);
router.delete('/dlq/:jobId', authenticateJWT, systemController.deleteDLQJob);

// ==========================================
// 7. METRICS ROUTES
// ==========================================
router.get('/metrics/summary', authenticateJWT, systemController.getMetricsSummary);
router.get('/metrics/throughput', authenticateJWT, systemController.getThroughputMetrics);
router.get('/metrics/queues', authenticateJWT, systemController.getQueueBreakdown);

export default router;
