import { useEffect, useState } from 'react';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Layout } from './components/Layout';
import { AppProvider } from './context/AppContext';
import { AnalysisPage } from './pages/AnalysisPage';
import { CrackRecordsPage } from './pages/CrackRecordsPage';
import { DewesoftImportsPage } from './pages/DewesoftImportsPage';
import { FemPreviewPage } from './pages/FemPreviewPage';
import { ImportPage } from './pages/ImportPage';
import { PointDetailPage } from './pages/PointDetailPage';
import { ProjectCreatePage } from './pages/ProjectCreatePage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { ProjectOverviewPage } from './pages/ProjectOverviewPage';
import { ProjectRowsPage } from './pages/ProjectRowsPage';
import { SettingsPage } from './pages/SettingsPage';
import { TestRunNewPage } from './pages/TestRunNewPage';
import { UsageGuidePage } from './pages/UsageGuidePage';
import { WorkflowPage } from './pages/WorkflowPage';

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      // 直接访问站点时默认进入模型预览主页；数据概览拆分到 /overview。
      { index: true, element: <Navigate to="/fem-preview" replace /> },
      { path: 'overview', element: <ProjectOverviewPage /> },
      { path: 'project-detail', element: <ProjectRowsPage /> },
      { path: 'crack-records', element: <CrackRecordsPage /> },
      { path: 'projects/new', element: <ProjectCreatePage /> },
      { path: 'import', element: <ImportPage /> },
      { path: 'fem-preview', element: <FemPreviewPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'help', element: <UsageGuidePage /> },
      { path: 'workflow', element: <WorkflowPage /> },
      { path: 'projects/:projectId', element: <ProjectDetailPage /> },
      { path: 'projects/:projectId/test-runs/new', element: <TestRunNewPage /> },
      { path: 'projects/:projectId/analysis', element: <AnalysisPage /> },
      { path: 'projects/:projectId/dewesoft-imports', element: <DewesoftImportsPage /> },
      { path: 'points/:pointId', element: <PointDetailPage /> },
    ],
  },
]);

function shouldBlockMobileAccess(): boolean {
  const mobileAgent = /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(navigator.userAgent);
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  const narrowViewport = window.matchMedia('(max-width: 768px)').matches;
  return mobileAgent || (coarsePointer && narrowViewport);
}

export function App() {
  const [mobileBlocked, setMobileBlocked] = useState(shouldBlockMobileAccess);
  const [allowMobileAccess, setAllowMobileAccess] = useState(false);

  useEffect(() => {
    if (allowMobileAccess) return undefined;
    const syncMobileBlock = () => setMobileBlocked(shouldBlockMobileAccess());
    syncMobileBlock();
    window.addEventListener('resize', syncMobileBlock);
    return () => window.removeEventListener('resize', syncMobileBlock);
  }, [allowMobileAccess]);

  if (mobileBlocked && !allowMobileAccess) {
    return (
      <div className="mobile-block">
        <div>
          <h1>请使用 PC 访问</h1>
          <p>当前系统面向桌面端数据录入和分析工作流，移动端暂不支持。</p>
          <button className="button primary" type="button" onClick={() => setAllowMobileAccess(true)}>
            仍要访问
          </button>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <AppProvider>
        <RouterProvider router={router} />
      </AppProvider>
    </ErrorBoundary>
  );
}
