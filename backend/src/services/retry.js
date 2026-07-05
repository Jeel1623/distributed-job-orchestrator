"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateNextRunAt = calculateNextRunAt;
const client_1 = require("@prisma/client");
function calculateNextRunAt(strategy, baseDelayMs, maxDelayMs, attemptCount) {
    let delay = baseDelayMs;
    if (strategy === client_1.RetryStrategy.LINEAR) {
        delay = baseDelayMs * attemptCount;
    }
    else if (strategy === client_1.RetryStrategy.EXPONENTIAL) {
        // attemptCount is 1-indexed for the attempt that just failed
        delay = baseDelayMs * Math.pow(2, attemptCount - 1);
    }
    if (delay > maxDelayMs) {
        delay = maxDelayMs;
    }
    return new Date(Date.now() + delay);
}
