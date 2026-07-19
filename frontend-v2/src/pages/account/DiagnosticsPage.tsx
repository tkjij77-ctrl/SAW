import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, RefreshCw, XCircle } from "lucide-react";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { useAuth } from "../../contexts/AuthContext";
import { env } from "../../lib/env";
import { supabase } from "../../lib/supabase";
import { getLinkedHuggingFaceUsername } from "../../services/huggingface.service";

interface Check { name: string; ok: boolean; detail: string; }
const functions = ["link-huggingface", "unlink-huggingface", "agent-command", "provision-server", "provision-status", "sync-servers", "upgrade-agent", "delete-server", "delete-account"];

export function DiagnosticsPage() {
  const { user, profile } = useAuth();
  const query = useQuery({ queryKey: ["launch-diagnostics", user?.id], queryFn: async () => {
    const checks: Check[] = [
      { name: "Browser Network", ok: navigator.onLine, detail: navigator.onLine ? "Online" : "Offline" },
      { name: "SAW Session", ok: Boolean(user), detail: user ? `Authenticated: ${user.email ?? user.id}` : "No session" },
      { name: "SAW Profile", ok: Boolean(profile?.username), detail: profile?.username ?? "Profile missing" },
      { name: "Hugging Face Link", ok: Boolean(getLinkedHuggingFaceUsername()), detail: getLinkedHuggingFaceUsername() ?? "Not linked" },
    ];

    try {
      const response = await fetch(`${env.supabaseUrl}/auth/v1/settings`, { headers: { apikey: env.supabaseAnonKey } });
      const settings = await response.json();
      checks.push({ name: "Email Signup", ok: Boolean(settings?.external?.email), detail: settings?.mailer_autoconfirm ? "Enabled · OTP bypassed by autoconfirm" : "Enabled · confirmation required" });
      checks.push({ name: "GitHub OAuth", ok: Boolean(settings?.external?.github), detail: settings?.external?.github ? "Enabled" : "Disabled" });
      checks.push({ name: "Google OAuth", ok: !settings?.external?.google, detail: settings?.external?.google ? "Unexpectedly enabled" : "Disabled as required" });
    } catch { checks.push({ name: "Supabase Auth", ok: false, detail: "Settings request failed" }); }

    try {
      const response = await fetch(`${env.siteUrl}version.json?diagnostics=${Date.now()}`, { cache: "no-store" });
      const version = await response.json();
      checks.push({ name: "Frontend Build", ok: response.ok && Boolean(version.sha), detail: version.sha ? `${String(version.sha).slice(0, 8)} · ${version.builtAt}` : "version.json unavailable" });
    } catch { checks.push({ name: "Frontend Build", ok: false, detail: "version.json request failed" }); }

    const functionChecks = await Promise.all(functions.map(async (name): Promise<Check> => {
      try {
        const response = await fetch(`${env.supabaseUrl}/functions/v1/${name}`, { method: "OPTIONS" });
        return { name: `Function: ${name}`, ok: response.status === 204, detail: `HTTP ${response.status}` };
      } catch { return { name: `Function: ${name}`, ok: false, detail: "Network failure" }; }
    }));
    checks.push(...functionChecks);

    const { count, error } = await supabase.from("servers").select("id", { count: "exact", head: true });
    checks.push({ name: "Database / RLS", ok: !error, detail: error?.message ?? `${count ?? 0} accessible server(s)` });
    return checks;
  }, retry: false });

  const checks = query.data ?? [];
  const passed = checks.filter((check) => check.ok).length;
  return <div className="page"><header className="page-header"><div><span className="eyebrow">SYSTEM DIAGNOSTICS</span><h1>تشخيص جاهزية الحساب</h1><p>Public checks only — no Tokens or secrets are displayed</p></div><Button onClick={() => void query.refetch()} disabled={query.isFetching}><RefreshCw size={15} /> Run Again</Button></header><Card className="padded"><div className="card-head"><h2>Launch checks</h2><strong>{passed}/{checks.length || "—"}</strong></div><div className="diagnostic-list">{query.isLoading && <div className="muted">جارٍ تشغيل الاختبارات...</div>}{checks.map((check) => <div className={`diagnostic-row ${check.ok ? "pass" : "fail"}`} key={check.name}>{check.ok ? <CheckCircle2 /> : <XCircle />}<div><strong>{check.name}</strong><small>{check.detail}</small></div></div>)}</div></Card></div>;
}
