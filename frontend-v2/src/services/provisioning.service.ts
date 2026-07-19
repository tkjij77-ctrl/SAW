import { supabase } from "../lib/supabase";
import { getFunctionError } from "../lib/function-error";
import type { ProvisioningJob } from "../types";

export interface CreateServerInput {
  display_name: string;
  space_name: string;
  minecraft_version: string;
  max_players: number;
}

export async function createServer(input: CreateServerInput) {
  const { data, error } = await supabase.functions.invoke("provision-server", {
    body: input,
  });
  if (error) throw await getFunctionError(error);
  if (!data?.ok) throw new Error(data?.error ?? "Provisioning failed");
  return data as { job_id: string; server: unknown };
}

export async function getProvisioningStatus(jobId: string): Promise<ProvisioningJob> {
  const { data, error } = await supabase.functions.invoke("provision-status", {
    body: { job_id: jobId },
  });
  if (error) throw await getFunctionError(error);
  if (!data?.ok) throw new Error(data?.error ?? "Could not read provisioning status");
  return data.job as ProvisioningJob;
}
