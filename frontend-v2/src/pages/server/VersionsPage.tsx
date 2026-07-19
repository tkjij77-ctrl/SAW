import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { Badge } from "../../components/ui/Badge";
import { Card } from "../../components/ui/Card";
import { getServer } from "../../services/servers.service";

const versions = ["26.2", "26.1.2", "1.21.11", "1.21.10", "1.21.9", "1.21.8", "1.21.7", "1.21.6", "1.21.5", "1.21.4", "1.21.3", "1.21.1", "1.21", "1.20.6"];
export function VersionsPage() { const { serverId = "" } = useParams(); const { data } = useQuery({ queryKey: ["server", serverId], queryFn: () => getServer(serverId) }); return <div className="page"><header className="page-header"><div><span className="eyebrow">VERSION COMPATIBILITY</span><h1>إصدار Minecraft</h1><p>Installed core and supported provisioning catalog</p></div></header><div className="version-list">{versions.map((version) => <Card className="version-row" key={version}><div><strong>Minecraft {version}</strong><small>Purpur · Java {version.startsWith("26.") ? 25 : 21} · Java & Bedrock</small></div>{data?.minecraft_version === version ? <Badge tone="success">Installed</Badge> : <Badge tone="neutral">Supported for new servers</Badge>}</Card>)}</div><div className="warning-box">تغيير إصدار عالم موجود غير مفعّل حتى يتم بناء مسار Upgrade يجبر Backup ويفحص توافق Plugins. القائمة هنا ليست زرًا وهميًا ولا تسمح بـDowngrade خطر.</div></div>; }
