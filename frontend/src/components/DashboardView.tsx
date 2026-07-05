import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend 
} from 'recharts';
import { 
  Layers, Users, CheckCircle, AlertTriangle, RefreshCw 
} from 'lucide-react';
import api from '../api';

interface SummaryMetrics {
  queuesCount: number;
  activeWorkers: number;
  depth: number;
  running: number;
  completed: number;
  failed: number;
  dlqCount: number;
  systemHealth: 'HEALTHY' | 'DEGRADED';
}

interface ThroughputItem {
  hour: string;
  completed: number;
  failed: number;
}

interface QueueBreakdownItem {
  queueId: string;
  queueName: string;
  projectName: string;
  priority: number;
  maxConcurrency: number;
  isPaused: boolean;
  depth: number;
  running: number;
  completed: number;
  failed: number;
}

export const DashboardView: React.FC = () => {
  // Query 1: Summary metrics
  const { data: summary, refetch: refetchSummary, isFetching: fetchingSummary } = useQuery<SummaryMetrics>({
    queryKey: ['metricsSummary'],
    queryFn: () => api.get('/metrics/summary'),
    refetchInterval: 5000 // Poll every 5 seconds
  });

  // Query 2: Throughput chart data
  const { data: throughput, refetch: refetchThroughput, isFetching: fetchingThroughput } = useQuery<ThroughputItem[]>({
    queryKey: ['metricsThroughput'],
    queryFn: () => api.get('/metrics/throughput'),
    refetchInterval: 10000
  });

  // Query 3: Queue breakdown
  const { data: queueBreakdown, refetch: refetchQueues, isFetching: fetchingQueues } = useQuery<QueueBreakdownItem[]>({
    queryKey: ['metricsQueues'],
    queryFn: () => api.get('/metrics/queues'),
    refetchInterval: 5000
  });

  const handleRefreshAll = () => {
    refetchSummary();
    refetchThroughput();
    refetchQueues();
  };

  const isRefreshing = fetchingSummary || fetchingThroughput || fetchingQueues;

  const totalFinished = (summary?.completed || 0) + (summary?.failed || 0);
  const successRate = totalFinished > 0 
    ? Math.round((summary!.completed / totalFinished) * 1000) / 10 
    : 100;

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-wide">System Dashboard</h1>
          <p className="text-sm text-slate-400">Real-time status overview of active queues, worker nodes, and throughput.</p>
        </div>
        <button 
          onClick={handleRefreshAll}
          disabled={isRefreshing}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-200 bg-slate-800 rounded-lg hover:bg-slate-700 transition duration-200 border border-slate-700 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Grid Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Metric 1 */}
        <div className="glassmorphism p-5 rounded-xl flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Queue Depth</span>
            <h3 className="text-3xl font-extrabold text-white mt-1">{summary?.depth ?? 0}</h3>
            <p className="text-xs text-slate-400 mt-2 flex items-center gap-1">
              <span className="inline-block h-2 w-2 rounded-full bg-accentOrange animate-ping"></span>
              {summary?.running ?? 0} jobs executing now
            </p>
          </div>
          <div className="p-3 bg-accentOrange/10 rounded-lg text-accentOrange">
            <Layers className="h-6 w-6" />
          </div>
        </div>

        {/* Metric 2 */}
        <div className="glassmorphism p-5 rounded-xl flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Active Workers</span>
            <h3 className="text-3xl font-extrabold text-white mt-1">{summary?.activeWorkers ?? 0}</h3>
            <p className="text-xs text-slate-400 mt-2 flex items-center gap-1">
              <span className={`inline-block h-2 w-2 rounded-full ${summary?.activeWorkers ? 'bg-accentGreen' : 'bg-accentRed'}`}></span>
              Status: {summary?.systemHealth ?? 'UNKNOWN'}
            </p>
          </div>
          <div className="p-3 bg-accentGreen/10 rounded-lg text-accentGreen">
            <Users className="h-6 w-6" />
          </div>
        </div>

        {/* Metric 3 */}
        <div className="glassmorphism p-5 rounded-xl flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Success Rate</span>
            <h3 className="text-3xl font-extrabold text-white mt-1">{successRate}%</h3>
            <p className="text-xs text-slate-400 mt-2">
              Out of {totalFinished} finished runs
            </p>
          </div>
          <div className="p-3 bg-blue-500/10 rounded-lg text-blue-500">
            <CheckCircle className="h-6 w-6" />
          </div>
        </div>

        {/* Metric 4 */}
        <div className="glassmorphism p-5 rounded-xl flex items-center justify-between">
          <div>
            <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Dead Letter Queue</span>
            <h3 className="text-3xl font-extrabold text-white mt-1">{summary?.dlqCount ?? 0}</h3>
            <p className="text-xs text-slate-400 mt-2 flex items-center gap-1">
              {summary?.dlqCount ? (
                <span className="text-accentRed font-semibold flex items-center gap-1">
                  <AlertTriangle className="h-3 w-3" /> Action needed
                </span>
              ) : 'Empty & clean'}
            </p>
          </div>
          <div className="p-3 bg-accentRed/10 rounded-lg text-accentRed">
            <AlertTriangle className="h-6 w-6" />
          </div>
        </div>
      </div>

      {/* Throughput Chart */}
      <div className="glassmorphism p-5 rounded-xl">
        <h2 className="text-lg font-bold text-white mb-4">Throughput Over Time (Last 24 Hours)</h2>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={throughput || []}
              margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id="colorCompleted" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/>
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="colorFailed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2}/>
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.2} />
              <XAxis dataKey="hour" stroke="#64748b" fontSize={11} />
              <YAxis stroke="#64748b" fontSize={11} />
              <Tooltip 
                contentStyle={{ backgroundColor: '#1e293b', borderColor: '#334155', borderRadius: '8px' }}
                labelStyle={{ color: '#ffffff', fontWeight: 'bold' }}
              />
              <Legend verticalAlign="top" height={36} />
              <Area 
                name="Succeeded"
                type="monotone" 
                dataKey="completed" 
                stroke="#10b981" 
                fillOpacity={1} 
                fill="url(#colorCompleted)" 
                strokeWidth={2}
              />
              <Area 
                name="Failed / DLQ"
                type="monotone" 
                dataKey="failed" 
                stroke="#ef4444" 
                fillOpacity={1} 
                fill="url(#colorFailed)" 
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Queue Breakdown Table */}
      <div className="glassmorphism rounded-xl overflow-hidden">
        <div className="p-5 border-b border-slate-800">
          <h2 className="text-lg font-bold text-white">Queue Capacity & Load</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-900/50 text-slate-400 text-xs font-semibold uppercase tracking-wider border-b border-slate-800">
                <th className="px-6 py-4">Queue Name</th>
                <th className="px-6 py-4">Project</th>
                <th className="px-6 py-4">Priority</th>
                <th className="px-6 py-4">Max Concurrency</th>
                <th className="px-6 py-4 text-center">Depth</th>
                <th className="px-6 py-4 text-center">Active Runs</th>
                <th className="px-6 py-4 text-right">State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50 text-sm text-slate-300">
              {queueBreakdown?.map((qb) => (
                <tr key={qb.queueId} className="hover:bg-slate-800/20 transition duration-150">
                  <td className="px-6 py-4 font-semibold text-white">{qb.queueName}</td>
                  <td className="px-6 py-4 text-slate-400">{qb.projectName}</td>
                  <td className="px-6 py-4">
                    <span className={`px-2 py-0.5 rounded text-xs font-bold ${qb.priority >= 10 ? 'bg-accentOrange/10 text-accentOrange' : 'bg-slate-800 text-slate-400'}`}>
                      {qb.priority}
                    </span>
                  </td>
                  <td className="px-6 py-4 font-mono">{qb.maxConcurrency}</td>
                  <td className="px-6 py-4 text-center font-semibold font-mono">{qb.depth}</td>
                  <td className="px-6 py-4 text-center font-mono">
                    <div className="flex items-center justify-center gap-2">
                      <span className="text-white font-semibold">{qb.running}</span>
                      <span className="text-slate-500">/</span>
                      <span className="text-slate-400">{qb.maxConcurrency}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    {qb.isPaused ? (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-accentRed/10 text-accentRed border border-accentRed/20">
                        Paused
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold bg-accentGreen/10 text-accentGreen border border-accentGreen/20">
                        Running
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {(!queueBreakdown || queueBreakdown.length === 0) && (
                <tr>
                  <td colSpan={7} className="px-6 py-10 text-center text-slate-500">
                    No active queues found in this project.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default DashboardView;
