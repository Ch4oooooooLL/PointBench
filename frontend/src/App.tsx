import { useEffect, useState } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Layout } from './components/Layout';
import { AppProvider } from './context/AppContext';
import { AnalysisPage } from './pages/AnalysisPage';
import { CrackRecordsPage } from './pages/CrackRecordsPage';
import { DewesoftImportsPage } from './pages/DewesoftImportsPage';
import { ImportPage } from './pages/ImportPage';
import { PointDetailPage } from './pages/PointDetailPage';
import { ProjectCreatePage } from './pages/ProjectCreatePage';
import { ProjectDetailPage } from './pages/ProjectDetailPage';
import { ProjectOverviewPage } from './pages/ProjectOverviewPage';
import { ProjectRowsPage } from './pages/ProjectRowsPage';
import { TestRunNewPage } from './pages/TestRunNewPage';

const router = createBrowserRouter([
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <ProjectOverviewPage /> },
      { path: 'project-detail', element: <ProjectRowsPage /> },
      { path: 'crack-records', element: <CrackRecordsPage /> },
      { path: 'projects/new', element: <ProjectCreatePage /> },
      { path: 'import', element: <ImportPage /> },
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
  const narrowViewport = window.matchMedia('(max-width: 900px)').matches;
  return mobileAgent || coarsePointer || narrowViewport;
}

export function App() {
  const [mobileBlocked, setMobileBlocked] = useState(shouldBlockMobileAccess);

  useEffect(() => {
    const syncMobileBlock = () => setMobileBlocked(shouldBlockMobileAccess());
    syncMobileBlock();
    window.addEventListener('resize', syncMobileBlock);
    return () => window.removeEventListener('resize', syncMobileBlock);
  }, []);

  if (mobileBlocked) {
    return (
      <div className="mobile-block">
        <div>
          <h1>请使用 PC 访问</h1>
          <p>当前系统面向桌面端数据录入和分析工作流，移动端暂不支持。</p>
        </div>
      </div>
    );
  }

  return (
    <AppProvider>
      <RouterProvider router={router} />
    </AppProvider>
  );
}
