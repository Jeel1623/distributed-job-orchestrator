import React, { useState, useEffect } from 'react';
import { QueryClient, QueryClientProvider, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AuthProvider, useAuth } from './context/AuthContext';
import socket from './socket';
import api from './api';

// Tab Views
import DashboardView from './components/DashboardView';
import QueuesView from './components/QueuesView';
import JobsView from './components/JobsView';
import DlqView from './components/DlqView';
import WorkersView from './components/WorkersView';

import { 
  Layers, Activity, AlertTriangle, LogOut, Terminal, 
  Settings, Folder, Plus, ArrowRight, ShieldAlert, Sparkles, RefreshCw
} from 'lucide-react';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1
    }
  }
});

interface Project {
  id: string;
  name: string;
}

// ==========================================
// AUTHENTICATION SCREENS (LOGIN/REGISTER)
// ==========================================
const AuthScreen: React.FC = () => {
  const { login, register } = useAuth();
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orgName, setOrgName] = useState('');
  const [role, setRole] = useState<'ADMIN' | 'MEMBER'>('ADMIN');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (isRegister) {
        if (!orgName) {
          setError('Organization name is required');
          setLoading(false);
          return;
        }
        await register(email, password, orgName, role);
      } else {
        await login(email, password);
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#070a13] flex flex-col justify-center items-center p-4 relative overflow-hidden">
      {/* Decorative ambient gradients */}
      <div className="absolute top-1/4 left-1/4 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] bg-accentBlue/10 rounded-full blur-[100px] pointer-events-none"></div>
      <div className="absolute bottom-1/4 right-1/4 translate-x-1/2 translate-y-1/2 w-[400px] h-[400px] bg-purple-500/10 rounded-full blur-[100px] pointer-events-none"></div>

      <div className="w-full max-w-md space-y-8 relative z-10">
        {/* Branding */}
        <div className="text-center space-y-2">
          <div className="inline-flex p-3 bg-accentBlue/10 border border-accentBlue/20 rounded-2xl text-accentBlue mb-2 shadow-inner">
            <Sparkles className="h-8 w-8 animate-pulse" />
          </div>
          <h2 className="text-3xl font-extrabold text-white tracking-tight">Distributed Job Orchestrator</h2>
          <p className="text-sm text-slate-400">Distributed Job Scheduling & Orchestration Platform</p>
        </div>

        {/* Card Form */}
        <div className="glassmorphism p-8 rounded-2xl shadow-2xl border border-slate-800">
          <h3 className="text-lg font-bold text-slate-200 mb-6 text-center">
            {isRegister ? 'Create your platform account' : 'Sign in to dashboard'}
          </h3>

          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 bg-accentRed/10 text-accentRed text-xs rounded-lg flex items-center gap-2 border border-accentRed/20">
                <ShieldAlert className="h-4 w-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Email Address</label>
              <input 
                type="email" 
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@acme.com"
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-white placeholder-slate-600 text-sm focus:outline-none focus:border-accentBlue"
              />
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Password</label>
              <input 
                type="password" 
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-white placeholder-slate-600 text-sm focus:outline-none focus:border-accentBlue"
              />
            </div>

            {isRegister && (
              <>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Organization Name</label>
                  <input 
                    type="text" 
                    required
                    value={orgName}
                    onChange={e => setOrgName(e.target.value)}
                    placeholder="Acme Corp"
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-white placeholder-slate-600 text-sm focus:outline-none focus:border-accentBlue"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Account Role</label>
                  <select 
                    value={role} 
                    onChange={e => setRole(e.target.value as any)}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-accentBlue"
                  >
                    <option value="ADMIN">ADMIN (Full Access)</option>
                    <option value="MEMBER">MEMBER (Read-only Queues)</option>
                  </select>
                </div>
              </>
            )}

            <button 
              type="submit" 
              disabled={loading}
              className="w-full py-2.5 bg-accentBlue text-white font-bold rounded-lg text-sm hover:bg-blue-600 transition flex items-center justify-center gap-1 shadow-lg shadow-accentBlue/20 disabled:opacity-50"
            >
              {loading ? 'Processing...' : isRegister ? 'Register Account' : 'Sign In'}
              {!loading && <ArrowRight className="h-4 w-4" />}
            </button>
          </form>

          {/* Toggle Screen Link */}
          <div className="mt-6 text-center">
            <button 
              onClick={() => { setIsRegister(!isRegister); setError(null); }}
              className="text-xs text-slate-400 hover:text-white underline cursor-pointer"
            >
              {isRegister ? 'Already have an account? Sign in' : "Don't have an account? Register organization"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

// ==========================================
// APP CORE WRAPPER
// ==========================================
const AppCore: React.FC = () => {
  const { user, logout } = useAuth();
  const [activeTab, setActiveTab] = useState<'dashboard' | 'queues' | 'jobs' | 'dlq' | 'workers'>('dashboard');
  const [socketConnected, setSocketConnected] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [isAddProjOpen, setIsAddProjOpen] = useState(false);
  const [newProjName, setNewProjName] = useState('');

  const qc = useQueryClient();

  // Queries
  const { data: projects } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: () => api.get('/projects'),
    enabled: !!user
  });

  const activeProject = projects?.find(p => p.id === selectedProjectId) || projects?.[0];

  // Set default selected project
  useEffect(() => {
    if (projects && projects.length > 0 && !selectedProjectId) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects]);

  // Handle Websocket real-time events
  useEffect(() => {
    socket.on('connect', () => {
      setSocketConnected(true);
      console.log('[WebSockets] Socket connected. Live notifications enabled.');
    });

    socket.on('disconnect', () => {
      setSocketConnected(false);
    });

    // Handle updates
    const handleJobChange = () => {
      qc.invalidateQueries({ queryKey: ['jobs'] });
      qc.invalidateQueries({ queryKey: ['metricsSummary'] });
      qc.invalidateQueries({ queryKey: ['metricsQueues'] });
      qc.invalidateQueries({ queryKey: ['queues'] });
    };

    const handleWorkerChange = () => {
      qc.invalidateQueries({ queryKey: ['workers'] });
      qc.invalidateQueries({ queryKey: ['metricsSummary'] });
    };

    socket.on('job:created', handleJobChange);
    socket.on('job:updated', handleJobChange);
    socket.on('job:deleted', handleJobChange);
    socket.on('batch:created', handleJobChange);
    socket.on('worker:updated', handleWorkerChange);

    // Initial state
    setSocketConnected(socket.connected);

    return () => {
      socket.off('job:created', handleJobChange);
      socket.off('job:updated', handleJobChange);
      socket.off('job:deleted', handleJobChange);
      socket.off('batch:created', handleJobChange);
      socket.off('worker:updated', handleWorkerChange);
    };
  }, [qc]);

  // Project Creation mutation
  const createProjMutation = useMutation({
    mutationFn: (name: string) => api.post('/projects', { name }),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      setSelectedProjectId(data.id);
      setIsAddProjOpen(false);
      setNewProjName('');
    }
  });

  const handleProjSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjName) return;
    createProjMutation.mutate(newProjName);
  };

  const renderActiveView = () => {
    switch (activeTab) {
      case 'dashboard':
        return <DashboardView />;
      case 'queues':
        return <QueuesView />;
      case 'jobs':
        return <JobsView />;
      case 'dlq':
        return <DlqView />;
      case 'workers':
        return <WorkersView />;
      default:
        return <DashboardView />;
    }
  };

  return (
    <div className="flex h-screen bg-[#070a13] text-slate-100 overflow-hidden">
      {/* 1. SIDEBAR */}
      <aside className="w-64 bg-[#0a0e1b] border-r border-slate-900 flex flex-col justify-between flex-shrink-0">
        <div className="flex-1 flex flex-col min-h-0">
          {/* Logo Branding */}
          <div className="p-5 border-b border-slate-900 flex items-center gap-2">
            <div className="p-1.5 bg-accentBlue/10 border border-accentBlue/20 rounded-lg text-accentBlue">
              <Sparkles className="h-5 w-5" />
            </div>
            <span className="font-extrabold text-white tracking-wider text-base uppercase">AG Scheduler</span>
          </div>

          {/* Project Switcher section */}
          <div className="p-4 border-b border-slate-900 space-y-2">
            <div className="flex justify-between items-center text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
              <span>Selected Project</span>
              <button 
                onClick={() => setIsAddProjOpen(true)}
                className="p-1 text-slate-400 hover:text-white bg-slate-800/40 hover:bg-slate-800 rounded transition"
              >
                <Plus className="h-3 w-3" />
              </button>
            </div>
            
            {isAddProjOpen ? (
              <form onSubmit={handleProjSubmit} className="flex gap-1.5 items-center">
                <input
                  type="text"
                  required
                  value={newProjName}
                  onChange={e => setNewProjName(e.target.value)}
                  placeholder="Proj Name"
                  className="flex-1 bg-slate-900 border border-slate-800 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-accentBlue"
                />
                <button type="submit" className="p-1 bg-accentBlue text-white rounded text-xs">OK</button>
                <button type="button" onClick={() => setIsAddProjOpen(false)} className="text-slate-400 text-xs">X</button>
              </form>
            ) : (
              <select
                value={selectedProjectId}
                onChange={e => setSelectedProjectId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs text-slate-200 font-semibold focus:outline-none"
              >
                {projects?.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
          </div>

          {/* Navigation Links */}
          <nav className="p-4 flex-1 space-y-1.5 overflow-y-auto">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-semibold rounded-lg transition ${
                activeTab === 'dashboard' ? 'bg-accentBlue/10 text-accentBlue font-bold' : 'text-slate-400 hover:bg-slate-800/40 hover:text-white'
              }`}
            >
              <Activity className="h-4.5 w-4.5" /> Dashboard
            </button>
            
            <button
              onClick={() => setActiveTab('queues')}
              className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-semibold rounded-lg transition ${
                activeTab === 'queues' ? 'bg-accentBlue/10 text-accentBlue font-bold' : 'text-slate-400 hover:bg-slate-800/40 hover:text-white'
              }`}
            >
              <Layers className="h-4.5 w-4.5" /> Queue Manager
            </button>

            <button
              onClick={() => setActiveTab('jobs')}
              className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-semibold rounded-lg transition ${
                activeTab === 'jobs' ? 'bg-accentBlue/10 text-accentBlue font-bold' : 'text-slate-400 hover:bg-slate-800/40 hover:text-white'
              }`}
            >
              <Terminal className="h-4.5 w-4.5" /> Job Explorer
            </button>

            <button
              onClick={() => setActiveTab('dlq')}
              className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-semibold rounded-lg transition ${
                activeTab === 'dlq' ? 'bg-accentBlue/10 text-accentBlue font-bold' : 'text-slate-400 hover:bg-slate-800/40 hover:text-white'
              }`}
            >
              <AlertTriangle className="h-4.5 w-4.5" /> Dead Letter Queue
            </button>

            <button
              onClick={() => setActiveTab('workers')}
              className={`w-full flex items-center gap-3 px-3 py-2 text-xs font-semibold rounded-lg transition ${
                activeTab === 'workers' ? 'bg-accentBlue/10 text-accentBlue font-bold' : 'text-slate-400 hover:bg-slate-800/40 hover:text-white'
              }`}
            >
              <Settings className="h-4.5 w-4.5" /> Worker Monitor
            </button>
          </nav>
        </div>

        {/* Profile Footer */}
        <div className="p-4 border-t border-slate-900 bg-slate-950/20 text-xs flex items-center justify-between">
          <div className="truncate pr-2">
            <span className="block font-bold text-white truncate">{user?.email}</span>
            <span className="block text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">{user?.role}</span>
          </div>
          <button 
            onClick={logout}
            className="p-1.5 text-slate-400 hover:text-accentRed bg-slate-900 border border-slate-800 hover:border-accentRed/20 hover:bg-accentRed/5 rounded-lg transition"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </aside>

      {/* 2. MAIN CONTAINER */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header Bar */}
        <header className="h-14 bg-[#0a0e1b] border-b border-slate-900 flex justify-between items-center px-6 flex-shrink-0">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <Folder className="h-4 w-4" />
            <span>Project:</span>
            <span className="font-semibold text-white">{activeProject?.name || 'Loading...'}</span>
          </div>
          
          {/* Socket & Health Indicator */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-full ${socketConnected ? 'bg-accentGreen' : 'bg-accentRed animate-pulse'}`}></span>
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                {socketConnected ? 'Live Connection' : 'Offline'}
              </span>
            </div>
          </div>
        </header>

        {/* Main View Area */}
        <main className="flex-1 overflow-y-auto p-6 bg-[#070a13]">
          {renderActiveView()}
        </main>
      </div>
    </div>
  );
};

export const AppContent: React.FC = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#070a13] flex justify-center items-center">
        <RefreshCw className="h-10 w-10 text-accentBlue animate-spin" />
      </div>
    );
  }

  return user ? <AppCore /> : <AuthScreen />;
};

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </QueryClientProvider>
  );
}
