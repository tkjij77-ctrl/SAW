import { Bell, ChevronDown, HeartPulse, LogOut, Search, Settings, Unplug } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";
import { signOut } from "../../services/auth.service";
import { Brand } from "./Brand";

export function Topbar() {
  const [open, setOpen] = useState(false);
  const { profile } = useAuth();
  const navigate = useNavigate();
  const username = profile?.username ?? "user";

  const logout = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  return <header className="topbar">
    <Brand />
    <div className="topbar__actions">
      <button className="icon-button" aria-label="Search servers" title="Search servers" onClick={() => navigate("/servers")}><Search size={17} /></button>
      <button className="icon-button notification" aria-label="Recent activity" title="Recent activity" onClick={() => navigate("/activity")}><Bell size={17} /></button>
      <div className="profile-menu">
        <button className="profile-trigger" onClick={() => setOpen(v => !v)}>
          <span className="avatar">{username.slice(0, 2).toUpperCase()}</span>
          <span><strong>{username}</strong><small>SAW Account</small></span>
          <ChevronDown size={14} />
        </button>
        {open && <div className="profile-dropdown">
          <button onClick={() => { navigate("/account/connections"); setOpen(false); }}><Unplug size={15} /> Connections</button>
          <button onClick={() => { navigate("/account/profile"); setOpen(false); }}><Settings size={15} /> Account Settings</button>
          <button onClick={() => { navigate("/account/diagnostics"); setOpen(false); }}><HeartPulse size={15} /> Diagnostics</button>
          <hr />
          <button className="danger" onClick={logout}><LogOut size={15} /> خروج</button>
        </div>}
      </div>
    </div>
  </header>;
}
