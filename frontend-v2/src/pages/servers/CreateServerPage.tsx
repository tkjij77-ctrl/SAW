import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/Button";
import { createServer } from "../../services/provisioning.service";

const versions = ["26.2", "26.1.2", "1.21.11", "1.21.10", "1.21.9", "1.21.8", "1.21.7", "1.21.6", "1.21.5", "1.21.4", "1.21.3", "1.21.1", "1.21", "1.20.6"];

export function CreateServerPage() {
  const navigate = useNavigate(); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError(""); const form = new FormData(event.currentTarget);
    try { const result = await createServer({ display_name: String(form.get("display_name")), space_name: String(form.get("space_name")).toLowerCase(), minecraft_version: String(form.get("minecraft_version")), max_players: Number(form.get("max_players")) }); navigate(`/servers/provision/${result.job_id}`); }
    catch (e) { setError(e instanceof Error ? e.message : "Provisioning failed"); }
    finally { setBusy(false); }
  };
  return <div className="page narrow-page"><header className="page-header"><div><span className="eyebrow">AUTOMATIC DEPLOYMENT</span><h1>إنشاء Minecraft Server</h1><p>Private Dataset + Private ZeroGPU Space + Java & Bedrock</p></div></header><form className="wizard card" onSubmit={submit}><div className="wizard__step"><span>1</span><div><h3>Server details</h3><p>الاسم والإصدار وعدد اللاعبين</p></div></div><div className="form-grid"><label>اسم السيرفر<input name="display_name" required maxLength={80} placeholder="Survival Server" /></label><label>اسم Hugging Face Space<input name="space_name" required pattern="[a-z0-9][a-z0-9._-]{2,63}" placeholder="survival-server" /></label><label>الإصدار<select name="minecraft_version" defaultValue="1.21.1">{versions.map(v => <option key={v}>{v}</option>)}</select></label><label>عدد اللاعبين<input name="max_players" type="number" min={1} max={100} defaultValue={20} /></label></div><div className="review-grid"><span>🔒 Private Space</span><span>🗄 Private Dataset</span><span>⚡ ZeroGPU</span><span>◆ Java + Bedrock</span></div><label className="check-row"><input type="checkbox" required /> قرأت ووافقت على Minecraft EULA</label>{error && <div className="form-error">{error}</div>}<div className="form-actions"><Button type="button" onClick={() => navigate(-1)}>إلغاء</Button><Button type="submit" variant="primary" disabled={busy}>{busy ? "جارٍ الإرسال..." : "إنشاء وتجهيز السيرفر"}</Button></div></form></div>;
}
