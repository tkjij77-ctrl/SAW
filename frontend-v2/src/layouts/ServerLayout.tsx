import { Outlet } from "react-router-dom";
import { Topbar } from "../components/navigation/Topbar";
import { ServerSidebar } from "../components/navigation/ServerSidebar";

export function ServerLayout() {
  return <div className="app-shell"><Topbar /><div className="app-body"><ServerSidebar /><main className="main-content"><Outlet /></main></div></div>;
}
