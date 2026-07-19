import type { Provider } from "@supabase/supabase-js";
import { env } from "../lib/env";
import { supabase } from "../lib/supabase";

export async function signInWithEmail(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signUpWithEmail(
  email: string,
  password: string,
  username: string,
) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: {
      username: username.toLowerCase(),
      display_name: username,
      terms_version: "2026-07-17",
      terms_accepted_at: new Date().toISOString(),
    } },
  });
  if (error) throw error;
  return data;
}

export async function signInWithProvider(provider: Extract<Provider, "github">) {
  const { error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${env.siteUrl}?oauth_callback=github` },
  });
  if (error) throw error;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}
