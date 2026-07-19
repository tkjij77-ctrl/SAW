import { Link, Outlet } from "react-router-dom";
import { Brand } from "../components/navigation/Brand";

export function AuthLayout() {
  return <main className="auth-layout"><div className="auth-page-stack"><div className="auth-shell"><section className="auth-panel"><Brand /><Outlet /></section><aside className="auth-visual"><div className="auth-cube" /><h2>استضافة Minecraft من مكان واحد</h2><p>Java وBedrock وConsole وملفات ونسخ احتياطية في لوحة احترافية.</p></aside></div><footer className="auth-legal"><span>SAW MC Hosting Public Beta</span><Link to="/privacy">الخصوصية</Link><Link to="/terms">الشروط</Link><Link to="/acceptable-use">الاستخدام المقبول</Link></footer></div></main>;
}
