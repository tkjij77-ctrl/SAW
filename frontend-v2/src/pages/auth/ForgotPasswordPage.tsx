import { type FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { env } from "../../lib/env";
import { supabase } from "../../lib/supabase";

export function ForgotPasswordPage() {
  const [message, setMessage] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const { error } = await supabase.auth.resetPasswordForEmail(String(form.get("email")), { redirectTo: `${env.siteUrl}#/reset-password` });
    setMessage(error?.message ?? "تم إرسال رابط الاستعادة إذا كان البريد مسجلًا.");
  };
  return <div className="auth-content"><span className="eyebrow">ACCOUNT RECOVERY</span><h1>استعادة كلمة المرور</h1><form className="form-stack" onSubmit={submit}><label>البريد الإلكتروني<input name="email" type="email" required /></label><Button variant="primary" full>إرسال رابط الاستعادة</Button></form>{message && <div className="form-message">{message}</div>}<div className="auth-links"><Link to="/login">العودة للدخول</Link></div></div>;
}
