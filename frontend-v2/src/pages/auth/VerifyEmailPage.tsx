import { type FormEvent, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { supabase } from "../../lib/supabase";

export function VerifyEmailPage() {
  const [params] = useSearchParams();
  const email = useMemo(() => params.get("email") ?? "", [params]);
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    if (!email || code.length !== 6) { setMessage("أدخل كود التحقق المكون من 6 أرقام"); return; }
    setBusy(true); setMessage("");
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "signup" });
    if (error) { setMessage(error.message); setBusy(false); return; }
    navigate("/overview", { replace: true });
  };

  const resend = async () => {
    if (!email || cooldown) return;
    const { error } = await supabase.auth.resend({ type: "signup", email });
    if (error) { setMessage(error.message); return; }
    setMessage("تم إرسال كود جديد إلى بريدك");
    setCooldown(60);
    const timer = window.setInterval(() => setCooldown(value => {
      if (value <= 1) { window.clearInterval(timer); return 0; }
      return value - 1;
    }), 1000);
  };

  return <div className="auth-content verify-page"><span className="eyebrow">VERIFY EMAIL</span><h1>تحقق من بريدك</h1><p>أرسلنا كودًا من 6 أرقام إلى:</p><strong className="verify-email-address">{email || "البريد غير متوفر"}</strong><form className="form-stack" onSubmit={verify}><label>Verification code<input className="otp-input" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" autoFocus /></label>{message && <div className="form-message">{message}</div>}<Button variant="primary" full disabled={busy || code.length !== 6}>{busy ? "جارٍ التحقق..." : "تفعيل الحساب"}</Button></form><div className="verify-actions"><button onClick={() => void resend()} disabled={!!cooldown}>{cooldown ? `إعادة الإرسال بعد ${cooldown}s` : "إعادة إرسال الكود"}</button><Link to="/register">تغيير البريد</Link></div></div>;
}
