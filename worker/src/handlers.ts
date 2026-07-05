import { JobLog, Prisma } from '@prisma/client';

export interface JobExecutionCtx {
  jobId: string;
  executionId: string;
  attemptCount: number;
  idempotencyKey: string | null;
  log: (level: string, message: string) => Promise<void>;
}

export async function executeHttpJob(payload: any, ctx: JobExecutionCtx): Promise<any> {
  const url = payload?.url;
  const method = payload?.method || 'GET';
  const headers = payload?.headers || {};
  const body = payload?.body;

  if (!url) {
    throw new Error('Missing required payload parameter: "url"');
  }

  await ctx.log('info', `Initiating HTTP ${method} request to ${url}`);

  const options: RequestInit = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...headers
    }
  };

  if (body && ['POST', 'PUT', 'PATCH'].includes(method)) {
    options.body = typeof body === 'string' ? body : JSON.stringify(body);
  }

  const startTime = Date.now();
  const response = await fetch(url, options);
  const duration = Date.now() - startTime;

  await ctx.log('info', `HTTP response status: ${response.status} (duration: ${duration}ms)`);

  const responseText = await response.text();
  let responseData;
  try {
    responseData = JSON.parse(responseText);
  } catch (e) {
    responseData = responseText;
  }

  if (!response.ok) {
    throw new Error(`HTTP Request failed with status ${response.status}: ${responseText.substring(0, 200)}`);
  }

  return responseData;
}

export async function executeDataProcessingJob(payload: any, ctx: JobExecutionCtx): Promise<any> {
  await ctx.log('info', 'Starting data processing task...');
  
  if (ctx.idempotencyKey) {
    await ctx.log('info', `Checking idempotency key: "${ctx.idempotencyKey}". Result: Processing required.`);
  }

  const items = payload?.items || [];
  const operation = payload?.operation || 'sum';

  await ctx.log('info', `Processing ${items.length} items using operation: "${operation}"`);

  // Simulate processing time
  await new Promise(resolve => setTimeout(resolve, 1000));

  if (operation === 'sum') {
    const sum = items.reduce((acc: number, val: any) => acc + (Number(val) || 0), 0);
    await ctx.log('info', `Calculation completed. Sum result: ${sum}`);
    return { result: sum };
  } else if (operation === 'multiply') {
    const product = items.reduce((acc: number, val: any) => acc * (Number(val) || 0), 1);
    await ctx.log('info', `Calculation completed. Product result: ${product}`);
    return { result: product };
  } else if (operation === 'error') {
    throw new Error('Data processing simulated calculations failure.');
  }

  return { result: 'unknown_operation' };
}

export async function executeFlakyJob(payload: any, ctx: JobExecutionCtx): Promise<any> {
  const failureRate = payload?.failureRate !== undefined ? Number(payload.failureRate) : 0.7;
  await ctx.log('info', `Executing flaky job. Configured failure rate: ${failureRate * 100}%`);

  // Simulate execution time
  await new Promise(resolve => setTimeout(resolve, 800));

  const roll = Math.random();
  if (roll < failureRate) {
    await ctx.log('error', `Flaky roll failed: ${roll.toFixed(2)} &lt; ${failureRate.toFixed(2)}`);
    throw new Error(`Flaky execution failed randomly (roll: ${roll.toFixed(2)} < threshold: ${failureRate.toFixed(2)})`);
  }

  await ctx.log('info', `Flaky roll succeeded: ${roll.toFixed(2)} &gt;= ${failureRate.toFixed(2)}`);
  return { success: true, roll: roll.toFixed(2) };
}
