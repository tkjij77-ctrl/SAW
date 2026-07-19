import { getFunctionError } from "../lib/function-error";
import { supabase } from "../lib/supabase";

const HF_AUTHORIZE = "https://huggingface.co/oauth/authorize";
const HF_TOKEN = "https://huggingface.co/oauth/token";
const HF_USERINFO = "https://huggingface.co/oauth/userinfo";
const REDIRECT_URI = "https://tkjij77-ctrl.github.io/SAW/";
const CLIENT_ID = "https://tkjij77-ctrl.github.io/SAW/.well-known/oauth-cimd";
const SCOPES = "openid profile manage-repos";

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomValue(size = 48) {
  const value = new Uint8Array(size);
  crypto.getRandomValues(value);
  return base64Url(value);
}

async function challenge(verifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export async function startHuggingFaceLink() {
  const verifier = randomValue(64);
  const state = randomValue(32);
  sessionStorage.setItem("hf_pkce_verifier", verifier);
  sessionStorage.setItem("hf_oauth_state", state);
  const query = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPES,
    state,
    code_challenge: await challenge(verifier),
    code_challenge_method: "S256",
  });
  window.location.assign(`${HF_AUTHORIZE}?${query}`);
}

export function isHuggingFaceCallback(params = new URLSearchParams(window.location.search)) {
  const expected = sessionStorage.getItem("hf_oauth_state");
  return Boolean(params.get("code") && expected && params.get("state") === expected);
}

export async function completeHuggingFaceLink(params = new URLSearchParams(window.location.search)) {
  const code = params.get("code");
  const state = params.get("state");
  const expected = sessionStorage.getItem("hf_oauth_state");
  const verifier = sessionStorage.getItem("hf_pkce_verifier");
  if (!code || !state || !expected || state !== expected || !verifier) throw new Error("Hugging Face OAuth state mismatch");

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: CLIENT_ID,
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });
  const tokenResponse = await fetch(HF_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body,
  });
  const tokenData = await tokenResponse.json();
  if (!tokenResponse.ok || !tokenData.access_token) throw new Error(tokenData.error_description ?? "Could not obtain Hugging Face token");

  const profileResponse = await fetch(HF_USERINFO, { headers: { Authorization: `Bearer ${tokenData.access_token}` } });
  const profile = await profileResponse.json();
  if (!profileResponse.ok) throw new Error("Could not load Hugging Face profile");

  const { data, error } = await supabase.functions.invoke("link-huggingface", {
    body: { hf_access_token: tokenData.access_token },
  });
  if (error) throw await getFunctionError(error);
  if (!data?.ok) throw new Error(data?.error ?? "Could not save Hugging Face connection");

  const username = profile.preferred_username ?? profile.name ?? profile.nickname ?? data.hf_username;
  localStorage.setItem("saw_hf_username", String(username));
  sessionStorage.removeItem("hf_pkce_verifier");
  sessionStorage.removeItem("hf_oauth_state");
  window.dispatchEvent(new CustomEvent("hf-connection-changed"));
  return String(username);
}

export function getLinkedHuggingFaceUsername() {
  return localStorage.getItem("saw_hf_username");
}

export async function unlinkHuggingFace() {
  const { data, error } = await supabase.functions.invoke("unlink-huggingface", { body: {} });
  if (error) throw await getFunctionError(error);
  if (!data?.ok) throw new Error(data?.error ?? "Could not unlink Hugging Face");
  localStorage.removeItem("saw_hf_username");
  window.dispatchEvent(new CustomEvent("hf-connection-changed"));
}
