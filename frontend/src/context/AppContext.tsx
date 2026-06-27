import { ReactNode, createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { Project } from '../types';

export interface RiskSettings {
  warnPercent: number;
  dangerPercent: number;
  criticalPercent: number;
}

export interface ChartSettings {
  overviewHeight: number;
  overviewExpandedHeight: number;
}

interface AppContextValue {
  projects: Project[];
  isLoadingProjects: boolean;
  projectsError: string;
  selectedProjectId: number | null;
  selectedProject: Project | null;
  setSelectedProjectId: (id: number | null) => void;
  refreshProjects: () => Promise<void>;
  riskSettings: RiskSettings;
  setRiskSettings: (settings: RiskSettings) => void;
  chartSettings: ChartSettings;
  setChartSettings: (settings: ChartSettings) => void;
  debugMode: boolean;
  setDebugMode: (enabled: boolean) => void;
}

const DEFAULT_RISK: RiskSettings = {
  warnPercent: 20,
  dangerPercent: 50,
  criticalPercent: 100,
};

const DEFAULT_CHART: ChartSettings = {
  overviewHeight: 520,
  overviewExpandedHeight: 660,
};

const AppContext = createContext<AppContextValue | null>(null);

function loadRiskSettings(): RiskSettings {
  const raw = localStorage.getItem('riskSettings');
  if (!raw) return DEFAULT_RISK;
  try {
    return { ...DEFAULT_RISK, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_RISK;
  }
}

function loadChartSettings(): ChartSettings {
  const raw = localStorage.getItem('chartSettings');
  if (!raw) return DEFAULT_CHART;
  try {
    return { ...DEFAULT_CHART, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CHART;
  }
}

function loadSelectedProjectId(): number | null {
  const raw = localStorage.getItem('selectedProjectId');
  if (!raw) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function loadDebugMode(): boolean {
  return localStorage.getItem('debugMode') === 'true';
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectIdState] = useState<number | null>(loadSelectedProjectId);
  const [riskSettings, setRiskSettingsState] = useState<RiskSettings>(loadRiskSettings);
  const [chartSettings, setChartSettingsState] = useState<ChartSettings>(loadChartSettings);
  const [debugMode, setDebugModeState] = useState<boolean>(loadDebugMode);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [projectsError, setProjectsError] = useState('');

  const refreshProjects = async () => {
    setIsLoadingProjects(true);
    setProjectsError('');
    try {
      const data = await api.get<Project[]>('/api/projects');
      setProjects(data);
      setSelectedProjectIdState((current) => {
        if (current && data.some((project) => project.id === current)) return current;
        const next = data[0]?.id ?? null;
        if (next) localStorage.setItem('selectedProjectId', String(next));
        else localStorage.removeItem('selectedProjectId');
        return next;
      });
    } catch (err) {
      const message = (err as Error).message || '项目列表加载失败';
      setProjectsError(message);
      throw err;
    } finally {
      setIsLoadingProjects(false);
    }
  };

  useEffect(() => {
    refreshProjects().catch(() => undefined);
  }, []);

  const setSelectedProjectId = (id: number | null) => {
    setSelectedProjectIdState(id);
    if (id) localStorage.setItem('selectedProjectId', String(id));
    else localStorage.removeItem('selectedProjectId');
  };

  const setRiskSettings = (settings: RiskSettings) => {
    setRiskSettingsState(settings);
    localStorage.setItem('riskSettings', JSON.stringify(settings));
  };

  const setChartSettings = (settings: ChartSettings) => {
    setChartSettingsState(settings);
    localStorage.setItem('chartSettings', JSON.stringify(settings));
  };

  const setDebugMode = (enabled: boolean) => {
    setDebugModeState(enabled);
    localStorage.setItem('debugMode', String(enabled));
  };

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );

  return (
    <AppContext.Provider
      value={{
        projects,
        isLoadingProjects,
        projectsError,
        selectedProjectId,
        selectedProject,
        setSelectedProjectId,
        refreshProjects,
        riskSettings,
        setRiskSettings,
        chartSettings,
        setChartSettings,
        debugMode,
        setDebugMode,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const value = useContext(AppContext);
  if (!value) throw new Error('useAppContext must be used inside AppProvider');
  return value;
}
