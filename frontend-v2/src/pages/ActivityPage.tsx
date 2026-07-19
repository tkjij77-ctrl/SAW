import { useQuery } from "@tanstack/react-query";
import { Activity, RefreshCw } from "lucide-react";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { EmptyState, PageError, PageLoading } from "../components/ui/PageState";
import { supabase } from "../lib/supabase";

interface ActivityRow {
  id: number;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
  servers: { name?: string } | Array<{ name?: string }> | null;
  profiles: { username?: string } | Array<{ username?: string }> | null;
}

export function ActivityPage() {
  const query = useQuery({
    queryKey: ["global-activity"],
    queryFn: async () => {
      const { data, error } = await supabase.from("audit_logs")
        .select("id,action,details,created_at,servers(name),profiles(username)")
        .order("created_at", { ascending: false }).limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as ActivityRow[];
    },
  });
  if (query.isLoading) return <PageLoading />;
  if (query.error) return <PageError message={(query.error as Error).message} />;
  return <div className="page"><header className="page-header"><div><span className="eyebrow">GLOBAL AUDIT</span><h1>سجل النشاط</h1><p>آخر 100 عملية في السيرفرات التي يمكنك الوصول إليها</p></div><Button onClick={() => void query.refetch()} disabled={query.isFetching}><RefreshCw size={14} /> Refresh</Button></header>{query.data?.length ? <Card className="audit-list">{query.data.map((row) => { const server = Array.isArray(row.servers) ? row.servers[0] : row.servers; const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles; return <div className="audit-row" key={row.id}><Activity size={16} /><div><strong>{label(row.action)}</strong><small>{server?.name ?? "Server"} · {profile?.username ?? "system"} · {new Date(row.created_at).toLocaleString("ar-EG")}</small></div><Badge tone={tone(row.action)}>{row.action}</Badge></div>; })}</Card> : <EmptyState title="لا يوجد نشاط بعد" body="ستظهر هنا عمليات التشغيل والملفات والنسخ الاحتياطية والأعضاء." />}</div>;
}

function label(action: string) {
  const labels: Record<string, string> = { "server.provision": "إنشاء سيرفر", "agent.upgrade": "ترقية Agent", "member.grant": "إضافة عضو", "member.revoke": "إزالة عضو", "agent.backup_create": "إنشاء Backup", "agent.backup_restore": "استعادة Backup", "agent.backup_delete": "حذف Backup", "agent.plugin_install": "تثبيت Plugin" };
  return labels[action] ?? action.replace(/^agent\./, "").replaceAll("_", " ");
}
function tone(action: string): "success" | "warning" | "danger" | "info" | "neutral" { if (action.includes("delete") || action.includes("revoke")) return "danger"; if (action.includes("restore") || action.includes("restart")) return "warning"; if (action.includes("create") || action.includes("install") || action.includes("provision")) return "success"; return "info"; }
