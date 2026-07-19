import { useQuery } from "@tanstack/react-query";
import { Activity, Database, LoaderCircle, Play, Server as ServerIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { ServerCard } from "../../components/server/ServerCard";
import { StatCard } from "../../components/server/StatCard";
import { Button } from "../../components/ui/Button";
import { EmptyState, PageError, PageLoading } from "../../components/ui/PageState";
import { useAuth } from "../../contexts/AuthContext";
import { supabase } from "../../lib/supabase";
import { listServers } from "../../services/servers.service";

interface RecentActivity { id: number; action: string; created_at: string; servers: { name?: string } | Array<{ name?: string }> | null; }
export function OverviewPage() {
  const { profile } = useAuth();
  const query = useQuery({ queryKey: ["servers"], queryFn: listServers });
  const activity = useQuery({ queryKey: ["overview-activity"], queryFn: async () => { const { data, error } = await supabase.from("audit_logs").select("id,action,created_at,servers(name)").order("created_at", { ascending: false }).limit(5); if (error) throw error; return (data ?? []) as unknown as RecentActivity[]; } });
  if (query.isLoading) return <PageLoading />;
  if (query.error) return <PageError message={(query.error as Error).message} retry={() => void query.refetch()} />;
  const servers = query.data ?? [];
  const running = servers.filter((server) => server.provision_status === "running").length;
  const building = servers.filter((server) => !["running", "failed", "manual"].includes(server.provision_status)).length;
  const datasets = servers.filter((server) => Boolean(server.dataset_repo_id)).length;
  return <div className="page"><header className="page-header"><div><span className="eyebrow">HOSTING OVERVIEW</span><h1>مرحبًا، {profile?.display_name || profile?.username}</h1><p>إليك حالة Minecraft servers الخاصة بك.</p></div><Link to="/servers/create"><Button variant="primary">＋ Create Server</Button></Link></header><section className="stats-grid"><StatCard label="TOTAL SERVERS" value={servers.length} caption="Accessible instances" icon={ServerIcon} /><StatCard label="RUNNING" value={running} caption="Reported by provisioning" icon={Play} /><StatCard label="BUILDING" value={building} caption="Provisioning jobs" icon={LoaderCircle} /><StatCard label="DATASETS" value={datasets} caption="Private backup repos" icon={Database} /></section><section className="section-head"><div><h2>السيرفرات الأخيرة</h2><p>Quick access to your Minecraft instances</p></div><Link to="/servers">عرض الكل</Link></section>{servers.length ? <div className="server-grid">{servers.slice(0, 4).map((server) => <ServerCard key={server.id} server={server} />)}</div> : <EmptyState title="لا توجد سيرفرات بعد" body="أنشئ Private ZeroGPU Space وDataset تلقائيًا." action={<Link to="/servers/create"><Button variant="primary">Create Your First Server</Button></Link>} />}<section className="activity-preview card"><div className="section-head"><div><h2>آخر النشاطات</h2><p>Recent account and server events</p></div><Link to="/activity"><Activity size={18} /></Link></div>{activity.data?.length ? activity.data.map((row) => { const server = Array.isArray(row.servers) ? row.servers[0] : row.servers; return <div className="connection-item" key={row.id}><span className="service-logo"><Activity size={15} /></span><div><strong>{row.action}</strong><small>{server?.name ?? "Server"} · {new Date(row.created_at).toLocaleString("ar-EG")}</small></div></div>; }) : <div className="empty-inline">لا يوجد نشاط حديث.</div>}</section></div>;
}
