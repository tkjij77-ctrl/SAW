import { useQuery } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { PageError, PageLoading } from "../../components/ui/PageState";
import { readFile, writeFile } from "../../services/files.service";
import { deleteServer, getServer, invokeAgent } from "../../services/servers.service";

export function ServerSettingsPage() {
  const { serverId = "" } = useParams();
  const navigate = useNavigate();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const properties = useQuery({ queryKey: ["server-properties", serverId], queryFn: () => readFile(serverId, "server.properties"), retry: 1 });
  const server = useQuery({ queryKey: ["server", serverId], queryFn: () => getServer(serverId) });
  if (properties.isLoading || server.isLoading) return <PageLoading />;
  if (properties.error || server.error) return <PageError message={((properties.error || server.error) as Error).message} />;
  const values = parseProperties(properties.data?.content ?? "");

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setMessage("");
    const form = new FormData(event.currentTarget);
    const updates: Record<string, string> = {
      difficulty: String(form.get("difficulty")),
      gamemode: String(form.get("gamemode")),
      "max-players": bounded(form.get("max_players"), 1, 100, 20),
      "view-distance": bounded(form.get("view_distance"), 2, 32, 8),
      "simulation-distance": bounded(form.get("simulation_distance"), 2, 32, 6),
      "spawn-protection": bounded(form.get("spawn_protection"), 0, 64, 16),
      pvp: form.get("pvp") === "on" ? "true" : "false",
      "allow-flight": form.get("allow_flight") === "on" ? "true" : "false",
      "online-mode": "true",
      "enforce-secure-profile": "false",
    };
    try {
      const content = updateProperties(properties.data?.content ?? "", updates);
      await writeFile(serverId, "server.properties", content);
      setMessage("تم حفظ server.properties مع Backup تلقائي. أعد تشغيل السيرفر لتطبيق جميع القيم.");
      await properties.refetch();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Save failed"); }
    finally { setBusy(false); }
  };

  const restart = async () => {
    if (!window.confirm("حفظ العالم وإعادة تشغيل السيرفر الآن؟")) return;
    setBusy(true);
    try { await invokeAgent(serverId, "restart"); setMessage("بدأت إعادة التشغيل الآمنة."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Restart failed"); }
    finally { setBusy(false); }
  };

  const removeServer = async () => {
    const name = server.data?.name ?? "";
    const confirmation = window.prompt(`اكتب اسم السيرفر بالضبط للحذف النهائي:\n${name}`);
    if (confirmation === null) return;
    if (confirmation !== name) { setMessage("اسم التأكيد غير مطابق."); return; }
    const deleteDataset = window.confirm("هل تريد حذف Private Backup Dataset أيضًا؟\nOK = حذف النسخ نهائيًا\nCancel = الاحتفاظ بالنسخ");
    if (!window.confirm("سيتم حذف Hugging Face Space وسجل السيرفر من SAW. لا يمكن التراجع. متابعة؟")) return;
    setBusy(true); setMessage("جارٍ حذف موارد السيرفر بأمان...");
    try {
      await deleteServer(serverId, confirmation, { deleteSpace: true, deleteDataset });
      navigate("/servers", { replace: true });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Server deletion failed"); }
    finally { setBusy(false); }
  };

  return <div className="page"><header className="page-header"><div><span className="eyebrow">SERVER.PROPERTIES</span><h1>إعدادات السيرفر</h1><p>Real gameplay and performance configuration</p></div></header><form onSubmit={save} className="settings-grid"><Card className="settings-section"><h3>Gameplay</h3><label>Difficulty<select name="difficulty" defaultValue={values.difficulty ?? "normal"}><option>peaceful</option><option>easy</option><option>normal</option><option>hard</option></select></label><label>Gamemode<select name="gamemode" defaultValue={values.gamemode ?? "survival"}><option>survival</option><option>creative</option><option>adventure</option><option>spectator</option></select></label><label>Max Players<input name="max_players" type="number" min={1} max={100} defaultValue={values["max-players"] ?? 20} /></label><label>Spawn Protection<input name="spawn_protection" type="number" min={0} max={64} defaultValue={values["spawn-protection"] ?? 16} /></label></Card><Card className="settings-section"><h3>Performance</h3><label>View Distance<input name="view_distance" type="number" min={2} max={32} defaultValue={values["view-distance"] ?? 8} /></label><label>Simulation Distance<input name="simulation_distance" type="number" min={2} max={32} defaultValue={values["simulation-distance"] ?? 6} /></label><label>Java Memory<input value="2G · controlled by Space variable MC_XMX" readOnly /></label></Card><Card className="settings-section"><h3>Security & Rules</h3><label className="toggle-row"><input name="pvp" type="checkbox" defaultChecked={values.pvp !== "false"} /> PvP</label><label className="toggle-row"><input name="allow_flight" type="checkbox" defaultChecked={values["allow-flight"] === "true"} /> Allow Flight</label><label>Authentication<input value="online-mode=true" readOnly /></label><label>Bedrock compatibility<input value="enforce-secure-profile=false" readOnly /></label></Card><Card className="settings-section"><h3>Apply Changes</h3><p>يتم إنشاء ملف <code>server.properties.bak</code> قبل كل حفظ.</p><Button type="button" disabled={busy} onClick={() => void restart()}>Safe Restart</Button></Card><Card className="settings-section danger-zone"><h3>Danger Zone</h3><p>حذف Space نهائيًا مع اختيار الاحتفاظ بـPrivate Backup Dataset أو حذفه.</p><Button type="button" variant="danger" disabled={busy} onClick={() => void removeServer()}>Delete Server</Button></Card><div className="form-actions">{message && <span className="form-message">{message}</span>}<Button variant="primary" disabled={busy}>{busy ? "Saving..." : "Save Settings"}</Button></div></form></div>;
}

function parseProperties(content: string) { const values: Record<string, string> = {}; for (const line of content.split(/\r?\n/)) { const trimmed = line.trim(); if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue; const index = trimmed.indexOf("="); values[trimmed.slice(0, index)] = trimmed.slice(index + 1); } return values; }
function updateProperties(content: string, updates: Record<string, string>) { const seen = new Set<string>(); const lines = content.split(/\r?\n/).map((line) => { const trimmed = line.trim(); if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) return line; const key = trimmed.slice(0, trimmed.indexOf("=")); if (!(key in updates)) return line; seen.add(key); return `${key}=${updates[key]}`; }); for (const [key, value] of Object.entries(updates)) if (!seen.has(key)) lines.push(`${key}=${value}`); return `${lines.join("\n").replace(/\n+$/, "")}\n`; }
function bounded(value: FormDataEntryValue | null, min: number, max: number, fallback: number) { const number = Number(value); return String(Number.isFinite(number) ? Math.max(min, Math.min(max, Math.round(number))) : fallback); }
