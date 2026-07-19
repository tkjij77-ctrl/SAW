import { Navigate, Route, Routes } from "react-router-dom";
import { DashboardLayout } from "../layouts/DashboardLayout";
import { ServerLayout } from "../layouts/ServerLayout";
import { AuthLayout } from "../layouts/AuthLayout";
import { AuthCallbackPage } from "../pages/auth/AuthCallbackPage";
import { ForgotPasswordPage } from "../pages/auth/ForgotPasswordPage";
import { LoginPage } from "../pages/auth/LoginPage";
import { RegisterPage } from "../pages/auth/RegisterPage";
import { ResetPasswordPage } from "../pages/auth/ResetPasswordPage";
import { VerifyEmailPage } from "../pages/auth/VerifyEmailPage";
import { OverviewPage } from "../pages/overview/OverviewPage";
import { CreateServerPage } from "../pages/servers/CreateServerPage";
import { ProvisioningPage } from "../pages/servers/ProvisioningPage";
import { ServersPage } from "../pages/servers/ServersPage";
import { ConsolePage } from "../pages/server/ConsolePage";
import { FilesPage } from "../pages/server/FilesPage";
import { ServerDashboardPage } from "../pages/server/ServerDashboardPage";
import { PlayersPage } from "../pages/server/PlayersPage";
import { BackupsPage } from "../pages/server/BackupsPage";
import { PluginsPage } from "../pages/server/PluginsPage";
import { NetworkPage } from "../pages/server/NetworkPage";
import { MembersPage } from "../pages/server/MembersPage";
import { AuditPage } from "../pages/server/AuditPage";
import { VersionsPage } from "../pages/server/VersionsPage";
import { WorldsPage } from "../pages/server/WorldsPage";
import { SchedulesPage } from "../pages/server/SchedulesPage";
import { DatabasesPage } from "../pages/server/DatabasesPage";
import { ServerSettingsPage } from "../pages/server/ServerSettingsPage";
import { ConnectionsPage } from "../pages/account/ConnectionsPage";
import { ChooseUsernamePage } from "../pages/account/ChooseUsernamePage";
import { ProfilePage } from "../pages/account/ProfilePage";
import { ActivityPage } from "../pages/ActivityPage";
import { LegalPage } from "../pages/LegalPage";
import { DiagnosticsPage } from "../pages/account/DiagnosticsPage";
import { ProtectedRoute } from "./ProtectedRoute";

export function AppRouter(){return <Routes>
  <Route element={<AuthLayout/>}>
    <Route path="/login" element={<LoginPage/>}/><Route path="/register" element={<RegisterPage/>}/><Route path="/verify-email" element={<VerifyEmailPage/>}/><Route path="/forgot-password" element={<ForgotPasswordPage/>}/><Route path="/reset-password" element={<ResetPasswordPage/>}/><Route path="/auth/callback" element={<AuthCallbackPage/>}/>
  </Route>
  <Route path="/privacy" element={<LegalPage/>}/><Route path="/terms" element={<LegalPage/>}/><Route path="/acceptable-use" element={<LegalPage/>}/>
  <Route element={<ProtectedRoute/>}>
    <Route element={<DashboardLayout/>}>
      <Route path="/overview" element={<OverviewPage/>}/><Route path="/servers" element={<ServersPage/>}/><Route path="/servers/create" element={<CreateServerPage/>}/><Route path="/servers/provision/:jobId" element={<ProvisioningPage/>}/><Route path="/shared" element={<ServersPage sharedOnly/>}/><Route path="/invitations" element={<Navigate to="/shared" replace/>}/><Route path="/activity" element={<ActivityPage/>}/><Route path="/account/choose-username" element={<ChooseUsernamePage/>}/><Route path="/account/profile" element={<ProfilePage/>}/><Route path="/account/security" element={<Navigate to="/account/profile" replace/>}/><Route path="/account/connections" element={<ConnectionsPage/>}/><Route path="/account/diagnostics" element={<DiagnosticsPage/>}/><Route path="/account/sessions" element={<Navigate to="/account/profile" replace/>}/><Route path="/account/notifications" element={<Navigate to="/account/profile" replace/>}/>
    </Route>
    <Route path="/servers/:serverId" element={<ServerLayout/>}>
      <Route path="dashboard" element={<ServerDashboardPage/>}/><Route path="console" element={<ConsolePage/>}/><Route path="files" element={<FilesPage/>}/><Route path="players" element={<PlayersPage/>}/><Route path="backups" element={<BackupsPage/>}/><Route path="plugins" element={<PluginsPage/>}/><Route path="mods" element={<PluginsPage mods/>}/><Route path="versions" element={<VersionsPage/>}/><Route path="worlds" element={<WorldsPage/>}/><Route path="network" element={<NetworkPage/>}/><Route path="schedules" element={<SchedulesPage/>}/><Route path="databases" element={<DatabasesPage/>}/><Route path="members" element={<MembersPage/>}/><Route path="audit" element={<AuditPage/>}/><Route path="settings" element={<ServerSettingsPage/>}/><Route index element={<Navigate to="dashboard" replace/>}/>
    </Route>
  </Route>
  <Route path="/" element={<Navigate to="/overview" replace/>}/><Route path="*" element={<Navigate to="/overview" replace/>}/>
</Routes>}
