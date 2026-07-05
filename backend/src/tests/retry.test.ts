import { describe, it, expect } from 'vitest';
import { calculateNextRunAt } from '../services/retry';
import { RetryStrategy } from '@prisma/client';

describe('Retry Policy Backoff Calculations', () => {
  it('should calculate FIXED retry delay correctly', () => {
    const baseDelayMs = 2000;
    const maxDelayMs = 5000;
    
    // Fixed delay is always baseDelayMs, regardless of attempt count
    const runAt1 = calculateNextRunAt(RetryStrategy.FIXED, baseDelayMs, maxDelayMs, 1);
    const runAt2 = calculateNextRunAt(RetryStrategy.FIXED, baseDelayMs, maxDelayMs, 2);
    
    const diff1 = runAt1.getTime() - Date.now();
    const diff2 = runAt2.getTime() - Date.now();
    
    // Allow small margin of time skew
    expect(diff1).toBeLessThanOrEqual(baseDelayMs);
    expect(diff1).toBeGreaterThan(baseDelayMs - 100);
    
    expect(diff2).toBeLessThanOrEqual(baseDelayMs);
    expect(diff2).toBeGreaterThan(baseDelayMs - 100);
  });

  it('should calculate LINEAR retry delay correctly', () => {
    const baseDelayMs = 1500;
    const maxDelayMs = 10000;
    
    // Linear delay: baseDelayMs * attemptCount
    const runAt1 = calculateNextRunAt(RetryStrategy.LINEAR, baseDelayMs, maxDelayMs, 1); // 1500ms
    const runAt2 = calculateNextRunAt(RetryStrategy.LINEAR, baseDelayMs, maxDelayMs, 3); // 4500ms
    
    const diff1 = runAt1.getTime() - Date.now();
    const diff2 = runAt2.getTime() - Date.now();
    
    expect(diff1).toBeLessThanOrEqual(1500);
    expect(diff1).toBeGreaterThan(1500 - 100);
    
    expect(diff2).toBeLessThanOrEqual(4500);
    expect(diff2).toBeGreaterThan(4500 - 100);
  });

  it('should calculate EXPONENTIAL retry delay correctly and respect max cap', () => {
    const baseDelayMs = 1000;
    const maxDelayMs = 5000;
    
    // Exponential delay: baseDelayMs * 2^(attemptCount - 1)
    const runAt1 = calculateNextRunAt(RetryStrategy.EXPONENTIAL, baseDelayMs, maxDelayMs, 1); // 1000ms
    const runAt2 = calculateNextRunAt(RetryStrategy.EXPONENTIAL, baseDelayMs, maxDelayMs, 3); // 4000ms
    const runAt3 = calculateNextRunAt(RetryStrategy.EXPONENTIAL, baseDelayMs, maxDelayMs, 4); // 8000ms -> capped at 5000ms
    
    const diff1 = runAt1.getTime() - Date.now();
    const diff2 = runAt2.getTime() - Date.now();
    const diff3 = runAt3.getTime() - Date.now();
    
    expect(diff1).toBeLessThanOrEqual(1000);
    expect(diff1).toBeGreaterThan(900);
    
    expect(diff2).toBeLessThanOrEqual(4000);
    expect(diff2).toBeGreaterThan(3900);
    
    expect(diff3).toBeLessThanOrEqual(maxDelayMs);
    expect(diff3).toBeGreaterThan(maxDelayMs - 100);
  });
});
