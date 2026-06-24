import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { Layout } from './components/Layout';
import { AppProvider } from './context/AppContext';
import { AnalysisPage } from './pages/AnalysisPage';
import { DewesoftImportsPage } from './pages/DewesoftImportsPage';
import { ImportPage } from './pages/ImportPage';
import { PointDetailPage } from './pages/PointDetailPage';
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
      { path: 'import', element: <ImportPage /> },
      { path: 'projects/:projectId', element: <ProjectDetailPage /> },
      { path: 'projects/:projectId/test-runs/new', element: <TestRunNewPage /> },
      { path: 'projects/:projectId/analysis', element: <AnalysisPage /> },
      { path: 'projects/:projectId/dewesoft-imports', element: <DewesoftImportsPage /> },
      { path: 'points/:pointId', element: <PointDetailPage /> },
    ],
  },
]);

export function App() {
  return (
    <AppProvider>
      <RouterProvider router={router} />
    </AppProvider>
  );
}
