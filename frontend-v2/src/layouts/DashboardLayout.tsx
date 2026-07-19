import { Outlet } from "react-router-dom";
import { GlobalSidebar } from "../components/navigation/GlobalSidebar";
import { Topbar } from "../components/navigation/Topbar";

export function DashboardLayout() {
  return <div className="app-shell"><Topbar /><div className="app-body"><GlobalSidebar /><main className="main-content"><Outlet /></main></div></div>;
}
