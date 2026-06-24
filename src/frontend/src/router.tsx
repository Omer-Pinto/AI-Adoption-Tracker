import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import TeamsIndexPage from '@/pages/team/TeamsIndexPage';
import TeamPage from '@/pages/team/TeamPage';
import DomainPage from '@/pages/domain/DomainPage';
import DomainSetupPage from '@/pages/domain/DomainSetupPage';
import ManagePage from '@/pages/manage/ManagePage';
import ArtifactsPage from '@/pages/artifacts/ArtifactsPage';
import TasksPage from '@/pages/tasks/TasksPage';
import ReportCreatePage from '@/pages/report/ReportCreatePage';
import ReportPreviewPage from '@/pages/report/ReportPreviewPage';
import ReportEditPage from '@/pages/report/ReportEditPage';

// FIXED ROUTES — Wave-2 agents fill the stub page BODIES, never this file.
// Paths mirror spec §7 / task_breakdown Wave-2 page folders.
export const router = createBrowserRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <TeamsIndexPage /> },
      { path: 'manage', element: <ManagePage /> },
      { path: 'teams/:championId', element: <TeamPage /> },
      { path: 'domains/setup', element: <DomainSetupPage /> },
      { path: 'domains/:domainId', element: <DomainPage /> },
      { path: 'artifacts', element: <ArtifactsPage /> },
      { path: 'tasks', element: <TasksPage /> },
      { path: 'reports/new', element: <ReportCreatePage /> },
      { path: 'reports/:reportId/preview', element: <ReportPreviewPage /> },
      { path: 'reports/:reportId/edit', element: <ReportEditPage /> },
    ],
  },
]);
