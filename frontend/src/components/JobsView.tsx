import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  X, AlertCircle, RefreshCw, Terminal, Clock, Link as LinkIcon, Plus
} from 'lucide-react';
import api from '../api';

interface Queue {
  id: string;
  name: string;
}

interface Job {
  id: string;
  queueId: string;
  type: string;
  status: string;
  payload: any;
  priority: number;
  runAt: string;
  cronExpression: string | null;
  batchId: string | null;
  attemptCount: number;
  maxAttempts: number;
  idempotencyKey: string | null;
  createdAt: string;
  queue: Queue;
}

interface JobExecution {
  id: string;
  workerId: string;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  errorMessage: string | null;
  stackTrace: string | null;
  durationMs: number | null;
}

interface JobLog {
  id: string;
  level: string;
  message: string;
  timestamp: string;
}

interface Dependency {
  parentJobId: string;
  parentJob: Job;
}

interface JobDetail extends Job {
  executions: JobExecution[];
  logs: JobLog[];
  dependencies: Dependency[];
}

interface PaginatedJobsResponse {
  jobs: Job[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export const JobsView: React.FC = () => {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState('');
  const [queueFilter, setQueueFilter] = useState('');
  const [batchFilter, setBatchFilter] = useState('');
  
  // Submit Job modal states
  const [isSubmitOpen, setIsSubmitOpen] = useState(false);
  const [submitType, setSubmitType] = useState<'IMMEDIATE' | 'DELAYED' | 'BATCH' | 'RECURRING'>('IMMEDIATE');
  const [selectedQueueId, setSelectedQueueId] = useState('');
  const [jobPayload, setJobPayload] = useState('{\n  "url": "https://httpbin.org/delay/1",\n  "method": "GET"\n}');
  const [jobPriority, setJobPriority] = useState(1);
  const [delayMinutes, setDelayMinutes] = useState(1);
  const [cronExpr, setCronExpr] = useState('*/30 * * * * *');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [dependsOnIdsString, setDependsOnIdsString] = useState('');
  const [recurringName, setRecurringName] = useState('Demo Cron Task');
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Detail Modal states
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  // Queries
  const { data: queues } = useQuery<Queue[]>({
    queryKey: ['queuesShort'],
    queryFn: () => api.get('/queues')
  });

  const { data: response, isLoading: jobsLoading, refetch: refetchJobs } = useQuery<PaginatedJobsResponse>({
    queryKey: ['jobs', page, statusFilter, queueFilter, batchFilter],
    queryFn: () => {
      let query = `/jobs?page=${page}&limit=15`;
      if (statusFilter) query += `&status=${statusFilter}`;
      if (queueFilter) query += `&queueId=${queueFilter}`;
      if (batchFilter) query += `&batchId=${batchFilter}`;
      return api.get(query);
    },
    refetchInterval: 3000 // Refetch every 3 seconds for live dashboard feel
  });

  const { data: jobDetail, refetch: refetchJobDetail } = useQuery<JobDetail>({
    queryKey: ['jobDetail', selectedJobId],
    queryFn: () => api.get(`/jobs/${selectedJobId}`),
    enabled: !!selectedJobId,
    refetchInterval: 2000 // Fast polling for log viewer when open
  });

  // Mutations
  const cancelJobMutation = useMutation({
    mutationFn: (id: string) => api.post(`/jobs/${id}/cancel`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      if (selectedJobId) refetchJobDetail();
    }
  });

  const retryJobMutation = useMutation({
    mutationFn: (id: string) => api.post(`/jobs/${id}/retry`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      if (selectedJobId) refetchJobDetail();
    }
  });

  const createJobMutation = useMutation({
    mutationFn: (payload: any) => {
      if (submitType === 'BATCH') {
        return api.post('/jobs/batch', payload);
      } else if (submitType === 'RECURRING') {
        return api.post('/jobs/recurring', payload);
      }
      return api.post('/jobs', payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      queryClient.invalidateQueries({ queryKey: ['metricsSummary'] });
      setIsSubmitOpen(false);
      resetSubmitForm();
    },
    onError: (err: any) => {
      setSubmitError(err.message || 'Failed to submit job');
    }
  });

  const resetSubmitForm = () => {
    setSelectedQueueId(queues?.[0]?.id || '');
    setJobPayload('{\n  "url": "https://httpbin.org/delay/1",\n  "method": "GET"\n}');
    setJobPriority(1);
    setDelayMinutes(1);
    setCronExpr('*/30 * * * * *');
    setIdempotencyKey('');
    setDependsOnIdsString('');
    setRecurringName('Demo Cron Task');
    setSubmitError(null);
  };

  const handleJobSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    let parsedPayload = {};
    try {
      parsedPayload = JSON.parse(jobPayload);
    } catch (err) {
      setSubmitError('Invalid JSON payload');
      return;
    }

    if (!selectedQueueId) {
      setSubmitError('Please select a queue');
      return;
    }

    const dependsOnJobIds = dependsOnIdsString
      ? dependsOnIdsString.split(',').map(s => s.trim()).filter(Boolean)
      : undefined;

    if (submitType === 'BATCH') {
      // Create a batch of 3 similar jobs with different parameters
      const batchPayload = {
        queueId: selectedQueueId,
        jobs: [
          { payload: { ...parsedPayload, taskNo: 1 }, priority: jobPriority },
          { payload: { ...parsedPayload, taskNo: 2 }, priority: jobPriority },
          { payload: { ...parsedPayload, taskNo: 3 }, priority: jobPriority }
        ]
      };
      createJobMutation.mutate(batchPayload);
    } else if (submitType === 'RECURRING') {
      createJobMutation.mutate({
        name: recurringName,
        cronExpression: cronExpr,
        queueId: selectedQueueId,
        payload: parsedPayload,
        priority: jobPriority
      });
    } else {
      // Immediate or Delayed
      let runAt: string | undefined = undefined;
      if (submitType === 'DELAYED') {
        const d = new Date();
        d.setMinutes(d.getMinutes() + delayMinutes);
        runAt = d.toISOString();
      }

      createJobMutation.mutate({
        queueId: selectedQueueId,
        payload: parsedPayload,
        priority: jobPriority,
        runAt,
        idempotencyKey: idempotencyKey || undefined,
        dependsOnJobIds
      });
    }
  };

  const handleJobClick = (jobId: string) => {
    setSelectedJobId(jobId);
    setIsDetailOpen(true);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'QUEUED':
        return 'bg-blue-500/10 text-blue-400 border border-blue-500/20';
      case 'SCHEDULED':
        return 'bg-purple-500/10 text-purple-400 border border-purple-500/20';
      case 'CLAIMED':
      case 'RUNNING':
        return 'bg-accentOrange/10 text-accentOrange border border-accentOrange/20 animate-pulse';
      case 'COMPLETED':
        return 'bg-accentGreen/10 text-accentGreen border border-accentGreen/20';
      case 'FAILED':
        return 'bg-accentRed/10 text-accentRed border border-accentRed/20';
      case 'DEAD_LETTER':
        return 'bg-red-600/20 text-red-500 border border-red-500/30';
      default:
        return 'bg-slate-800 text-slate-400 border border-slate-700';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-wide">Job Explorer</h1>
          <p className="text-sm text-slate-400">Monitor active executions, view job payload properties, and track debug traces.</p>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => refetchJobs()}
            className="p-2 text-slate-400 hover:text-white bg-slate-800 rounded-lg hover:bg-slate-700 transition"
          >
            <RefreshCw className="h-5 w-5" />
          </button>
          <button 
            onClick={() => { resetSubmitForm(); setIsSubmitOpen(true); }}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-accentBlue rounded-lg hover:bg-blue-600 transition"
          >
            <Plus className="h-4 w-4" /> Submit Job
          </button>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="glassmorphism p-4 rounded-xl grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Filter by Status</label>
          <select 
            value={statusFilter} 
            onChange={e => { setStatusFilter(e.target.value); setPage(1); }}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-white text-xs focus:outline-none focus:border-accentBlue"
          >
            <option value="">All Statuses</option>
            <option value="QUEUED">QUEUED</option>
            <option value="SCHEDULED">SCHEDULED</option>
            <option value="CLAIMED">CLAIMED</option>
            <option value="RUNNING">RUNNING</option>
            <option value="COMPLETED">COMPLETED</option>
            <option value="FAILED">FAILED</option>
            <option value="DEAD_LETTER">DEAD LETTER</option>
          </select>
        </div>

        <div>
          <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Filter by Queue</label>
          <select 
            value={queueFilter} 
            onChange={e => { setQueueFilter(e.target.value); setPage(1); }}
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-white text-xs focus:outline-none focus:border-accentBlue"
          >
            <option value="">All Queues</option>
            {queues?.map(q => (
              <option key={q.id} value={q.id}>{q.name}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Search Batch ID</label>
          <input 
            type="text" 
            value={batchFilter} 
            onChange={e => { setBatchFilter(e.target.value); setPage(1); }}
            placeholder="uuid string"
            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-1.5 text-white text-xs placeholder-slate-600 focus:outline-none focus:border-accentBlue"
          />
        </div>

        <div className="flex items-end justify-end">
          <button 
            onClick={() => { setStatusFilter(''); setQueueFilter(''); setBatchFilter(''); setPage(1); }}
            className="text-xs text-slate-400 hover:text-white underline cursor-pointer"
          >
            Clear All Filters
          </button>
        </div>
      </div>

      {/* Jobs Table */}
      {jobsLoading ? (
        <div className="flex justify-center items-center py-20">
          <RefreshCw className="h-8 w-8 text-accentBlue animate-spin" />
        </div>
      ) : (
        <div className="glassmorphism rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-900/50 text-slate-400 text-xs font-semibold uppercase tracking-wider border-b border-slate-800">
                  <th className="px-6 py-4">Job ID</th>
                  <th className="px-6 py-4">Queue</th>
                  <th className="px-6 py-4">Type</th>
                  <th className="px-6 py-4">Attempts</th>
                  <th className="px-6 py-4">Submitted At</th>
                  <th className="px-6 py-4">Target Run</th>
                  <th className="px-6 py-4 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50 text-sm text-slate-300">
                {response?.jobs.map((job) => (
                  <tr 
                    key={job.id} 
                    onClick={() => handleJobClick(job.id)}
                    className="hover:bg-slate-800/20 transition duration-150 cursor-pointer"
                  >
                    <td className="px-6 py-4 font-mono text-xs text-slate-400 font-semibold">{job.id.substring(0, 8)}...</td>
                    <td className="px-6 py-4 text-white font-semibold">{job.queue?.name}</td>
                    <td className="px-6 py-4">
                      <span className="px-2 py-0.5 rounded text-xs font-semibold bg-slate-800 text-slate-300">
                        {job.type}
                      </span>
                    </td>
                    <td className="px-6 py-4 font-mono text-center">
                      {job.attemptCount} / {job.maxAttempts}
                    </td>
                    <td className="px-6 py-4 text-slate-400 text-xs">
                      {new Date(job.createdAt).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-slate-400 text-xs">
                      {new Date(job.runAt).toLocaleString()}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold ${getStatusBadge(job.status)}`}>
                        {job.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {(!response || response.jobs.length === 0) && (
                  <tr>
                    <td colSpan={7} className="px-6 py-10 text-center text-slate-500">
                      No jobs match selected filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {response && response.pagination.totalPages > 1 && (
            <div className="bg-slate-900/30 px-6 py-4 border-t border-slate-800 flex justify-between items-center">
              <span className="text-xs text-slate-400">
                Showing page {page} of {response.pagination.totalPages} ({response.pagination.total} total jobs)
              </span>
              <div className="flex gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded transition disabled:opacity-40"
                >
                  Previous
                </button>
                <button
                  disabled={page >= response.pagination.totalPages}
                  onClick={() => setPage(page + 1)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs rounded transition disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 1. Job Details Modal (Timeline, Logs, Actions) */}
      {isDetailOpen && jobDetail && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-end p-0">
          <div className="bg-darkCard border-l border-darkBorder w-full max-w-2xl h-full flex flex-col justify-between shadow-2xl animate-slide-in">
            {/* Modal Header */}
            <div className="p-5 border-b border-darkBorder flex justify-between items-center">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  Job details <span className="font-mono text-xs font-normal text-slate-500">({jobDetail.id})</span>
                </h3>
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold mt-1 ${getStatusBadge(jobDetail.status)}`}>
                  {jobDetail.status}
                </span>
              </div>
              <button onClick={() => setIsDetailOpen(false)} className="text-slate-400 hover:text-white">
                <X className="h-6 w-6" />
              </button>
            </div>

            {/* Modal Scroll Content */}
            <div className="flex-1 overflow-y-auto p-5 space-y-6">
              {/* Properties Grid */}
              <div className="grid grid-cols-2 gap-4 text-xs glassmorphism p-4 rounded-xl">
                <div>
                  <span className="text-slate-400 uppercase tracking-wider block">Queue</span>
                  <span className="text-white font-semibold text-sm mt-0.5 inline-block">{jobDetail.queue?.name}</span>
                </div>
                <div>
                  <span className="text-slate-400 uppercase tracking-wider block">Job Type</span>
                  <span className="text-white font-semibold text-sm mt-0.5 inline-block">{jobDetail.type}</span>
                </div>
                <div>
                  <span className="text-slate-400 uppercase tracking-wider block">Priority</span>
                  <span className="text-white font-semibold text-sm mt-0.5 inline-block">{jobDetail.priority}</span>
                </div>
                <div>
                  <span className="text-slate-400 uppercase tracking-wider block">Attempts</span>
                  <span className="text-white font-semibold text-sm mt-0.5 inline-block font-mono">{jobDetail.attemptCount} / {jobDetail.maxAttempts}</span>
                </div>
                {jobDetail.idempotencyKey && (
                  <div className="col-span-2 border-t border-slate-800/40 pt-2">
                    <span className="text-slate-400 uppercase tracking-wider block">Idempotency Key</span>
                    <span className="text-slate-300 font-mono text-xs mt-0.5 inline-block">{jobDetail.idempotencyKey}</span>
                  </div>
                )}
                {jobDetail.batchId && (
                  <div className="col-span-2 border-t border-slate-800/40 pt-2">
                    <span className="text-slate-400 uppercase tracking-wider block">Batch Group ID</span>
                    <span className="text-slate-300 font-mono text-xs mt-0.5 inline-block">{jobDetail.batchId}</span>
                  </div>
                )}
              </div>

              {/* DAG Dependencies */}
              {jobDetail.dependencies.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-sm font-bold text-white flex items-center gap-1">
                    <LinkIcon className="h-4 w-4 text-slate-400" /> Parent Dependencies (DAG)
                  </h4>
                  <div className="space-y-1">
                    {jobDetail.dependencies.map(dep => (
                      <div key={dep.parentJobId} className="flex justify-between items-center text-xs p-2 bg-slate-900/60 rounded border border-slate-800">
                        <span className="font-mono text-slate-400">{dep.parentJobId.substring(0, 15)}...</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${getStatusBadge(dep.parentJob.status)}`}>
                          {dep.parentJob.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Execution History attempts */}
              <div className="space-y-3">
                <h4 className="text-sm font-bold text-white flex items-center gap-1">
                  <Clock className="h-4 w-4 text-slate-400" /> Execution Attempts ({jobDetail.executions.length})
                </h4>
                {jobDetail.executions.length === 0 ? (
                  <p className="text-xs text-slate-500 italic">No executions started yet.</p>
                ) : (
                  <div className="space-y-2">
                    {jobDetail.executions.map((exec, idx) => (
                      <div key={exec.id} className="p-3 bg-slate-950/60 rounded-lg border border-slate-800/60 text-xs space-y-2">
                        <div className="flex justify-between items-center font-semibold">
                          <span className="text-slate-300">Attempt #{jobDetail.executions.length - idx}</span>
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${getStatusBadge(exec.status)}`}>
                            {exec.status}
                          </span>
                        </div>
                        <div className="grid grid-cols-2 gap-y-1 text-slate-400">
                          <div>Worker: <span className="text-white font-mono">{exec.workerId}</span></div>
                          <div>Duration: <span className="text-white font-mono">{exec.durationMs ? `${exec.durationMs}ms` : 'In flight'}</span></div>
                          <div className="col-span-2">Started: {new Date(exec.startedAt).toLocaleString()}</div>
                          {exec.finishedAt && <div className="col-span-2">Finished: {new Date(exec.finishedAt).toLocaleString()}</div>}
                        </div>
                        {exec.errorMessage && (
                          <div className="mt-2 p-2 bg-accentRed/5 border border-accentRed/10 rounded text-accentRed overflow-x-auto font-mono text-[11px]">
                            <strong className="block text-[10px] uppercase tracking-wide">Error:</strong>
                            {exec.errorMessage}
                            {exec.stackTrace && (
                              <pre className="mt-1 text-[10px] text-slate-500 overflow-x-auto max-h-[120px] scrollbar-thin">
                                {exec.stackTrace}
                              </pre>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Logs Monospace */}
              <div className="space-y-2">
                <h4 className="text-sm font-bold text-white flex items-center gap-1">
                  <Terminal className="h-4 w-4 text-slate-400" /> Logs Console
                </h4>
                <div className="bg-black/80 rounded-lg p-4 font-mono text-[11px] overflow-y-auto max-h-[220px] border border-slate-800 flex flex-col space-y-1.5 text-slate-300 scrollbar-thin">
                  {jobDetail.logs.length === 0 ? (
                    <span className="text-slate-600 italic">No logs recorded.</span>
                  ) : (
                    jobDetail.logs.map(log => {
                      let levelColor = 'text-slate-400';
                      if (log.level === 'error') levelColor = 'text-accentRed font-semibold';
                      if (log.level === 'warn') levelColor = 'text-accentOrange font-semibold';
                      
                      return (
                        <div key={log.id} className="leading-relaxed hover:bg-slate-900/40 p-0.5 rounded">
                          <span className="text-slate-500 mr-2">[{new Date(log.timestamp).toLocaleTimeString()}]</span>
                          <span className={`${levelColor} mr-2 uppercase text-[9px] border border-slate-800 px-1 py-0.2 rounded`}>{log.level}</span>
                          <span>{log.message}</span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="p-5 border-t border-darkBorder bg-slate-950/40 flex justify-end gap-2">
              <button 
                onClick={() => setIsDetailOpen(false)}
                className="px-4 py-2 text-sm font-semibold text-slate-400 hover:text-white"
              >
                Close
              </button>

              {(jobDetail.status === 'QUEUED' || jobDetail.status === 'SCHEDULED') && (
                <button 
                  onClick={() => {
                    if (confirm('Cancel this job?')) {
                      cancelJobMutation.mutate(jobDetail.id);
                    }
                  }}
                  disabled={cancelJobMutation.isPending}
                  className="px-4 py-2 text-sm font-semibold text-white bg-accentRed hover:bg-red-600 rounded-lg transition disabled:opacity-50"
                >
                  Cancel Job
                </button>
              )}

              {(jobDetail.status === 'FAILED' || jobDetail.status === 'DEAD_LETTER') && (
                <button 
                  onClick={() => retryJobMutation.mutate(jobDetail.id)}
                  disabled={retryJobMutation.isPending}
                  className="px-4 py-2 text-sm font-semibold text-white bg-accentBlue hover:bg-blue-600 rounded-lg transition disabled:opacity-50"
                >
                  Retry Job
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 2. Submit Job Modal */}
      {isSubmitOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-center items-center p-4">
          <div className="bg-darkCard border border-darkBorder w-full max-w-lg rounded-xl overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-darkBorder flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">Submit New Workload</h3>
              <button onClick={() => setIsSubmitOpen(false)} className="text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleJobSubmit} className="p-5 space-y-4">
              {submitError && (
                <div className="p-3 bg-accentRed/10 text-accentRed text-xs rounded-lg flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" /> {submitError}
                </div>
              )}

              {/* Submit Type Selector */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Workload Execution Profile</label>
                <div className="grid grid-cols-4 gap-2">
                  {(['IMMEDIATE', 'DELAYED', 'BATCH', 'RECURRING'] as const).map(type => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setSubmitType(type)}
                      className={`py-2 text-xs font-bold rounded-lg border transition ${
                        submitType === type 
                          ? 'bg-accentBlue/10 text-accentBlue border-accentBlue/40' 
                          : 'bg-slate-900 text-slate-400 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              {/* Target Queue */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1 font-semibold text-white">Target Queue</label>
                <select 
                  value={selectedQueueId} 
                  onChange={e => setSelectedQueueId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accentBlue"
                >
                  <option value="">Select a target queue...</option>
                  {queues?.map(q => (
                    <option key={q.id} value={q.id}>{q.name}</option>
                  ))}
                </select>
              </div>

              {/* Delayed Configuration */}
              {submitType === 'DELAYED' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Execution Delay (Minutes)</label>
                  <input 
                    type="number" 
                    value={delayMinutes} 
                    onChange={e => setDelayMinutes(Number(e.target.value))}
                    min={1}
                    max={60}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accentBlue"
                  />
                </div>
              )}

              {/* Recurring/Cron Configuration */}
              {submitType === 'RECURRING' && (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Schedule Name</label>
                    <input 
                      type="text" 
                      value={recurringName} 
                      onChange={e => setRecurringName(e.target.value)}
                      placeholder="Daily checkup"
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accentBlue"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Cron Expression</label>
                    <input 
                      type="text" 
                      value={cronExpr} 
                      onChange={e => setCronExpr(e.target.value)}
                      placeholder="*/30 * * * * *"
                      className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accentBlue"
                    />
                  </div>
                </div>
              )}

              {/* Priority & Idempotency */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Job Priority</label>
                  <input 
                    type="number" 
                    value={jobPriority} 
                    onChange={e => setJobPriority(Number(e.target.value))}
                    min={1}
                    max={100}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accentBlue"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Idempotency Key (Optional)</label>
                  <input 
                    type="text" 
                    value={idempotencyKey} 
                    onChange={e => setIdempotencyKey(e.target.value)}
                    placeholder="e.g. stripe-charge-44"
                    disabled={submitType === 'BATCH' || submitType === 'RECURRING'}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accentBlue disabled:opacity-40"
                  />
                </div>
              </div>

              {/* Depends On (DAG) */}
              {submitType === 'IMMEDIATE' && (
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Depends On Job IDs (Comma separated, optional)</label>
                  <input 
                    type="text" 
                    value={dependsOnIdsString} 
                    onChange={e => setDependsOnIdsString(e.target.value)}
                    placeholder="uuid-1, uuid-2"
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accentBlue"
                  />
                </div>
              )}

              {/* JSON Payload Editor */}
              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Job Payload (JSON)</label>
                <textarea 
                  value={jobPayload} 
                  onChange={e => setJobPayload(e.target.value)} 
                  rows={4}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-white font-mono text-xs focus:outline-none focus:border-accentBlue"
                />
                <span className="text-[10px] text-slate-500 mt-1 block">
                  Tip: Provide <code>url</code> for HTTP jobs, <code>items</code>/<code>operation</code> for math computation, or <code>flaky: true</code> to test retries.
                </span>
              </div>

              {/* Modal Submit Footer */}
              <div className="pt-4 border-t border-darkBorder flex justify-end gap-2">
                <button 
                  type="button" 
                  onClick={() => setIsSubmitOpen(false)}
                  className="px-4 py-2 text-sm font-semibold text-slate-300 hover:text-white"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={createJobMutation.isPending}
                  className="px-4 py-2 text-sm font-semibold text-white bg-accentBlue rounded-lg hover:bg-blue-600 transition disabled:opacity-50"
                >
                  {createJobMutation.isPending ? 'Submitting...' : 'Queue Job'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default JobsView;
