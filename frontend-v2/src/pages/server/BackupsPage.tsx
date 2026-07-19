import { useQuery } from "@tanstack/react-query";
import { Archive, CloudUpload, HardDriveDownload, RefreshCw, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { createBackup, deleteBackup, listBackups, restoreBackup, waitForBackupJob, type ServerBackup } from "../../services/backups.service";
import { getServer, invokeAgent, upgradeServerAgent } from "../../services/servers.service";

export function BackupsPage() {
  const { serverId = "" } = useParams();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const backups = useQuery({ queryKey: ["backups", serverId], queryFn: () => listBackups(serverId), retry: 1 });
  const server = useQuery({ queryKey: ["server", serverId], queryFn: () => getServer(serverId) });
  const totalSize = useMemo(() => (backups.data ?? []).reduce((sum, item) => sum + item.size, 0), [backups.data]);
  const latest = backups.data?.[0];

  const create = async () => {
    const label = window.prompt("اسم النسخة الاحتياطية", "Manual backup");
    if (label === null) return;
    setBusy("create");
    setMessage("جارٍ حفظ العالم ورفعه إلى Private Dataset...");
    try {
      const queued = await createBackup(serverId, label);
      setMessage("تم بدء المهمة في الخلفية؛ جارٍ ضغط ورفع العالم...");
      await waitForBackupJob(serverId, queued.job_id);
      setMessage("تم إنشاء النسخة والتحقق من SHA-256 بنجاح.");
      await backups.refetch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "فشل إنشاء النسخة الاحتياطية");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (item: ServerBackup) => {
    if (!window.confirm(`حذف النسخة ${item.label} نهائيًا من Dataset؟`)) return;
    setBusy(item.id);
    setMessage("");
    try {
      await deleteBackup(serverId, item.archive);
      setMessage("تم حذف النسخة الاحتياطية.");
      await backups.refetch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "فشل حذف النسخة");
    } finally {
      setBusy(null);
    }
  };

  const restore = async (item: ServerBackup) => {
    if (!window.confirm(`استعادة ${item.label}؟ سيتم إيقاف السيرفر أولًا واستبدال بياناته الحالية.`)) return;
    setBusy(item.id);
    setMessage("جارٍ إيقاف السيرفر والتحقق من النسخة...");
    try {
      const status = await invokeAgent<{ running?: boolean }>(serverId, "status");
      if (status.running) await invokeAgent(serverId, "stop");
      const queued = await restoreBackup(serverId, item.archive);
      setMessage("بدأت الاستعادة في الخلفية؛ جارٍ تنزيل النسخة والتحقق منها...");
      const job = await waitForBackupJob(serverId, queued.job_id);
      const restored = Number(job.result?.restored_entries ?? 0);
      setMessage(`تمت الاستعادة بنجاح (${restored} عناصر). شغّل السيرفر بعد المراجعة.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "فشلت استعادة النسخة");
    } finally {
      setBusy(null);
    }
  };

  const upgradeAgent = async () => {
    if (!window.confirm("ترقية Minecraft Agent إلى v3.2.0؟ سيُعاد بناء وتشغيل Space تلقائيًا.")) return;
    setBusy("upgrade");
    setMessage("جارٍ رفع Agent v3.2.0 وإعداد سر النسخ الاحتياطي...");
    try {
      const result = await upgradeServerAgent(serverId);
      setMessage(`تمت الترقية من ${result.previous_version ?? "نسخة قديمة"} إلى ${result.version}. انتظر اكتمال Space Build ثم اضغط Refresh.`);
      await server.refetch();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Agent upgrade failed");
    } finally {
      setBusy(null);
    }
  };

  const download = (item: ServerBackup) => {
    const repo = server.data?.dataset_repo_id;
    if (!repo) return setMessage("Dataset repository غير مسجل لهذا السيرفر.");
    const repoPath = repo.split("/").map(encodeURIComponent).join("/");
    const filePath = item.archive.split("/").map(encodeURIComponent).join("/");
    window.open(`https://huggingface.co/datasets/${repoPath}/resolve/main/${filePath}?download=true`, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="page">
      <header className="page-header">
        <div><span className="eyebrow">PRIVATE DATASET BACKUPS</span><h1>النسخ الاحتياطية</h1><p>Verified snapshots stored in your private Hugging Face Dataset</p></div>
        <div className="power-actions">
          {needsUpgrade(server.data?.template_version) && <Button onClick={() => void upgradeAgent()} disabled={busy !== null}>Upgrade Agent v3.2</Button>}
          <Button onClick={() => void backups.refetch()} disabled={backups.isFetching}><RefreshCw size={15} /> Refresh</Button>
          <Button variant="primary" onClick={() => void create()} disabled={busy !== null}><CloudUpload size={15} />{busy === "create" ? "Creating..." : "Create Backup"}</Button>
        </div>
      </header>

      {message && <div className="form-message">{message}</div>}
      <div className="stats-grid backup-stats">
        <Card className="stat-card"><span>LAST BACKUP</span><strong>{latest ? formatDate(latest.created_at) : "—"}</strong><small>{latest?.label ?? "No snapshot yet"}</small></Card>
        <Card className="stat-card"><span>TOTAL</span><strong>{backups.data?.length ?? 0}</strong><small>{formatSize(totalSize)} in Dataset</small></Card>
        <Card className="stat-card"><span>RETENTION</span><strong>5</strong><small>Old snapshots pruned automatically</small></Card>
        <Card className="stat-card"><span>HEALTH</span><strong>{backups.data?.every((item) => item.health === "verified") ? "VERIFIED" : "—"}</strong><small>SHA-256 integrity</small></Card>
      </div>

      {backups.isLoading && <Card className="backup-empty"><RefreshCw /><h2>جارٍ قراءة Private Dataset...</h2></Card>}
      {backups.isError && <Card className="backup-empty"><Archive /><h2>تعذر تحميل النسخ</h2><p>{backups.error instanceof Error ? backups.error.message : "تأكد من HF_TOKEN وDataset"}</p></Card>}
      {!backups.isLoading && !backups.isError && !backups.data?.length && <Card className="backup-empty"><Archive /><h2>لا توجد Backups بعد</h2><p>أنشئ أول نسخة مشفرة النقل ومحفوظة داخل Dataset الخاص بك.</p></Card>}

      <div className="plugin-list">
        {backups.data?.map((item) => (
          <Card className="plugin-row" key={item.id}>
            <span className="service-logo"><ShieldCheck /></span>
            <div><strong>{item.label}</strong><small>{formatDate(item.created_at)} · {formatSize(item.size)} · Minecraft {item.version}</small></div>
            <Badge tone={item.health === "verified" ? "success" : "warning"}>{item.health}</Badge>
            <Button onClick={() => download(item)} disabled={busy !== null}><HardDriveDownload size={14} /> Download</Button>
            <Button onClick={() => void restore(item)} disabled={busy !== null}><RotateCcw size={14} /> Restore</Button>
            <Button variant="danger" onClick={() => void remove(item)} disabled={busy !== null}><Trash2 size={14} /></Button>
          </Card>
        ))}
      </div>
    </div>
  );
}

function needsUpgrade(version?: string | null) {
  if (!version) return true;
  const [major, minor] = version.split(".").map((part) => Number.parseInt(part, 10) || 0);
  return major < 3 || (major === 3 && minor < 2);
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("ar-EG", { dateStyle: "short", timeStyle: "short" });
}
