import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";

export function ChooseUsernamePage() {
  const { user, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const username = String(form.get("username")).trim().toLowerCase();
    if (!/^[a-z0-9_.-]{3,32}$/.test(username)) {
      setError("استخدم 3-32 حرفًا إنجليزيًا أو رقمًا أو . _ -");
      return;
    }
    setBusy(true); setError("");
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ username, display_name: username, username_completed: true })
      .eq("id", user!.id);
    if (updateError) { setError(updateError.code === "23505" ? "اسم المستخدم مستخدم بالفعل" : updateError.message); setBusy(false); return; }
    await refreshProfile();
    navigate("/overview", { replace: true });
  };

  return <div className="page narrow-page username-setup"><header className="page-header"><div><span className="eyebrow">ONE LAST STEP</span><h1>اختر اسم المستخدم</h1><p>سيستخدمه أصدقاؤك لإضافتك إلى السيرفرات والصلاحيات.</p></div></header><Card><form className="form-stack padded" onSubmit={submit}><label>SAW Username<input name="username" required autoFocus placeholder="minecraft_player" /></label><small className="muted">لا يمكن تغييره كثيرًا، اختره بعناية.</small>{error && <div className="form-error">{error}</div>}<Button variant="primary" disabled={busy}>{busy ? "جارٍ الحفظ..." : "حفظ والمتابعة"}</Button></form></Card></div>;
}
