import { type FormEvent, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";
import { deleteAccount, updatePassword } from "../../services/account.service";

export function ProfilePage() {
  const { profile, user, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const displayName = String(form.get("display_name") || "").trim().slice(0, 80);
    const { error } = await supabase.from("profiles").update({ display_name: displayName }).eq("id", user!.id);
    setMessage(error?.message ?? "تم حفظ الملف الشخصي");
    if (!error) await refreshProfile();
    setBusy(false);
  };

  const password = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setMessage("");
    const form = event.currentTarget;
    const values = new FormData(form);
    const next = String(values.get("password") || "");
    const confirm = String(values.get("confirm_password") || "");
    if (next.length < 10) { setMessage("كلمة المرور يجب ألا تقل عن 10 أحرف."); setBusy(false); return; }
    if (next !== confirm) { setMessage("تأكيد كلمة المرور غير مطابق."); setBusy(false); return; }
    try { await updatePassword(next); form.reset(); setMessage("تم تغيير كلمة المرور."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Password update failed"); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    const confirmation = window.prompt("لحذف حسابك نهائيًا اكتب DELETE. يجب حذف كل السيرفرات المملوكة أولًا.");
    if (confirmation === null) return;
    if (confirmation !== "DELETE") { setMessage("كلمة التأكيد غير صحيحة."); return; }
    if (!window.confirm("سيتم حذف حساب SAW وملفك وصلاحياتك نهائيًا. متابعة؟")) return;
    setBusy(true); setMessage("");
    try { await deleteAccount(confirmation); navigate("/login", { replace: true }); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Account deletion failed"); }
    finally { setBusy(false); }
  };

  return <div className="page narrow-page"><header className="page-header"><div><span className="eyebrow">ACCOUNT</span><h1>الملف الشخصي والأمان</h1><p>Manage your SAW identity and credentials</p></div></header>{message && <div className="form-message">{message}</div>}<div className="settings-stack"><Card><form className="form-stack padded" onSubmit={save}><h3>Profile</h3><label>اسم المستخدم<input value={profile?.username ?? ""} disabled /></label><label>الاسم الظاهر<input name="display_name" maxLength={80} defaultValue={profile?.display_name ?? ""} /></label><label>البريد<input value={user?.email ?? ""} disabled /></label><Button variant="primary" disabled={busy}>حفظ التغييرات</Button></form></Card><Card><form className="form-stack padded" onSubmit={password}><h3>Change Password</h3><label>كلمة المرور الجديدة<input name="password" type="password" minLength={10} autoComplete="new-password" required /></label><label>تأكيد كلمة المرور<input name="confirm_password" type="password" minLength={10} autoComplete="new-password" required /></label><Button disabled={busy}>تغيير كلمة المرور</Button></form></Card><Card className="padded"><h3>Legal & Privacy</h3><div className="auth-links"><Link to="/privacy">سياسة الخصوصية</Link><Link to="/terms">شروط الاستخدام</Link><Link to="/acceptable-use">الاستخدام المقبول</Link></div></Card><Card className="padded danger-zone"><h3>Delete Account</h3><p>احذف كل السيرفرات التي تملكها أولًا. حذف الحساب نهائي ولا يمكن التراجع عنه.</p><Button type="button" variant="danger" disabled={busy} onClick={() => void remove()}>حذف الحساب نهائيًا</Button></Card></div></div>;
}
