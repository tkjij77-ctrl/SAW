import { invokeAgent } from "./servers.service";

export interface RemoteFile { name: string; size: number; binary: boolean; }
export interface FileListing { path: string; folders: Array<{ name: string }>; files: RemoteFile[]; }

export const listFiles = (serverId: string, path: string) => invokeAgent<FileListing>(serverId, "file_list", { path });
export const readFile = (serverId: string, path: string) => invokeAgent<{ path: string; name: string; size: number; content: string }>(serverId, "file_read", { path });
export const writeFile = (serverId: string, path: string, content: string) => invokeAgent<{ ok: boolean; backup: string }>(serverId, "file_write", { path, content });
export interface SafeApplyResult {
  ok: boolean;
  backup: string;
  sha256: string;
  content: string;
  persistence: "dataset-verified" | "local-only";
  dataset_backup: string | null;
  restarting: boolean;
}
export const writeFileSafe = (serverId: string, path: string, content: string) => invokeAgent<{
  ok: true; queued: true; job_id: string; state: "queued";
}>(serverId, "file_write_safe", { path, content });
export async function waitForSafeApply(serverId: string, jobId: string, onState?: (state: string) => void) {
  const started = Date.now();
  while (Date.now() - started < 15 * 60_000) {
    const job = await invokeAgent<{
      state: "queued" | "running" | "completed" | "failed";
      error?: string;
      result?: SafeApplyResult;
    }>(serverId, "file_write_safe_status", { job_id: jobId });
    onState?.(job.state);
    if (job.state === "completed" && job.result) return job.result;
    if (job.state === "failed") throw new Error(job.error || "Backend Safe Apply failed");
    await new Promise((resolve) => window.setTimeout(resolve, 2500));
  }
  throw new Error("Safe Apply timed out; check Console and Dataset status");
}

export async function uploadFile(
  serverId: string,
  directory: string,
  file: File,
  onProgress?: (percent: number, detail: string) => void,
) {
  if (file.size > 512 * 1024 * 1024) throw new Error("الحد الأقصى الحالي 512 MB لكل ملف");
  if (file.size <= 8 * 1024 * 1024) {
    onProgress?.(5, `Uploading ${file.name}...`);
    const data = await blobToBase64(file);
    const result = await invokeAgent<{ ok: boolean; path: string; size: number }>(serverId, "file_upload", { path: directory, name: file.name, data });
    onProgress?.(100, `${file.name} uploaded`);
    return result;
  }
  return uploadFileChunked(serverId, directory, file, onProgress);
}

async function uploadFileChunked(
  serverId: string,
  directory: string,
  file: File,
  onProgress?: (percent: number, detail: string) => void,
) {
  const resumeKey = `saw_upload_${serverId}_${directory}_${file.name}_${file.size}_${file.lastModified}`;
  let uploadId = localStorage.getItem(resumeKey) ?? "";
  let chunkSize = 3 * 1024 * 1024;
  let nextIndex = 0;
  let received = 0;

  if (uploadId) {
    try {
      const status = await invokeAgent<{ next_index: number; received: number; total_size: number }>(serverId, "file_upload_status", { upload_id: uploadId });
      if (status.total_size !== file.size) throw new Error("Resume metadata mismatch");
      nextIndex = status.next_index;
      received = status.received;
    } catch {
      localStorage.removeItem(resumeKey);
      uploadId = "";
    }
  }

  if (!uploadId) {
    const initialized = await invokeAgent<{ upload_id: string; chunk_size: number; next_index: number; received: number }>(serverId, "file_upload_init", {
      path: directory,
      name: file.name,
      total_size: file.size,
      sha256: "",
    });
    uploadId = initialized.upload_id;
    chunkSize = initialized.chunk_size;
    nextIndex = initialized.next_index;
    received = initialized.received;
    localStorage.setItem(resumeKey, uploadId);
  }

  while (received < file.size) {
    const start = nextIndex * chunkSize;
    const end = Math.min(start + chunkSize, file.size);
    const chunk = file.slice(start, end);
    const buffer = await chunk.arrayBuffer();
    const chunkSha256 = await sha256Hex(buffer);
    const data = arrayBufferToBase64(buffer);
    const result = await invokeAgent<{ next_index: number; received: number }>(serverId, "file_upload_chunk", {
      upload_id: uploadId,
      chunk_index: nextIndex,
      chunk_sha256: chunkSha256,
      data,
    });
    nextIndex = result.next_index;
    received = result.received;
    const percent = Math.min(99, Math.round((received / file.size) * 100));
    onProgress?.(percent, `${file.name}: ${percent}% (${formatBytes(received)} / ${formatBytes(file.size)})`);
  }

  const completed = await invokeAgent<{ ok: boolean; path: string; size: number; sha256: string }>(serverId, "file_upload_complete", { upload_id: uploadId });
  localStorage.removeItem(resumeKey);
  onProgress?.(100, `${file.name} uploaded & verified · SHA-256 ${completed.sha256.slice(0, 12)}…`);
  return completed;
}

export const createRemoteItem = (serverId: string, path: string, itemType: "file" | "folder") => invokeAgent(serverId, "file_create", { path, item_type: itemType });
export const renameRemoteItem = (serverId: string, path: string, newName: string) => invokeAgent(serverId, "file_rename", { path, new_name: newName });
export const deleteRemoteItem = (serverId: string, path: string) => invokeAgent(serverId, "file_delete", { path });

export async function downloadRemoteFile(serverId: string, path: string) {
  const result = await invokeAgent<{ name: string; size: number; data: string }>(serverId, "file_download", { path });
  const binary = atob(result.data);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes]));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = result.name; anchor.click();
  URL.revokeObjectURL(url);
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(blob);
  });
}
function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + 0x8000, bytes.length)));
  }
  return btoa(binary);
}
async function sha256Hex(buffer: ArrayBuffer) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function formatBytes(value: number) {
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}
