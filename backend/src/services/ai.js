"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateFailureSummary = generateFailureSummary;
const db_1 = __importDefault(require("../db"));
async function generateFailureSummary(jobId) {
    try {
        const entry = await db_1.default.deadLetterEntry.findUnique({
            where: { jobId },
            include: {
                job: {
                    include: {
                        executions: {
                            orderBy: { startedAt: 'desc' },
                            take: 1
                        }
                    }
                }
            }
        });
        if (!entry)
            return null;
        const latestExec = entry.job.executions[0];
        const error = entry.finalError || latestExec?.errorMessage || 'Unknown error';
        const stackTrace = entry.errorStack || latestExec?.stackTrace || '';
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            // Graceful fallback: Simple rule-based explanation
            let summary = 'A generic failure occurred.';
            if (error.includes('timeout') || error.includes('Timeout')) {
                summary = 'Execution timed out. Verify network latency or increase execution limits.';
            }
            else if (error.includes('404') || error.includes('Not Found')) {
                summary = 'Target HTTP endpoint returned 404. Verify URL parameter validity.';
            }
            else if (error.includes('500') || error.includes('Internal Server Error')) {
                summary = 'Target server returned a 500 error, indicating an unhandled server-side exception.';
            }
            else if (error.includes('conn') || error.includes('dial')) {
                summary = 'Failed to connect to host. Network socket connection refused or host unreachable.';
            }
            else if (error.includes('idempotency') || error.includes('unique')) {
                summary = 'Idempotency constraint conflict. Duplicate job request detected.';
            }
            else {
                summary = `Failure due to error: "${error}". Review execution logs for stack trace details.`;
            }
            await db_1.default.deadLetterEntry.update({
                where: { jobId },
                data: { aiSummary: `[System Fallback] ${summary}` }
            });
            return summary;
        }
        // Call Gemini API
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [
                            {
                                text: `Analyze this background job failure. Provide a concise, professional 1-2 sentence root-cause summary and actionable fix. No markdown formatting, return plain text only.
                  
Job ID: ${jobId}
Error Message: ${error}
Stack Trace:
${stackTrace}`
                            }
                        ]
                    }
                ]
            })
        });
        if (!response.ok) {
            throw new Error(`Gemini API returned status ${response.status}`);
        }
        const data = (await response.json());
        const aiText = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
        if (aiText) {
            await db_1.default.deadLetterEntry.update({
                where: { jobId },
                data: { aiSummary: aiText }
            });
            return aiText;
        }
        return null;
    }
    catch (error) {
        console.error('[AI Summary] Error generating summary:', error.message);
        return null;
    }
}
exports.default = generateFailureSummary;
