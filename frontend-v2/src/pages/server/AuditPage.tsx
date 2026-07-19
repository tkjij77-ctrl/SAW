import { useQuery } from "@tanstack/react-query";
import { Activity, Download, RefreshCw } from "lucide-react";
import { useParams } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { supabase } from "../../lib/supabase";

interface AuditRow { action: string; details: Record<string, unknown>; created_at: string; profiles: { username?: string } | Array<{ username?: string }> | null; }
export function AuditPage() {
  const { serverId = "" } = useParams();
  const query = useQuery({ queryKey: ["audit", serverId], queryFn: async () => { const { data, error } = await supabase.from("audit_logs").select("action,details,created_at,profiles!audit_logs_user_id_fkey(username)").eq("server_id", serverId).order("created_at", { ascending: false }).limit(200); if (error) throw error; return (data ?? []) as unknown as AuditRow[]; } });
  const exportLog = () => { const rows = query.data ?? []; const csv = ["time,user,action,details", ...rows.map((row) => [row.created_at, username(row), row.action, JSON.stringify(row.details)].map(csvCell).join(","))].join("\n"); const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `saw-audit-${serverId}.csv`; anchor.click(); URL.revokeObjectURL(url); };
  return <div className="page"><header className="page-header"><div><span className="eyebrow">AUDIT LOG</span><h1>سجل السيرفر</h1><p>Transparent history of sensitive operations</p></div><div className="power-actions"><Button onClick={() => void query.refetch()}><RefreshCw size={14} /> Refresh</Button><Button disabled={!query.data?.length} onClick={exportLog}><Download size={14} /> Export CSV</Button></div></header><Card className="audit-table"><div className="audit-head"><span>TIME</span><span>USER</span><span>ACTION</span><span>DETAILS</span></div>{query.data?.map((row, index) => <div className="audit-line" key={`${row.created_at}-${index}`}><span>{new Date(row.created_at).toLocaleString("ar-EG")}</span><strong>{username(row)}</strong><code>{row.action}</code><span>{JSON.stringify(row.details)}</span></div>)}{!query.data?.length && <div className="page-state"><Activity /><p>لا يوجد نشاط مسجل.</p></div>}</Card></div>;
}
function username(row: AuditRow) { const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles; return profile?.username ?? "system"; }
function csvCell(value: unknown) { const raw = String(value ?? ""); const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw; return `"${safe.replaceAll('"', '""')}"`; }
