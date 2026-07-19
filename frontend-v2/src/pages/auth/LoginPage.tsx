import { Github } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { signInWithEmail, signInWithProvider } from "../../services/auth.service";

export function LoginPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    try { await signInWithEmail(String(form.get("email")), String(form.get("password"))); navigate("/overview"); }
    catch (e) { setError(e instanceof Error ? e.message : "Login failed"); }
    finally { setBusy(false); }
  };

  return <div className="auth-content"><span className="eyebrow">WELCOME BACK</span><h1>تسجيل الدخول</h1><p>ادخل لإدارة Minecraft servers الخاصة بك.</p><div className="social-grid social-grid--single"><Button onClick={() => void signInWithProvider("github")}><Github size={17} /> Continue with GitHub</Button></div><div className="or"><span>أو بالبريد</span></div><form className="form-stack" onSubmit={submit}><label>البريد الإلكتروني<input name="email" type="email" required autoComplete="email" /></label><label>كلمة المرور<input name="password" type="password" required autoComplete="current-password" /></label>{error && <div className="form-error">{error}</div>}<Button variant="primary" full disabled={busy}>{busy ? "جارٍ الدخول..." : "دخول"}</Button></form><div className="auth-links"><Link to="/forgot-password">نسيت كلمة المرور؟</Link><Link to="/register">إنشاء حساب جديد</Link></div></div>;
}
