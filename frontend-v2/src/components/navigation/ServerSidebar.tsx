import { Activity, Boxes, Cable, Database, FileText, Gauge, HardDriveDownload, PlugZap, ScrollText, Settings, Terminal, Timer, UserCog, Users, Workflow } from "lucide-react";
import { NavLink, useParams } from "react-router-dom";

const items = [
  ["dashboard", "Dashboard", "Overview", Gauge],
  ["console", "Console", "Live Terminal", Terminal],
  ["files", "الملفات", "File Manager", FileText],
  ["players", "اللاعبون", "Players", Users],
  ["backups", "النسخ", "Backups", HardDriveDownload],
  ["plugins", "الإضافات", "Plugins", PlugZap],
  ["mods", "المودات", "Mods", Boxes],
  ["versions", "الإصدارات", "Version Manager", Workflow],
  ["worlds", "العوالم", "Worlds", Database],
  ["network", "الشبكة", "Network", Cable],
  ["schedules", "الجدولة", "Schedules", Timer],
  ["databases", "قواعد البيانات", "Databases", Database],
  ["members", "الأعضاء", "Access Control", UserCog],
  ["audit", "سجل السيرفر", "Audit Log", ScrollText],
  ["settings", "الإعدادات", "Server Settings", Settings],
] as const;

export function ServerSidebar() {
  const { serverId } = useParams();
  return <aside className="sidebar server-sidebar"><div className="server-switcher"><span className="block-icon small" /><span><b>Selected Server</b><small>{serverId?.slice(0, 8)}</small></span></div><div className="sidebar__label">SERVER</div><nav>{items.map(([path, label, sub, Icon]) => <NavLink key={path} to={`/servers/${serverId}/${path}`} className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}><Icon size={17} /><span><b>{label}</b><small>{sub}</small></span></NavLink>)}</nav></aside>;
}
