import { useQuery } from "@tanstack/react-query";
import { FolderOpen, Globe2, RefreshCw, ShieldCheck } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState, PageError, PageLoading } from "../../components/ui/PageState";
import { listFiles } from "../../services/files.service";

export function WorldsPage() {
  const { serverId = "" } = useParams();
  const query = useQuery({ queryKey: ["worlds", serverId], queryFn: () => listFiles(serverId, ""), retry: 1 });
  if (query.isLoading) return <PageLoading />;
  if (query.error) return <PageError message={(query.error as Error).message} />;
  const worlds = (query.data?.folders ?? []).filter((item) => /^world(?:_|$)/i.test(item.name));
  return <div className="page"><header className="page-header"><div><span className="eyebrow">WORLD DETECTION</span><h1>العوالم</h1><p>Detected Minecraft world directories</p></div><Button onClick={() => void query.refetch()}><RefreshCw size={14} /> Refresh</Button></header><Card className="form-message"><ShieldCheck size={15} /> تنزيل واستعادة عالم كامل يتمان من صفحة Backups باستخدام Dataset وSHA-256، بدل نقل مجلد غير متسق أثناء عمل السيرفر.</Card>{worlds.length ? <div className="world-grid">{worlds.map((world) => <Card className="world-card" key={world.name}><Globe2 /><div><strong>{world.name}</strong><small>Detected world folder</small></div><Link to={`/servers/${serverId}/files`}><Button><FolderOpen size={14} /> Open Files</Button></Link></Card>)}</div> : <EmptyState title="لم يتم اكتشاف عالم" body="شغّل السيرفر مرة واحدة لإنشاء مجلدات العالم." />}</div>;
}
