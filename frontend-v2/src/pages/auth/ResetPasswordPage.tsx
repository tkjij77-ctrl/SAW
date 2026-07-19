import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { supabase } from "../../lib/supabase";

export function ResetPasswordPage() {
  const navigate = useNavigate(); const [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    const { error: updateError } = await supabase.auth.updateUser({ password: String(form.get("password")) });
    if (updateError) setError(updateError.message); else navigate("/overview");
  };
  return <div className="auth-content"><span className="eyebrow">NEW PASSWORD</span><h1>كلمة مرور جديدة</h1><form className="form-stack" onSubmit={submit}><label>كلمة المرور<input name="password" type="password" minLength={8} required /></label>{error && <div className="form-error">{error}</div>}<Button variant="primary" full>حفظ كلمة المرور</Button></form></div>;
}
