import { getFunctionError } from "../lib/function-error";
import { supabase } from "../lib/supabase";

export async function updatePassword(password: string) {
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw error;
}

export async function deleteAccount(confirmation: string) {
  const { data, error } = await supabase.functions.invoke("delete-account", {
    body: { confirmation },
  });
  if (error) throw await getFunctionError(error);
  if (!data?.ok) throw new Error(data?.error ?? "Account deletion failed");
  await supabase.auth.signOut({ scope: "local" });
}
