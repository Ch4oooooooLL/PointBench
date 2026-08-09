import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { BackendBusyGuard } from '../components/BackendBusyGuard';
import { Project } from '../types';

export interface RiskSettings {
  warnPercent: number;
  dangerPercent: number;
  criticalPercent: number;
}

export interface ChartSettings {
  overviewHeight: number;
  overviewExpandedHeight: number;
  expandedChartWidth: number;
}

export interface AnomalySettings {
  rangeMpa: number;
}

export interface DisplaySettings {
  showPromptMessage: boolean;
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
  anomalySettings: AnomalySettings;
  setAnomalySettings: (settings: AnomalySettings) => void;
  displaySettings: DisplaySettings;
  setDisplaySettings: (settings: DisplaySettings) => void;
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
  expandedChartWidth: 1280,
};

const DEFAULT_ANOMALY: AnomalySettings = {
  rangeMpa: 20,
};

const DEFAULT_DISPLAY: DisplaySettings = {
  showPromptMessage: true,
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

function loadAnomalySettings(): AnomalySettings {
  const raw = localStorage.getItem('anomalySettings');
  if (!raw) return DEFAULT_ANOMALY;
  try {
    const parsed = JSON.parse(raw);
    const rawRange = parsed.rangeMpa ?? parsed.thresholdPercent ?? DEFAULT_ANOMALY.rangeMpa;
    const rangeMpa = typeof rawRange === 'number' && Number.isFinite(rawRange) ? rawRange : DEFAULT_ANOMALY.rangeMpa;
    return {
      ...DEFAULT_ANOMALY,
      ...parsed,
      rangeMpa,
    };
  } catch {
    return DEFAULT_ANOMALY;
  }
}

function loadDebugMode(): boolean {
  return localStorage.getItem('debugMode') === 'true';
}

function loadDisplaySettings(): DisplaySettings {
  const raw = localStorage.getItem('displaySettings');
  if (!raw) return DEFAULT_DISPLAY;
  try {
    return { ...DEFAULT_DISPLAY, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_DISPLAY;
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectIdState] = useState<number | null>(loadSelectedProjectId);
  const [riskSettings, setRiskSettingsState] = useState<RiskSettings>(loadRiskSettings);
  const [chartSettings, setChartSettingsState] = useState<ChartSettings>(loadChartSettings);
  const [anomalySettings, setAnomalySettingsState] = useState<AnomalySettings>(loadAnomalySettings);
  const [displaySettings, setDisplaySettingsState] = useState<DisplaySettings>(loadDisplaySettings);
  const [debugMode, setDebugModeState] = useState<boolean>(loadDebugMode);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [projectsError, setProjectsError] = useState('');

  const refreshProjects = useCallback(async () => {
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
  }, []);

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

  const setAnomalySettings = (settings: AnomalySettings) => {
    setAnomalySettingsState(settings);
    localStorage.setItem('anomalySettings', JSON.stringify(settings));
  };

  const setDebugMode = (enabled: boolean) => {
    setDebugModeState(enabled);
    localStorage.setItem('debugMode', String(enabled));
  };

  const setDisplaySettings = (settings: DisplaySettings) => {
    setDisplaySettingsState(settings);
    localStorage.setItem('displaySettings', JSON.stringify(settings));
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
        anomalySettings,
        setAnomalySettings,
        displaySettings,
        setDisplaySettings,
        debugMode,
        setDebugMode,
      }}
    >
      {children}
      <BackendBusyGuard />
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const value = useContext(AppContext);
  if (!value) throw new Error('useAppContext must be used inside AppProvider');
  return value;
}
