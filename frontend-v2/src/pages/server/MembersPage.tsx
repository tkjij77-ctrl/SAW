import { type FormEvent, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { supabase } from "../../lib/supabase";

interface MemberRow {
  user_id: string;
  role: string;
  profiles: { username?: string; display_name?: string } | Array<{ username?: string; display_name?: string }> | null;
}

export function MembersPage() {
  const { serverId = "" } = useParams();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["members", serverId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("server_members")
        .select("user_id,role,profiles!server_members_user_id_fkey(username,display_name)")
        .eq("server_id", serverId);
      if (error) throw error;
      return (data ?? []) as unknown as MemberRow[];
    },
  });

  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy("add");
    setMessage("");
    const form = event.currentTarget;
    const values = new FormData(form);
    const { error } = await supabase.rpc("grant_server_access", {
      p_server: serverId,
      p_username: String(values.get("username")),
      p_role: String(values.get("role")),
    });
    setBusy(null);
    setMessage(error?.message ?? "تم حفظ الصلاحية بنجاح");
    if (!error) {
      form.reset();
      await query.refetch();
    }
  };

  const remove = async (userId: string, username: string) => {
    if (!window.confirm(`إزالة ${username} من أعضاء السيرفر؟`)) return;
    setBusy(userId);
    setMessage("");
    const { error } = await supabase.rpc("revoke_server_access", {
      p_server: serverId,
      p_user: userId,
    });
    setBusy(null);
    setMessage(error?.message ?? "تمت إزالة العضو");
    if (!error) await query.refetch();
  };

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <span className="eyebrow">ACCESS CONTROL</span>
          <h1>الأعضاء والصلاحيات</h1>
          <p>Invite site users and assign restricted roles</p>
        </div>
      </header>
      <div className="members-layout">
        <Card>
          <form className="form-stack padded" onSubmit={add}>
            <h3>إضافة عضو</h3>
            <label>اسم المستخدم<input name="username" required minLength={3} maxLength={32} placeholder="friend_username" /></label>
            <label>الدور<select name="role" defaultValue="viewer"><option value="viewer">Viewer</option><option value="editor">Editor</option><option value="operator">Operator</option><option value="admin">Admin</option></select></label>
            {message && <div className="form-message">{message}</div>}
            <Button variant="primary" disabled={busy !== null}>{busy === "add" ? "جارٍ الحفظ..." : "حفظ الصلاحية"}</Button>
          </form>
        </Card>
        <Card className="members-list">
          <div className="card-head"><h2>Server members</h2><Badge>{query.data?.length ?? 0}</Badge></div>
          {query.isLoading && <div className="padded muted">جارٍ تحميل الأعضاء...</div>}
          {query.isError && <div className="padded form-error">تعذر تحميل الأعضاء.</div>}
          {query.data?.map((member) => {
            const profile = Array.isArray(member.profiles) ? member.profiles[0] : member.profiles;
            const username = profile?.username ?? member.user_id;
            return (
              <div className="member-item" key={member.user_id}>
                <span className="avatar">{username.slice(0, 2).toUpperCase()}</span>
                <div><strong>{username}</strong><small>{profile?.display_name}</small></div>
                <Badge tone="info">{member.role}</Badge>
                <Button variant="danger" disabled={busy !== null} onClick={() => void remove(member.user_id, username)}>
                  {busy === member.user_id ? "Removing..." : "Remove"}
                </Button>
              </div>
            );
          })}
        </Card>
      </div>
    </div>
  );
}
