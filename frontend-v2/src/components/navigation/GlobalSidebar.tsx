import { Activity, LayoutDashboard, Plus, Server, Settings, Share2 } from "lucide-react";
import { NavLink } from "react-router-dom";

const nav = [
  { to: "/overview", label: "نظرة عامة", sub: "Overview", icon: LayoutDashboard },
  { to: "/servers", label: "السيرفرات", sub: "All Servers", icon: Server },
  { to: "/servers/create", label: "إنشاء سيرفر", sub: "Create Server", icon: Plus },
  { to: "/shared", label: "مشتركة معي", sub: "Shared With Me", icon: Share2 },
  { to: "/activity", label: "سجل النشاط", sub: "Global Activity", icon: Activity },
];

export function GlobalSidebar() {
  return <aside className="sidebar">
    <div className="sidebar__label">GLOBAL</div>
    <nav>{nav.map(({ to, label, sub, icon: Icon }) => <NavLink key={to} to={to} className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}><Icon size={17} /><span><b>{label}</b><small>{sub}</small></span></NavLink>)}</nav>
    <div className="sidebar__bottom"><div className="sidebar__label">ACCOUNT</div><NavLink to="/account/profile" className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}><Settings size={17} /><span><b>الإعدادات</b><small>Account</small></span></NavLink></div>
  </aside>;
}
