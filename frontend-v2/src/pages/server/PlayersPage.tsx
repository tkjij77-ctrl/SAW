import { useQuery } from "@tanstack/react-query";
import { MessageSquare, RefreshCw, ShieldBan, UserCog } from "lucide-react";
import { useState } from "react";
import { useParams } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { EmptyState, PageError, PageLoading } from "../../components/ui/PageState";
import { invokeAgent } from "../../services/servers.service";

export function PlayersPage() {
  const { serverId = "" } = useParams();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const query = useQuery({ queryKey: ["players", serverId], queryFn: () => invokeAgent<string[]>(serverId, "players"), refetchInterval: 5000 });
  if (query.isLoading) return <PageLoading />;
  if (query.error) return <PageError message={(query.error as Error).message} />;
  const players = query.data ?? [];

  const command = async (player: string, value: string, success: string) => {
    setBusy(player); setMessage("");
    try { await invokeAgent(serverId, "command", { command: value }); setMessage(success); await query.refetch(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Command failed"); }
    finally { setBusy(null); }
  };
  const tell = (player: string) => { const text = window.prompt(`رسالة خاصة إلى ${player}`); if (text?.trim()) void command(player, `tell ${player} ${text.trim()}`, "تم إرسال الرسالة."); };
  const op = (player: string) => { if (window.confirm(`منح ${player} صلاحية Minecraft Operator؟`)) void command(player, `op ${player}`, `تم منح ${player} صلاحية OP.`); };
  const remove = (player: string) => { const reason = window.prompt(`سبب طرد ${player}`, "Removed by server administrator"); if (reason !== null) void command(player, `kick ${player} ${reason || "Removed by administrator"}`, `تم طرد ${player}.`); };

  return <div className="page"><header className="page-header"><div><span className="eyebrow">PLAYER MANAGEMENT</span><h1>اللاعبون</h1><p>{players.length} players online</p></div><Button onClick={() => void query.refetch()}><RefreshCw size={15} /> Refresh</Button></header>{message && <div className="form-message">{message}</div>}{players.length ? <div className="player-cards">{players.map((name) => <Card className="player-management-card" key={name}><span className="avatar">{name.slice(0, 2).toUpperCase()}</span><div><strong>{name}</strong><small>Online · Java/Bedrock</small></div><div className="player-actions"><Button disabled={busy !== null} title="Message" onClick={() => tell(name)}><MessageSquare size={14} /></Button><Button disabled={busy !== null} title="Grant Operator" onClick={() => op(name)}><UserCog size={14} /></Button><Button disabled={busy !== null} variant="danger" title="Kick" onClick={() => remove(name)}><ShieldBan size={14} /></Button></div></Card>)}</div> : <EmptyState title="لا يوجد لاعبون متصلون" body="سيظهر اللاعبون هنا فور دخولهم إلى السيرفر." />}</div>;
}
