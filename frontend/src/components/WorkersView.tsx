import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { 
  RefreshCw, Cpu, Activity, Server, AlertCircle, HardDrive 
} from 'lucide-react';
import api from '../api';

interface Worker {
  id: string;
  hostname: string;
  status: 'ACTIVE' | 'DRAINING' | 'DEAD';
  lastHeartbeatAt: string;
  concurrencyCapacity: number;
  currentLoad: number;
  _count: {
    jobs: number;
  };
}

interface HeartbeatRecord {
  id: string;
  timestamp: string;
  cpuUsage: number | null;
  memoryUsage: number | null;
}

interface Job {
  id: string;
  status: string;
  queue: {
    name: string;
  };
}

interface WorkerDetail extends Worker {
  heartbeats: HeartbeatRecord[];
  jobs: Job[];
}

export const WorkersView: React.FC = () => {
  const [selectedWorkerId, setSelectedWorkerId] = useState<string | null>(null);

  // Queries
  const { data: workers, isLoading: workersLoading, refetch: refetchWorkers } = useQuery<Worker[]>({
    queryKey: ['workers'],
    queryFn: () => api.get('/workers'),
    refetchInterval: 3000 // Poll every 3 seconds for live node lists
  });

  const { data: workerDetail, refetch: refetchDetail } = useQuery<WorkerDetail>({
    queryKey: ['workerDetail', selectedWorkerId],
    queryFn: () => api.get(`/workers/${selectedWorkerId}`),
    enabled: !!selectedWorkerId,
    refetchInterval: 2000 // Fast polling when detail panel is active
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ACTIVE':
        return 'text-accentGreen bg-accentGreen/10 border-accentGreen/20';
      case 'DRAINING':
        return 'text-accentOrange bg-accentOrange/10 border-accentOrange/20 animate-pulse';
      case 'DEAD':
        return 'text-slate-500 bg-slate-800/40 border-slate-700';
      default:
        return 'text-slate-400 bg-slate-800';
    }
  };

  // Convert heartbeat data for charts
  const chartData = workerDetail?.heartbeats.map(h => ({
    time: new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    cpu: Math.round((h.cpuUsage || 0) * 100) / 100,
    memory: Math.round((h.memoryUsage || 0) * 10) / 10
  })).reverse() || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-wide">Worker Monitor</h1>
          <p className="text-sm text-slate-400">Track horizontally scaled worker process states, resource utilization metrics, and load factors.</p>
        </div>
        <button 
          onClick={() => { refetchWorkers(); if (selectedWorkerId) refetchDetail(); }}
          className="p-2 text-slate-400 hover:text-white bg-slate-800 rounded-lg hover:bg-slate-700 transition"
        >
          <RefreshCw className="h-5 w-5" />
        </button>
      </div>

      {/* Grid Container */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Workers List (Left col) */}
        <div className="lg:col-span-2 space-y-4">
          {workersLoading ? (
            <div className="flex justify-center items-center py-20">
              <RefreshCw className="h-8 w-8 text-accentBlue animate-spin" />
            </div>
          ) : (
            <div className="space-y-4">
              {workers?.map((worker) => {
                const loadPercent = Math.min((worker.currentLoad / worker.concurrencyCapacity) * 100, 100);
                const isSelected = selectedWorkerId === worker.id;

                return (
                  <div 
                    key={worker.id}
                    onClick={() => setSelectedWorkerId(worker.id)}
                    className={`glassmorphism rounded-xl border p-5 cursor-pointer transition duration-150 flex flex-col sm:flex-row justify-between sm:items-center gap-4 ${
                      isSelected 
                        ? 'border-accentBlue/60 bg-accentBlue/5' 
                        : 'border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="space-y-2 flex-1">
                      <div className="flex items-center gap-2">
                        <Server className="h-4.5 w-4.5 text-slate-400" />
                        <h3 className="text-base font-bold text-white font-mono">{worker.id}</h3>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold border ${getStatusColor(worker.status)}`}>
                          {worker.status}
                        </span>
                      </div>
                      <div className="text-xs text-slate-400">
                        Hostname: <span className="text-slate-200">{worker.hostname}</span>
                        <span className="mx-2">•</span>
                        Heartbeat: <span className="text-slate-200">{new Date(worker.lastHeartbeatAt).toLocaleTimeString()}</span>
                      </div>
                    </div>

                    {/* Concurrency Load bar */}
                    <div className="w-full sm:w-48 space-y-1">
                      <div className="flex justify-between text-xs font-semibold">
                        <span className="text-slate-400">Concurrency Load</span>
                        <span className="text-white font-mono">{worker.currentLoad} / {worker.concurrencyCapacity}</span>
                      </div>
                      <div className="w-full bg-slate-900 rounded-full h-2 overflow-hidden border border-slate-800">
                        <div 
                          className={`h-full rounded-full transition-all duration-300 ${
                            loadPercent >= 90 
                              ? 'bg-accentRed' 
                              : loadPercent >= 50 
                                ? 'bg-accentOrange' 
                                : 'bg-accentGreen'
                          }`}
                          style={{ width: `${loadPercent}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>
                );
              })}

              {(!workers || workers.length === 0) && (
                <div className="text-center py-20 glassmorphism rounded-xl border border-slate-800 text-slate-500">
                  No active workers detected. Start worker instances to begin execution.
                </div>
              )}
            </div>
          )}
        </div>

        {/* Worker Details (Right Panel) */}
        <div className="space-y-4">
          {selectedWorkerId ? (
            workerDetail ? (
              <div className="glassmorphism p-5 rounded-xl border border-slate-800 space-y-6">
                <div>
                  <h3 className="text-lg font-bold text-white font-mono truncate">{workerDetail.id}</h3>
                  <p className="text-xs text-slate-400 mt-1">Host system metrics and active execution log details.</p>
                </div>

                {/* Resource Stats */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-slate-950/40 p-3 rounded-lg border border-slate-900/60 text-xs">
                    <span className="text-slate-400 uppercase tracking-wider block mb-1">CPU Load Avg</span>
                    <div className="flex items-center gap-1.5 text-base font-bold text-white">
                      <Cpu className="h-4 w-4 text-accentGreen" />
                      {workerDetail.heartbeats[0]?.cpuUsage 
                        ? `${workerDetail.heartbeats[0].cpuUsage.toFixed(2)}` 
                        : '0.00'}
                    </div>
                  </div>
                  <div className="bg-slate-950/40 p-3 rounded-lg border border-slate-900/60 text-xs">
                    <span className="text-slate-400 uppercase tracking-wider block mb-1">RAM Heap</span>
                    <div className="flex items-center gap-1.5 text-base font-bold text-white font-mono">
                      <HardDrive className="h-4 w-4 text-accentBlue" />
                      {workerDetail.heartbeats[0]?.memoryUsage 
                        ? `${Math.round(workerDetail.heartbeats[0].memoryUsage)} MB` 
                        : '0 MB'}
                    </div>
                  </div>
                </div>

                {/* Heartbeat Usage Chart */}
                {chartData.length > 0 && (
                  <div className="space-y-2">
                    <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block">Resource History (Last 30 ticks)</span>
                    <div className="h-[150px] bg-black/20 p-2 rounded-lg border border-slate-850">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={chartData}>
                          <XAxis dataKey="time" hide />
                          <YAxis fontSize={9} stroke="#475569" />
                          <Tooltip 
                            contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: '4px', fontSize: 10 }}
                          />
                          <Line type="monotone" dataKey="cpu" name="CPU" stroke="#10b981" strokeWidth={1.5} dot={false} />
                          <Line type="monotone" dataKey="memory" name="RAM (MB)" stroke="#3b82f6" strokeWidth={1.5} dot={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}

                {/* Assigned Jobs List */}
                <div className="space-y-3">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider block flex items-center gap-1">
                    <Activity className="h-3.5 w-3.5" /> Assigned In-Flight Jobs ({workerDetail.jobs.length})
                  </span>
                  {workerDetail.jobs.length === 0 ? (
                    <p className="text-xs text-slate-500 italic">No executing jobs assigned to this worker node.</p>
                  ) : (
                    <div className="space-y-2 max-h-[220px] overflow-y-auto scrollbar-thin">
                      {workerDetail.jobs.map(job => (
                        <div key={job.id} className="p-2.5 bg-slate-950/50 rounded-lg border border-slate-900 text-xs flex justify-between items-center">
                          <div>
                            <span className="font-mono text-slate-400 block font-semibold">{job.id.substring(0, 8)}...</span>
                            <span className="text-slate-300">Queue: {job.queue?.name}</span>
                          </div>
                          <span className="px-1.5 py-0.2 rounded text-[10px] bg-accentOrange/10 text-accentOrange animate-pulse border border-accentOrange/15">
                            {job.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex justify-center items-center py-20">
                <RefreshCw className="h-6 w-6 text-accentBlue animate-spin" />
              </div>
            )
          ) : (
            <div className="glassmorphism p-8 rounded-xl border border-slate-800 text-center text-slate-500 flex flex-col items-center justify-center gap-2">
              <AlertCircle className="h-8 w-8 text-slate-600" />
              <span className="font-semibold text-slate-400">No worker selected</span>
              <span className="text-xs text-slate-500">Select a worker node from the list to view live CPU, RAM charts and current thread load.</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default WorkersView;
