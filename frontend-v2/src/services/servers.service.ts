import { supabase } from "../lib/supabase";
import { getFunctionError } from "../lib/function-error";
import type { Server } from "../types";

let serversSynced = false;

export async function listServers(): Promise<Server[]> {
  if (!serversSynced) {
    const { data } = await supabase.functions.invoke("sync-servers", { body: {} });
    if (data?.ok) serversSynced = true;
  }
  const { data, error } = await supabase
    .from("servers")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Server[];
}

export async function getServer(serverId: string): Promise<Server> {
  const { data, error } = await supabase
    .from("servers")
    .select("*")
    .eq("id", serverId)
    .single();
  if (error) throw error;
  return data as Server;
}

export async function deleteServer(
  serverId: string,
  confirmation: string,
  options: { deleteSpace: boolean; deleteDataset: boolean },
): Promise<void> {
  const { data, error } = await supabase.functions.invoke("delete-server", {
    body: {
      server_id: serverId,
      confirmation,
      delete_space: options.deleteSpace,
      delete_dataset: options.deleteDataset,
    },
  });
  if (error) throw await getFunctionError(error);
  if (!data?.ok) throw new Error(data?.error ?? "Server deletion failed");
}

export async function upgradeServerAgent(serverId: string): Promise<{ version: string; previous_version?: string }> {
  const { data, error } = await supabase.functions.invoke("upgrade-agent", {
    body: { server_id: serverId },
  });
  if (error) throw await getFunctionError(error);
  if (!data?.ok) throw new Error(data?.error ?? "Agent upgrade failed");
  return data as { version: string; previous_version?: string };
}

const WAKE_RETRY_CODES = new Set(["SPACE_WAKING", "SPACE_NOT_READY"]);
const sleep = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

export async function invokeAgent<T>(
  serverId: string,
  action: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  for (let attempt = 0; attempt < 48; attempt += 1) {
    const { data, error } = await supabase.functions.invoke("agent-command", {
      body: { server_id: serverId, action, ...payload },
    });
    if (error) {
      const parsed = await getFunctionError(error);
      if (WAKE_RETRY_CODES.has(parsed.code) && attempt < 47) {
        await sleep(5000);
        continue;
      }
      throw parsed;
    }
    if (!data?.ok) {
      if (WAKE_RETRY_CODES.has(String(data?.code)) && attempt < 47) {
        await sleep(5000);
        continue;
      }
      throw new Error(data?.error ?? "Agent request failed");
    }
    return data.result as T;
  }
  throw new Error("Space wake timed out after 4 minutes");
}
