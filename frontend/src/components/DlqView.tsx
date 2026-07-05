import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  RefreshCw, Trash2, CheckSquare, Square, AlertOctagon, HelpCircle, Bot
} from 'lucide-react';
import api from '../api';

interface Job {
  id: string;
  type: string;
  payload: any;
  attemptCount: number;
  maxAttempts: number;
}

interface Queue {
  id: string;
  name: string;
}

interface DLQEntry {
  id: string;
  jobId: string;
  finalError: string | null;
  errorStack: string | null;
  movedAt: string;
  originalQueueId: string;
  payloadSnapshot: any;
  aiSummary: string | null;
  job: Job;
  queue: Queue;
}

interface DLQResponse {
  entries: DLQEntry[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export const DlqView: React.FC = () => {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  // Queries
  const { data: response, isLoading: dlqLoading, refetch: refetchDLQ } = useQuery<DLQResponse>({
    queryKey: ['dlq', page],
    queryFn: () => api.get(`/dlq?page=${page}&limit=10`),
    refetchInterval: 5000 // Poll every 5s to show updates
  });

  // Mutations
  const retryMutation = useMutation({
    mutationFn: (jobId: string) => api.post(`/dlq/${jobId}/retry`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dlq'] });
      queryClient.invalidateQueries({ queryKey: ['metricsSummary'] });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      setSelectedIds(prev => prev.filter(id => id !== id));
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (jobId: string) => api.delete(`/dlq/${jobId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dlq'] });
      queryClient.invalidateQueries({ queryKey: ['metricsSummary'] });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
    }
  });

  const bulkRetryMutation = useMutation({
    mutationFn: (jobIds: string[]) => api.post('/dlq/retry-bulk', { jobIds }),
    onSuccess: (data: any) => {
      alert(`Successfully retried ${data.retriedCount} jobs!`);
      queryClient.invalidateQueries({ queryKey: ['dlq'] });
      queryClient.invalidateQueries({ queryKey: ['metricsSummary'] });
      queryClient.invalidateQueries({ queryKey: ['jobs'] });
      setSelectedIds([]);
    },
    onError: (err: any) => {
      alert(err.message || 'Bulk retry failed');
    }
  });

  const handleSelectAll = () => {
    if (!response) return;
    if (selectedIds.length === response.entries.length) {
      setSelectedIds([]);
    } else {
      setSelectedIds(response.entries.map(e => e.jobId));
    }
  };

  const handleSelectOne = (jobId: string) => {
    setSelectedIds(prev => 
      prev.includes(jobId) 
        ? prev.filter(id => id !== jobId) 
        : [...prev, jobId]
    );
  };

  const handleBulkRetry = () => {
    if (selectedIds.length === 0) return;
    if (confirm(`Are you sure you want to retry all ${selectedIds.length} selected jobs?`)) {
      bulkRetryMutation.mutate(selectedIds);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-wide">Dead Letter Queue (DLQ)</h1>
          <p className="text-sm text-slate-400">Failed workloads that exceeded all configured retry attempts. Diagnose and replay from here.</p>
        </div>
        <div className="flex gap-2">
          {selectedIds.length > 0 && (
            <button
              onClick={handleBulkRetry}
              disabled={bulkRetryMutation.isPending}
              className="flex items-center gap-2 px-3 py-2 text-xs font-bold text-white bg-accentBlue rounded-lg hover:bg-blue-600 transition"
            >
              <RefreshCw className="h-3.5 w-3.5" /> Replay Selected ({selectedIds.length})
            </button>
          )}
          <button 
            onClick={() => refetchDLQ()}
            className="p-2 text-slate-400 hover:text-white bg-slate-800 rounded-lg hover:bg-slate-700 transition"
          >
            <RefreshCw className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Main List */}
      {dlqLoading ? (
        <div className="flex justify-center items-center py-20">
          <RefreshCw className="h-8 w-8 text-accentBlue animate-spin" />
        </div>
      ) : (
        <div className="space-y-4">
          {/* Action Header Table */}
          {response && response.entries.length > 0 && (
            <div className="flex items-center gap-4 px-4 py-2 bg-slate-900/40 border border-slate-800 rounded-lg text-xs text-slate-400">
              <button 
                onClick={handleSelectAll} 
                className="flex items-center gap-1 text-slate-300 hover:text-white"
              >
                {selectedIds.length === response.entries.length ? (
                  <CheckSquare className="h-4 w-4 text-accentBlue" />
                ) : (
                  <Square className="h-4 w-4" />
                )}
                Select All
              </button>
              <span>|</span>
              <span>{selectedIds.length} of {response.entries.length} items selected</span>
            </div>
          )}

          {/* List of DLQ Cards */}
          <div className="space-y-4">
            {response?.entries.map((entry) => (
              <div 
                key={entry.id} 
                className="glassmorphism rounded-xl border border-accentRed/20 overflow-hidden flex flex-col md:flex-row hover:border-accentRed/40 transition duration-200"
              >
                {/* Checkbox selector */}
                <div className="bg-slate-900/20 px-4 py-4 md:py-0 flex items-center justify-center border-r border-slate-800/40">
                  <button 
                    onClick={() => handleSelectOne(entry.jobId)}
                    className="text-slate-400 hover:text-white"
                  >
                    {selectedIds.includes(entry.jobId) ? (
                      <CheckSquare className="h-5 w-5 text-accentBlue" />
                    ) : (
                      <Square className="h-5 w-5" />
                    )}
                  </button>
                </div>

                {/* Content */}
                <div className="flex-1 p-5 space-y-4">
                  {/* Title Bar */}
                  <div className="flex justify-between items-start gap-4">
                    <div>
                      <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider block">Job ID: {entry.jobId}</span>
                      <h4 className="text-base font-bold text-white mt-1">
                        Queue: <span className="text-accentRed">{entry.queue?.name}</span>
                      </h4>
                    </div>
                    <span className="text-xs text-slate-500">
                      Moved At: {new Date(entry.movedAt).toLocaleString()}
                    </span>
                  </div>

                  {/* Errors & Diagnoses */}
                  <div className="space-y-3">
                    {/* Error Banner */}
                    <div className="p-3 bg-accentRed/5 border border-accentRed/10 rounded-lg text-xs font-mono text-accentRed flex items-start gap-2">
                      <AlertOctagon className="h-4 w-4 mt-0.5 flex-shrink-0" />
                      <div>
                        <strong>Final Error: </strong> {entry.finalError || 'Unknown runtime crash'}
                      </div>
                    </div>

                    {/* AI Diagnosis block */}
                    {entry.aiSummary && (
                      <div className="p-3.5 bg-accentBlue/5 border border-accentBlue/10 rounded-lg text-xs text-slate-300 space-y-1">
                        <div className="flex items-center gap-1.5 text-accentBlue font-bold uppercase tracking-wider text-[10px]">
                          <Bot className="h-4 w-4" /> AI Failure Diagnosis
                        </div>
                        <p className="leading-relaxed italic">{entry.aiSummary}</p>
                      </div>
                    )}
                  </div>

                  {/* Actions Bar */}
                  <div className="flex justify-end gap-2 pt-2 border-t border-slate-800/40">
                    <button
                      onClick={() => {
                        if (confirm('Permanently delete this failed job?')) {
                          deleteMutation.mutate(entry.jobId);
                        }
                      }}
                      disabled={deleteMutation.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-accentRed hover:bg-accentRed/10 border border-slate-800 hover:border-accentRed/20 transition"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Purge Job
                    </button>
                    <button
                      onClick={() => retryMutation.mutate(entry.jobId)}
                      disabled={retryMutation.isPending}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-accentBlue hover:bg-blue-600 transition"
                    >
                      <RefreshCw className="h-3.5 w-3.5" /> Replay Job
                    </button>
                  </div>
                </div>
              </div>
            ))}

            {(!response || response.entries.length === 0) && (
              <div className="text-center py-20 glassmorphism rounded-xl border border-slate-800 text-slate-500 flex flex-col items-center justify-center gap-2">
                <HelpCircle className="h-10 w-10 text-slate-600" />
                <span className="font-semibold text-slate-400">Dead Letter Queue is empty</span>
                <span className="text-xs text-slate-500">Jobs that fail max attempts will show up here.</span>
              </div>
            )}
          </div>

          {/* Pagination */}
          {response && response.pagination.totalPages > 1 && (
            <div className="bg-slate-900/30 px-6 py-4 border border-slate-800 rounded-xl flex justify-between items-center">
              <span className="text-xs text-slate-400">
                Showing page {page} of {response.pagination.totalPages} ({response.pagination.total} entries)
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
    </div>
  );
};

export default DlqView;
