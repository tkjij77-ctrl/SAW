import { Github } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { signInWithProvider, signUpWithEmail } from "../../services/auth.service";

export function RegisterPage() {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [message, setMessage] = useState("");

  const githubSignup = async () => {
    if (!accepted) { setMessage("يجب الموافقة على الشروط وسياسة الاستخدام."); return; }
    localStorage.setItem("saw_terms_pending", "2026-07-17");
    setBusy(true);
    try { await signInWithProvider("github"); }
    catch (error) { localStorage.removeItem("saw_terms_pending"); setMessage(error instanceof Error ? error.message : "GitHub signup failed"); setBusy(false); }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setMessage("");
    if (!accepted) { setMessage("يجب الموافقة على الشروط وسياسة الاستخدام."); setBusy(false); return; }
    const form = new FormData(event.currentTarget);
    const username = String(form.get("username")).toLowerCase();
    if (!/^[a-z0-9_.-]{3,32}$/.test(username)) { setMessage("اسم المستخدم يجب أن يكون 3-32 حرفًا إنجليزيًا أو رقمًا"); setBusy(false); return; }
    try {
      const email = String(form.get("email"));
      const result = await signUpWithEmail(email, String(form.get("password")), username);
      if (result.session) navigate("/overview", { replace: true });
      else navigate(`/verify-email?email=${encodeURIComponent(email)}`, { replace: true });
    }
    catch (e) { setMessage(e instanceof Error ? e.message : "Registration failed"); }
    finally { setBusy(false); }
  };

  return <div className="auth-content"><span className="eyebrow">CREATE ACCOUNT</span><h1>ابدأ الاستضافة</h1><p>أنشئ حساب SAW ثم اربط Hugging Face.</p><label className="check-row legal-consent"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /> أوافق على <Link to="/terms">الشروط</Link> و<Link to="/privacy">الخصوصية</Link> و<Link to="/acceptable-use">الاستخدام المقبول</Link></label><div className="social-grid social-grid--single"><Button disabled={!accepted || busy} onClick={() => void githubSignup()}><Github size={17} /> Continue with GitHub</Button></div><div className="or"><span>أو بالبريد</span></div><form className="form-stack" onSubmit={submit}><label>اسم المستخدم<input name="username" required autoComplete="username" /></label><label>البريد الإلكتروني<input name="email" type="email" required autoComplete="email" /></label><label>كلمة المرور<input name="password" type="password" minLength={10} required autoComplete="new-password" /></label>{message && <div className="form-message">{message}</div>}<Button variant="primary" full disabled={busy || !accepted}>{busy ? "جارٍ الإنشاء..." : "إنشاء الحساب"}</Button></form><div className="auth-links"><Link to="/login">لديك حساب؟ تسجيل الدخول</Link></div></div>;
}
