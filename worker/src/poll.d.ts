import { Job } from '@prisma/client';
export interface ClaimedJob {
    job: Job;
    executionId: string;
}
export declare function claimNextJob(workerId: string): Promise<ClaimedJob | null>;
export declare function finishJob(jobId: string, executionId: string, workerId: string, result: any): Promise<void>;
export declare function failJob(jobId: string, executionId: string, workerId: string, error: Error): Promise<void>;
