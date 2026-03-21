import { Routes, Route, Navigate } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { AuthGuard } from './components/AuthGuard';
import { AdminRoute } from './components/AdminRoute';
import { UserProvider } from './context/UserContext';
import { NavigationProvider } from './context/NavigationContext';
import { useNavigation } from './hooks/useNavigation';
import { Overview } from './pages/Overview';
import { Users } from './pages/auth/Users';
import { ModelKeys } from './pages/auth/ModelKeys';
import { ModelKeyDistribute } from './pages/auth/ModelKeyDistribute';
import { Skills } from './pages/skills/Skills';
import { SkillStats } from './pages/skills/SkillStats';
import { Assets } from './pages/evolution/Assets';
import { AssetDetail } from './pages/evolution/AssetDetail';
import { Nodes } from './pages/evolution/Nodes';
import { Pipeline } from './pages/evolution/Pipeline';
import { Leaderboard } from './pages/evolution/Leaderboard';
import { Releases } from './pages/update/Releases';
import { UpdateStats } from './pages/update/UpdateStats';
import { Insights } from './pages/telemetry/Insights';
import { Channels } from './pages/community/Channels';
import { Moderation } from './pages/community/Moderation';
import { Topics } from './pages/community/Topics';
import { PostDetail } from './pages/community/PostDetail';
import { PlatformValues } from './pages/platform/Values';
// Employee & Role Management
import { Employees } from './pages/employees/Employees';
import { OrgChart } from './pages/employees/OrgChart';
import { RoleTemplates } from './pages/roles/RoleTemplates';
import { RoleEditor } from './pages/roles/RoleEditor';
import { RoleCreate } from './pages/roles/RoleCreate';
import { RoleCreateWizard } from './pages/roles/RoleCreateWizard';
import { RoleAssign } from './pages/roles/RoleAssign';
import { SkillCatalog } from './pages/roles/SkillCatalog';
// Task Management
import { TaskBoard } from './pages/tasks/TaskBoard';
import { TaskDetail } from './pages/tasks/TaskDetail';
import { TaskCreate } from './pages/tasks/TaskCreate';
import { ExpenseQueue } from './pages/tasks/ExpenseQueue';
import { TaskStatsPage } from './pages/tasks/TaskStatsPage';
// Strategy Management
import { Strategy } from './pages/strategy/Strategy';
// A2A Gateway
import { AgentList } from './pages/a2a-agents/AgentList';
import { AgentDetail } from './pages/a2a-agents/AgentDetail';
// Meetings
import { MeetingList } from './pages/meetings/MeetingList';
import { MeetingDetail } from './pages/meetings/MeetingDetail';
import { MeetingCreate } from './pages/meetings/MeetingCreate';
import { MeetingLive } from './pages/meetings/MeetingLive';
import { AutoTriggers } from './pages/meetings/AutoTriggers';
// A2A Relay
import { RelayLog } from './pages/relay/RelayLog';
// Settings
import { Settings } from './pages/settings/Settings';
// Phase 1 new pages
import { CampaignCalendar } from './pages/campaigns/CampaignCalendar';
import { PipelineBoard } from './pages/pipeline/PipelineBoard';
import { Roadmap } from './pages/roadmap/Roadmap';
import { KPIDashboard } from './pages/kpi/KPIDashboard';

// ── AppShell ──────────────────────────────────────────────────────────────────
// Reads navigation context (must be a child of NavigationProvider) and
// renders the layout with the correct sidebar offset.

