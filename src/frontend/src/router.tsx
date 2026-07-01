import { createBrowserRouter } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { ProtectedRoute } from '@/auth/ProtectedRoute';
import LoginPage from '@/pages/login/LoginPage';
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
import UsersPage from '@/pages/users/UsersPage';
import ForbiddenPage from '@/pages/error/ForbiddenPage';
import NotFoundPage from '@/pages/error/NotFoundPage';

// FIXED ROUTES — Wave-2 agents fill the stub page BODIES, never this file.
// Paths mirror spec §7 / task_breakdown Wave-2 page folders.
//
// Wave 17: `/login` is PUBLIC (no AppShell). Everything else is wrapped in
// <ProtectedRoute> (auth gate) → <AppShell> (chrome). Future slots below.
export const router = createBrowserRouter([
  // Public — rendered outside the AppShell (no sidebar/nav).
  { path: '/login', element: <LoginPage /> },
  // Public `/403` — the curated Forbidden surface (the api layer throws
  // ForbiddenError on a 403). Rendered without the shell, like /login.
  { path: '/403', element: <ForbiddenPage /> },

  {
    element: <ProtectedRoute />,
    children: [
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
          // Admin-only user portal (UsersPage self-guards non-admins → Forbidden).
          { path: 'users', element: <UsersPage /> },
          // Catch-all 404 inside the shell.
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);
