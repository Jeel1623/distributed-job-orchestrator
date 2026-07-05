import { RetryStrategy } from '@prisma/client';

export function calculateNextRunAt(
  strategy: RetryStrategy,
  baseDelayMs: number,
  maxDelayMs: number,
  attemptCount: number
): Date {
  let delay = baseDelayMs;
  
  if (strategy === RetryStrategy.LINEAR) {
    delay = baseDelayMs * attemptCount;
  } else if (strategy === RetryStrategy.EXPONENTIAL) {
    // attemptCount is 1-indexed for the attempt that just failed
    delay = baseDelayMs * Math.pow(2, attemptCount - 1);
  }
  
  if (delay > maxDelayMs) {
    delay = maxDelayMs;
  }
  
  return new Date(Date.now() + delay);
}
