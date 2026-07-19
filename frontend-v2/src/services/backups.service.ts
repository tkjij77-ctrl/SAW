import { invokeAgent } from "./servers.service";

export interface ServerBackup {
  id: string;
  label: string;
  created_at: string;
  size: number;
  sha256: string;
  archive: string;
  manifest: string;
  version: string;
  health: "verified" | "unknown";
}
export interface BackupJob {
  id: string;
  operation: "create" | "restore";
  state: "queued" | "running" | "completed" | "failed";
  error?: string;
  result?: Record<string, unknown>;
}
interface QueuedBackupJob { ok: true; queued: true; job_id: string; state: "queued"; }

export const listBackups = (serverId: string) => invokeAgent<ServerBackup[]>(serverId, "backup_list");
export const createBackup = (serverId: string, label: string) => invokeAgent<QueuedBackupJob>(serverId, "backup_create", { label });
export const getBackupJob = (serverId: string, jobId: string) => invokeAgent<BackupJob>(serverId, "backup_status", { job_id: jobId });
export const deleteBackup = (serverId: string, archive: string) => invokeAgent<{ ok: boolean; archive: string }>(serverId, "backup_delete", { path: archive });
export const restoreBackup = (serverId: string, archive: string) => invokeAgent<QueuedBackupJob>(serverId, "backup_restore", { path: archive });

export async function waitForBackupJob(serverId: string, jobId: string, timeoutMs = 15 * 60_000): Promise<BackupJob> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const job = await getBackupJob(serverId, jobId);
    if (job.state === "completed") return job;
    if (job.state === "failed") throw new Error(job.error || "Backup operation failed");
    await new Promise((resolve) => window.setTimeout(resolve, 3000));
  }
  throw new Error("انتهت مهلة العملية؛ افحص Dataset وAgent logs.");
}
