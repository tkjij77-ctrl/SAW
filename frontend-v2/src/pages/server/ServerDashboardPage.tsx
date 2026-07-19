import { useQuery } from "@tanstack/react-query";
import { Cloud, Cpu, MemoryStick, Play, RotateCcw, Server as ServerIcon, Square, Users } from "lucide-react";
import { useParams } from "react-router-dom";
import { StatCard } from "../../components/server/StatCard";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { PageError, PageLoading } from "../../components/ui/PageState";
import { getServer, invokeAgent } from "../../services/servers.service";

export function ServerDashboardPage() {
  const { serverId = "" } = useParams();
  const serverQuery = useQuery({ queryKey:["server",serverId], queryFn:()=>getServer(serverId) });
  const statusQuery = useQuery({ queryKey:["agent-status",serverId], queryFn:async()=>({ status:await invokeAgent<{status:string}>(serverId,"status"), resources:await invokeAgent<{memory?:string;cpu?:number}>(serverId,"resources"), players:await invokeAgent<string[]>(serverId,"players") }), refetchInterval:5000, retry:1 });
  if(serverQuery.isLoading)return <PageLoading/>;
  if(serverQuery.error)return <PageError message={(serverQuery.error as Error).message}/>;
  const server=serverQuery.data!;const phase=statusQuery.data?.status.status??"offline";const connected=!statusQuery.isError;
  const action=async(name:string)=>{await invokeAgent(serverId,name);await statusQuery.refetch()};
  return <div className="page"><header className="server-page-header"><div><span className="eyebrow">SERVER INSTANCE</span><h1>{server.name}</h1><p className="mono">{server.hf_space_id}</p><div className="inline-badges"><Badge tone={connected?"success":"danger"}>{connected?"AGENT ONLINE":"AGENT OFFLINE"}</Badge><Badge tone="info">{server.minecraft_version}</Badge><Badge>{server.hardware}</Badge></div></div><div className="power-actions"><Button variant="primary" disabled={phase==="running"} onClick={()=>void action("start")}><Play size={15}/> تشغيل</Button><Button disabled={phase!=="running"} onClick={()=>void action("restart")}><RotateCcw size={15}/> Restart</Button><Button variant="danger" disabled={phase!=="running"} onClick={()=>void action("stop")}><Square size={15}/> إيقاف</Button></div></header><section className="stats-grid"><StatCard label="NODE / SPACE" value={server.provision_status.toUpperCase()} caption={server.hardware??"Hugging Face"} icon={Cloud}/><StatCard label="MINECRAFT" value={phase.toUpperCase()} caption={`Purpur ${server.minecraft_version}`} icon={ServerIcon}/><StatCard label="PLAYERS" value={statusQuery.data?.players.length??0} caption="Online now" icon={Users}/><StatCard label="JAVA MEMORY" value={statusQuery.data?.resources.memory??"—"} caption="Process usage" icon={MemoryStick}/></section><div className="dashboard-columns"><Card className="connections"><div className="card-head"><div><span className="eyebrow">CONNECTIONS</span><h2>عناوين الاتصال</h2></div></div><div className="connection-item"><span className="edition java">J</span><div><small>JAVA EDITION</small><strong>Waiting for Playit Agent...</strong></div><Button>Copy</Button></div><div className="connection-item"><span className="edition bedrock">B</span><div><small>BEDROCK EDITION</small><strong>UDP tunnel not detected</strong></div><Button>Copy</Button></div></Card><Card><div className="card-head"><div><span className="eyebrow">SERVICE HEALTH</span><h2>حالة المكونات</h2></div></div><div className="health-rows">{[["Hugging Face Space",true],["MC Agent",connected],["Minecraft Server",phase==="running"],["Java TCP Tunnel",false],["Bedrock UDP Tunnel",false]].map(([label,ok])=><div key={String(label)}><span>{label}</span><Badge tone={ok?"success":"neutral"}>{ok?"ONLINE":"UNKNOWN"}</Badge></div>)}</div></Card></div></div>;
}