function AppShell() {
  const { activeCategory } = useNavigation();

  // Sidebar is hidden for 'overview' or when there are no visible items for
  // the current category. Mirror the hide logic from Sidebar.tsx so the
  // content margin stays in sync without coupling to Sidebar's internals.
  const noSidebar = activeCategory === 'overview';
  const sidebarWidth = noSidebar ? 0 : 256;

  return (
    <>
      {/* Fixed top bar */}
      <TopBar />

      {/* Fixed left sidebar (renders null when overview) */}
      <Sidebar />

      {/* Scrollable page content */}
      <main
        className="app-content"
        style={{
          position: 'fixed',
          top: '56px',
          left: `${sidebarWidth}px`,
          right: 0,
          bottom: 0,
          overflowY: 'auto',
          transition: 'left 0.2s',
        }}
      >
        <Routes>
          <Route path="/" element={<Overview />} />
          {/* Admin-only routes */}
          <Route path="/manage/users" element={<AdminRoute><Users /></AdminRoute>} />
          <Route path="/manage/model-keys" element={<AdminRoute><ModelKeys /></AdminRoute>} />
          <Route path="/manage/model-keys/distribute" element={<AdminRoute><ModelKeyDistribute /></AdminRoute>} />
          <Route path="/evolution/nodes" element={<AdminRoute><Nodes /></AdminRoute>} />
          <Route path="/evolution/pipeline" element={<AdminRoute><Pipeline /></AdminRoute>} />
          <Route path="/evolution/leaderboard" element={<Leaderboard />} />
          <Route path="/community/moderation" element={<AdminRoute><Moderation /></AdminRoute>} />
          {/* Employee & Role Management (admin) */}
          <Route path="/employees" element={<AdminRoute><Employees /></AdminRoute>} />
          <Route path="/employees/org" element={<AdminRoute><OrgChart /></AdminRoute>} />
          <Route path="/roles" element={<AdminRoute><RoleTemplates /></AdminRoute>} />
          <Route path="/roles/create" element={<AdminRoute><RoleCreate /></AdminRoute>} />
          <Route path="/roles/create-wizard" element={<AdminRoute><RoleCreateWizard /></AdminRoute>} />
          <Route path="/roles/skills" element={<AdminRoute><SkillCatalog /></AdminRoute>} />
          <Route path="/roles/:id" element={<AdminRoute><RoleEditor /></AdminRoute>} />
          <Route path="/roles/:id/assign" element={<AdminRoute><RoleAssign /></AdminRoute>} />
          {/* Task Management (admin) */}
          <Route path="/tasks" element={<AdminRoute><TaskBoard /></AdminRoute>} />
          <Route path="/tasks/create" element={<AdminRoute><TaskCreate /></AdminRoute>} />
          <Route path="/tasks/stats" element={<AdminRoute><TaskStatsPage /></AdminRoute>} />
          <Route path="/tasks/expenses" element={<AdminRoute><ExpenseQueue /></AdminRoute>} />
          <Route path="/tasks/:id" element={<AdminRoute><TaskDetail /></AdminRoute>} />
          {/* Strategy Management (admin) */}
          <Route path="/strategy" element={<AdminRoute><Strategy /></AdminRoute>} />
          {/* A2A Gateway (admin) */}
          <Route path="/a2a/agents" element={<AdminRoute><AgentList /></AdminRoute>} />
          <Route path="/a2a/agents/:nodeId" element={<AdminRoute><AgentDetail /></AdminRoute>} />
          {/* Meetings (admin) */}
          <Route path="/meetings" element={<AdminRoute><MeetingList /></AdminRoute>} />
          <Route path="/meetings/create" element={<AdminRoute><MeetingCreate /></AdminRoute>} />
          <Route path="/meetings/triggers" element={<AdminRoute><AutoTriggers /></AdminRoute>} />
          <Route path="/meetings/:id/live" element={<AdminRoute><MeetingLive /></AdminRoute>} />
          <Route path="/meetings/:id" element={<AdminRoute><MeetingDetail /></AdminRoute>} />
          {/* A2A Relay (admin) */}
          <Route path="/relay" element={<AdminRoute><RelayLog /></AdminRoute>} />
          {/* Phase 1 new pages (admin) */}
          <Route path="/campaigns" element={<AdminRoute><CampaignCalendar /></AdminRoute>} />
          <Route path="/pipeline" element={<AdminRoute><PipelineBoard /></AdminRoute>} />
          <Route path="/roadmap" element={<AdminRoute><Roadmap /></AdminRoute>} />
          <Route path="/kpi" element={<AdminRoute><KPIDashboard /></AdminRoute>} />
          {/* Regular authenticated routes */}
          <Route path="/skills" element={<Skills />} />
          <Route path="/skills/stats" element={<SkillStats />} />
          <Route path="/evolution/assets" element={<Assets />} />
          <Route path="/evolution/assets/:id" element={<AssetDetail />} />
          <Route path="/update/releases" element={<Releases />} />
          <Route path="/update/stats" element={<UpdateStats />} />
          <Route path="/telemetry" element={<Insights />} />
          <Route path="/community/channels" element={<Channels />} />
          <Route path="/community/topics" element={<Topics />} />
          <Route path="/community/topics/:id" element={<PostDetail />} />
          <Route path="/platform/values" element={<PlatformValues />} />
          {/* Settings (any authenticated user) */}
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

export function App() {
  return (
    <AuthGuard>
      <UserProvider>
        <NavigationProvider>
          <AppShell />
        </NavigationProvider>
      </UserProvider>
    </AuthGuard>
  );
}
