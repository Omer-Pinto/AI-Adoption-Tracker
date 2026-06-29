import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import TeamsIndexPage from '@/pages/team/TeamsIndexPage';
import TeamPage from '@/pages/team/TeamPage';
import DomainPage from '@/pages/domain/DomainPage';
import DomainSetupPage from '@/pages/domain/DomainSetupPage';
import ManagePage from '@/pages/manage/ManagePage';
import ArtifactsPage from '@/pages/artifacts/ArtifactsPage';
import ArtifactDetailPage from '@/pages/artifacts/ArtifactDetailPage';
import TasksPage from '@/pages/tasks/TasksPage';
import TaskDetailPage from '@/pages/tasks/TaskDetailPage';
import AiLeadPage from '@/pages/ai-lead/AiLeadPage';
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
      { path: 'teams/:teamId', element: <TeamPage /> },
      { path: 'domains/extract', element: <DomainSetupPage /> },
      { path: 'domains/:domainId', element: <DomainPage /> },
      { path: 'artifacts', element: <ArtifactsPage /> },
      { path: 'artifacts/:id', element: <ArtifactDetailPage /> },
      { path: 'tasks', element: <TasksPage /> },
      { path: 'tasks/:id', element: <TaskDetailPage /> },
      { path: 'ai-lead', element: <AiLeadPage /> },
      { path: 'reports/new', element: <ReportCreatePage /> },
      { path: 'reports/:reportId/preview', element: <ReportPreviewPage /> },
      { path: 'reports/:reportId/edit', element: <ReportEditPage /> },
    ],
  },
]);
