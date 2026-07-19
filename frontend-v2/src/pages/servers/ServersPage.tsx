import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ServerCard } from "../../components/server/ServerCard";
import { Button } from "../../components/ui/Button";
import { EmptyState, PageError, PageLoading } from "../../components/ui/PageState";
import { listServers } from "../../services/servers.service";

export function ServersPage({ sharedOnly = false }: { sharedOnly?: boolean }) {
  const [search, setSearch] = useState("");
  const query = useQuery({ queryKey: ["servers"], queryFn: listServers });
  const servers = useMemo(() => (query.data ?? []).filter(s => (!sharedOnly || s.source === "shared") && `${s.name} ${s.hf_space_id}`.toLowerCase().includes(search.toLowerCase())), [query.data, search, sharedOnly]);
  if (query.isLoading) return <PageLoading />;
  if (query.error) return <PageError message={(query.error as Error).message} retry={() => void query.refetch()} />;
  return <div className="page"><header className="page-header"><div><span className="eyebrow">SERVER MANAGEMENT</span><h1>{sharedOnly ? "مشتركة معي" : "السيرفرات"}</h1><p>{sharedOnly ? "Servers shared with your SAW account" : "Create, filter and manage all instances"}</p></div><Link to="/servers/create"><Button variant="primary">＋ Create Server</Button></Link></header><div className="toolbar"><label className="search-box"><Search size={16} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search servers..." /></label><div className="toolbar__spacer" /><Button onClick={() => void query.refetch()} disabled={query.isFetching}><RefreshCw size={14} /> Refresh</Button></div>{servers.length ? <div className="server-grid">{servers.map(server => <ServerCard key={server.id} server={server} />)}</div> : <EmptyState title={sharedOnly ? "لا توجد سيرفرات مشتركة" : "لا توجد نتائج"} body="غيّر البحث أو أنشئ سيرفرًا جديدًا." />}</div>;
}
