import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Pause, Play, Settings, Plus, X, AlertCircle, RefreshCw, Trash2 
} from 'lucide-react';
import api from '../api';

interface Project {
  id: string;
  name: string;
}

interface RetryPolicy {
  id: string;
  name: string;
  strategy: string;
  baseDelayMs: number;
  maxRetries: number;
}

interface Queue {
  id: string;
  name: string;
  priority: number;
  maxConcurrency: number;
  isPaused: boolean;
  projectId: string;
  defaultRetryPolicyId: string | null;
  project: Project;
  defaultRetryPolicy: RetryPolicy | null;
}

export const QueuesView: React.FC = () => {
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selectedQueue, setSelectedQueue] = useState<Queue | null>(null);

  // Form states
  const [name, setName] = useState('');
  const [projectId, setProjectId] = useState('');
  const [priority, setPriority] = useState(1);
  const [maxConcurrency, setMaxConcurrency] = useState(5);
  const [retryPolicyId, setRetryPolicyId] = useState('');

  // Edit states
  const [editPriority, setEditPriority] = useState(1);
  const [editMaxConcurrency, setEditMaxConcurrency] = useState(5);
  const [editRetryPolicyId, setEditRetryPolicyId] = useState('');

  const [formError, setFormError] = useState<string | null>(null);

  // Queries
  const { data: queues, isLoading: queuesLoading, refetch: refetchQueues } = useQuery<Queue[]>({
    queryKey: ['queues'],
    queryFn: () => api.get('/queues')
  });

  const { data: projects } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => api.get('/projects')
  });

  const { data: retryPolicies } = useQuery<RetryPolicy[]>({
    queryKey: ['retryPolicies'],
    queryFn: () => api.get('/retry-policies')
  });

  // Mutations
  const togglePauseMutation = useMutation({
    mutationFn: ({ id, isPaused }: { id: string; isPaused: boolean }) => {
      const action = isPaused ? 'resume' : 'pause';
      return api.post(`/queues/${id}/${action}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queues'] });
      queryClient.invalidateQueries({ queryKey: ['metricsSummary'] });
      queryClient.invalidateQueries({ queryKey: ['metricsQueues'] });
    }
  });

  const createQueueMutation = useMutation({
    mutationFn: (newQueue: any) => api.post('/queues', newQueue),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queues'] });
      queryClient.invalidateQueries({ queryKey: ['metricsSummary'] });
      setIsCreateOpen(false);
      resetForm();
    },
    onError: (err: any) => {
      setFormError(err.message || 'Failed to create queue');
    }
  });

  const updateQueueMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => api.put(`/queues/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queues'] });
      setIsEditOpen(false);
    },
    onError: (err: any) => {
      setFormError(err.message || 'Failed to update queue');
    }
  });

  const deleteQueueMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/queues/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queues'] });
      queryClient.invalidateQueries({ queryKey: ['metricsSummary'] });
    },
    onError: (err: any) => {
      alert(err.message || 'Failed to delete queue');
    }
  });

  const resetForm = () => {
    setName('');
    setProjectId(projects?.[0]?.id || '');
    setPriority(1);
    setMaxConcurrency(5);
    setRetryPolicyId(retryPolicies?.[0]?.id || '');
    setFormError(null);
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !projectId) {
      setFormError('Name and Project are required');
      return;
    }
    createQueueMutation.mutate({
      name,
      projectId,
      priority: Number(priority),
      maxConcurrency: Number(maxConcurrency),
      defaultRetryPolicyId: retryPolicyId || undefined
    });
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedQueue) return;
    updateQueueMutation.mutate({
      id: selectedQueue.id,
      data: {
        priority: Number(editPriority),
        maxConcurrency: Number(editMaxConcurrency),
        defaultRetryPolicyId: editRetryPolicyId || null
      }
    });
  };

  const openEditModal = (queue: Queue) => {
    setSelectedQueue(queue);
    setEditPriority(queue.priority);
    setEditMaxConcurrency(queue.maxConcurrency);
    setEditRetryPolicyId(queue.defaultRetryPolicyId || '');
    setFormError(null);
    setIsEditOpen(true);
  };

  const handleDelete = (id: string, name: string) => {
    if (confirm(`Are you sure you want to delete the queue "${name}"?`)) {
      deleteQueueMutation.mutate(id);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-wide">Queue Manager</h1>
          <p className="text-sm text-slate-400">Configure queue priorities, concurrency thresholds, and active workloads.</p>
        </div>
        <div className="flex gap-2">
          <button 
            onClick={() => refetchQueues()}
            className="p-2 text-slate-400 hover:text-white bg-slate-800 rounded-lg hover:bg-slate-700 transition"
          >
            <RefreshCw className="h-5 w-5" />
          </button>
          <button 
            onClick={() => { resetForm(); setIsCreateOpen(true); }}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-accentBlue rounded-lg hover:bg-blue-600 transition"
          >
            <Plus className="h-4 w-4" /> Create Queue
          </button>
        </div>
      </div>

      {/* Grid List */}
      {queuesLoading ? (
        <div className="flex justify-center items-center py-20">
          <RefreshCw className="h-8 w-8 text-accentBlue animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {queues?.map((queue) => (
            <div 
              key={queue.id} 
              className={`glassmorphism rounded-xl overflow-hidden border ${queue.isPaused ? 'border-accentRed/30' : 'border-slate-800'} flex flex-col justify-between`}
            >
              <div className="p-5 space-y-4">
                {/* Title & Status */}
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-lg font-bold text-white">{queue.name}</h3>
                    <p className="text-xs text-slate-400 mt-0.5">Project: {queue.project?.name}</p>
                  </div>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${queue.isPaused ? 'bg-accentRed/10 text-accentRed border border-accentRed/20' : 'bg-accentGreen/10 text-accentGreen border border-accentGreen/20'}`}>
                    {queue.isPaused ? 'Paused' : 'Active'}
                  </span>
                </div>

                {/* Configurations */}
                <div className="grid grid-cols-2 gap-2 text-xs py-3 border-y border-slate-800/40">
                  <div>
                    <span className="text-slate-400 block uppercase tracking-wider">Priority</span>
                    <span className="text-white font-bold font-mono text-sm mt-0.5 inline-block">{queue.priority}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block uppercase tracking-wider">Concurrency</span>
                    <span className="text-white font-bold font-mono text-sm mt-0.5 inline-block">{queue.maxConcurrency} max</span>
                  </div>
                </div>

                {/* Retry Policy Info */}
                <div className="text-xs text-slate-400">
                  <span className="uppercase tracking-wider block text-[10px]">Retry Policy</span>
                  <span className="text-slate-200 mt-1 inline-block font-semibold">
                    {queue.defaultRetryPolicy 
                      ? `${queue.defaultRetryPolicy.name} (${queue.defaultRetryPolicy.strategy})` 
                      : 'None (Immediate fail)'}
                  </span>
                </div>
              </div>

              {/* Action Bar */}
              <div className="bg-slate-900/40 px-5 py-3 border-t border-slate-800/60 flex justify-between items-center">
                <button
                  onClick={() => togglePauseMutation.mutate({ id: queue.id, isPaused: queue.isPaused })}
                  disabled={togglePauseMutation.isPending}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    queue.isPaused 
                      ? 'bg-accentGreen/10 text-accentGreen hover:bg-accentGreen/20' 
                      : 'bg-accentRed/10 text-accentRed hover:bg-accentRed/20'
                  }`}
                >
                  {queue.isPaused ? (
                    <><Play className="h-3.5 w-3.5" /> Resume</>
                  ) : (
                    <><Pause className="h-3.5 w-3.5" /> Pause</>
                  )}
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={() => openEditModal(queue)}
                    className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded transition"
                  >
                    <Settings className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(queue.id, queue.name)}
                    className="p-1.5 text-slate-400 hover:text-accentRed hover:bg-slate-800 rounded transition"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          ))}

          {(!queues || queues.length === 0) && (
            <div className="col-span-full text-center py-20 text-slate-500">
              No queues defined yet. Click "Create Queue" to add one.
            </div>
          )}
        </div>
      )}

      {/* 1. Create Modal */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-center items-center p-4">
          <div className="bg-darkCard border border-darkBorder w-full max-w-md rounded-xl overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-darkBorder flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">Create New Queue</h3>
              <button onClick={() => setIsCreateOpen(false)} className="text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreateSubmit} className="p-5 space-y-4">
              {formError && (
                <div className="p-3 bg-accentRed/10 text-accentRed text-xs rounded-lg flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" /> {formError}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Queue Name</label>
                <input 
                  type="text" 
                  value={name} 
                  onChange={e => setName(e.target.value)} 
                  placeholder="e.g. email-delivery"
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-white placeholder-slate-500 text-sm focus:outline-none focus:border-accentBlue"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Project</label>
                <select 
                  value={projectId} 
                  onChange={e => setProjectId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accentBlue"
                >
                  <option value="">Select a Project</option>
                  {projects?.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Priority</label>
                  <input 
                    type="number" 
                    value={priority} 
                    onChange={e => setPriority(Number(e.target.value))}
                    min={1}
                    max={100}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accentBlue"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Max Concurrency</label>
                  <input 
                    type="number" 
                    value={maxConcurrency} 
                    onChange={e => setMaxConcurrency(Number(e.target.value))}
                    min={1}
                    max={50}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accentBlue"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Default Retry Policy</label>
                <select 
                  value={retryPolicyId} 
                  onChange={e => setRetryPolicyId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accentBlue"
                >
                  <option value="">None (Fail immediately)</option>
                  {retryPolicies?.map(rp => (
                    <option key={rp.id} value={rp.id}>{rp.name} ({rp.strategy})</option>
                  ))}
                </select>
              </div>

              <div className="pt-4 border-t border-darkBorder flex justify-end gap-2">
                <button 
                  type="button" 
                  onClick={() => setIsCreateOpen(false)}
                  className="px-4 py-2 text-sm font-semibold text-slate-300 hover:text-white"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={createQueueMutation.isPending}
                  className="px-4 py-2 text-sm font-semibold text-white bg-accentBlue rounded-lg hover:bg-blue-600 transition disabled:opacity-50"
                >
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 2. Edit Modal */}
      {isEditOpen && selectedQueue && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-center items-center p-4">
          <div className="bg-darkCard border border-darkBorder w-full max-w-md rounded-xl overflow-hidden shadow-2xl">
            <div className="p-5 border-b border-darkBorder flex justify-between items-center">
              <h3 className="text-lg font-bold text-white">Edit Queue: {selectedQueue.name}</h3>
              <button onClick={() => setIsEditOpen(false)} className="text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleEditSubmit} className="p-5 space-y-4">
              {formError && (
                <div className="p-3 bg-accentRed/10 text-accentRed text-xs rounded-lg flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" /> {formError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Priority</label>
                  <input 
                    type="number" 
                    value={editPriority} 
                    onChange={e => setEditPriority(Number(e.target.value))}
                    min={1}
                    max={100}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accentBlue"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Max Concurrency</label>
                  <input 
                    type="number" 
                    value={editMaxConcurrency} 
                    onChange={e => setEditMaxConcurrency(Number(e.target.value))}
                    min={1}
                    max={50}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accentBlue"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Default Retry Policy</label>
                <select 
                  value={editRetryPolicyId} 
                  onChange={e => setEditRetryPolicyId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accentBlue"
                >
                  <option value="">None (Fail immediately)</option>
                  {retryPolicies?.map(rp => (
                    <option key={rp.id} value={rp.id}>{rp.name} ({rp.strategy})</option>
                  ))}
                </select>
              </div>

              <div className="pt-4 border-t border-darkBorder flex justify-end gap-2">
                <button 
                  type="button" 
                  onClick={() => setIsEditOpen(false)}
                  className="px-4 py-2 text-sm font-semibold text-slate-300 hover:text-white"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={updateQueueMutation.isPending}
                  className="px-4 py-2 text-sm font-semibold text-white bg-accentBlue rounded-lg hover:bg-blue-600 transition disabled:opacity-50"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default QueuesView;
