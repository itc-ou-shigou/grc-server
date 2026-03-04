import { Routes, Route, Navigate } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { AuthGuard } from './components/AuthGuard';
import { AdminRoute } from './components/AdminRoute';
import { UserProvider } from './context/UserContext';
import { Overview } from './pages/Overview';
import { Users } from './pages/auth/Users';
import { ApiKeys } from './pages/auth/ApiKeys';
import { Skills } from './pages/skills/Skills';
import { SkillStats } from './pages/skills/SkillStats';
import { Assets } from './pages/evolution/Assets';
import { AssetDetail } from './pages/evolution/AssetDetail';
import { Nodes } from './pages/evolution/Nodes';
import { Pipeline } from './pages/evolution/Pipeline';
import { Releases } from './pages/update/Releases';
import { UpdateStats } from './pages/update/UpdateStats';
import { Insights } from './pages/telemetry/Insights';
import { Channels } from './pages/community/Channels';
import { Moderation } from './pages/community/Moderation';
import { Topics } from './pages/community/Topics';
import { PostDetail } from './pages/community/PostDetail';
import { PlatformValues } from './pages/platform/Values';

export function App() {
  return (
    <AuthGuard>
      <UserProvider>
        <div className="app-layout">
          <Sidebar />
          <main className="app-content">
            <Routes>
              <Route path="/" element={<Overview />} />
              {/* Admin-only routes */}
              <Route path="/manage/users" element={<AdminRoute><Users /></AdminRoute>} />
              <Route path="/manage/apikeys" element={<AdminRoute><ApiKeys /></AdminRoute>} />
              <Route path="/evolution/nodes" element={<AdminRoute><Nodes /></AdminRoute>} />
              <Route path="/evolution/pipeline" element={<AdminRoute><Pipeline /></AdminRoute>} />
              <Route path="/community/moderation" element={<AdminRoute><Moderation /></AdminRoute>} />
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
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </UserProvider>
    </AuthGuard>
  );
}
