import { useQuery } from "@tanstack/react-query";
import { Cable, Copy, ExternalLink, Radio, RefreshCw, Smartphone } from "lucide-react";
import { useParams } from "react-router-dom";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { invokeAgent } from "../../services/servers.service";

export function NetworkPage() {
  const { serverId = "" } = useParams();
  const logs = useQuery({ queryKey: ["network-logs", serverId], queryFn: () => invokeAgent<string>(serverId, "logs"), refetchInterval: 5000 });
  const text = logs.data ?? "";
  const javaMatches = [...text.matchAll(/(?:found minecraft java tunnel:|\[PLAYIT-JAVA\].*?(?:ready:|ready\s))\s*(?:https?:\/\/)?([a-z0-9.-]+(?::\d+)?)/gi)];
  const bedrockMatches = [...text.matchAll(/\[PLAYIT-BEDROCK\][^\n]*?(?:ready:|ready\s)(?:https?:\/\/)?([a-z0-9.-]+:\d+)/gi)];
  const java = javaMatches.at(-1)?.[1];
  const bedrock = bedrockMatches.at(-1)?.[1];
  const geyserReady = /Started Geyser on UDP port 19132/i.test(text);
  const programAgent = /\[PLAYIT-AGENT\] started PID=/i.test(text) || /\[PLAYIT-HANDOFF\] Program Agent is online/i.test(text);
  const handoffWaiting = /generate claim code|playit\.gg\/claim\//i.test(text) && !programAgent;
  return <div className="page"><header className="page-header"><div><span className="eyebrow">JAVA TCP + BEDROCK UDP</span><h1>الشبكة</h1><p>Geyser, Floodgate and Playit Program Agent</p></div><Button onClick={() => void logs.refetch()}><RefreshCw size={15} /> Refresh</Button></header><div className="network-grid"><Endpoint title="Java Edition" protocol="TCP 25565" value={java} /><Endpoint title="Bedrock Edition" protocol="UDP 19132" value={bedrock} /><Card className="network-agent"><Radio /><div><span className="eyebrow">PLAYIT PROGRAM AGENT</span><h3>{programAgent ? "Program Agent Online" : handoffWaiting ? "Complete Playit Claim" : "Waiting"}</h3><p>{programAgent ? "TCP/UDP agent online; SAW creates or reuses the Bedrock tunnel automatically." : "After one Playit claim, SAW performs the handoff and tunnel creation automatically."}</p></div><Badge tone={programAgent ? "success" : "warning"}>{programAgent ? "TCP + UDP" : "WAITING"}</Badge></Card></div><Card className="connection-setting"><span className="service-logo"><Smartphone /></span><div><h3>Bedrock tunnel setup</h3><p>{geyserReady ? "Geyser is listening correctly on UDP 19132." : "Start the server and wait for Geyser UDP 19132."} {programAgent ? (bedrock ? "Automatic Bedrock allocation detected and ready." : "Automatic Bedrock creation is in progress. Use the dashboard only if the log reports a fallback.") : "Complete the one-time Playit claim and SAW will create/reuse both tunnels."}</p></div><a className="button button--primary" href="https://playit.gg/account/tunnels" target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open Playit Tunnels</a></Card></div>;
}
function Endpoint({ title, protocol, value }: { title: string; protocol: string; value?: string }) { return <Card className="network-endpoint"><span className="edition java"><Cable /></span><div><span className="eyebrow">{protocol}</span><h3>{title}</h3><p className="mono">{value || "Tunnel not detected"}</p></div><Badge tone={value ? "success" : "neutral"}>{value ? "ONLINE" : "UNKNOWN"}</Badge><Button disabled={!value} onClick={() => value && navigator.clipboard.writeText(value)}><Copy size={14} /> Copy</Button></Card>; }
