import type { Session, User } from "@supabase/supabase-js";
import {
  createContext,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { supabase } from "../lib/supabase";
import { completeHuggingFaceLink, isHuggingFaceCallback } from "../services/huggingface.service";
import type { Profile } from "../types";

interface AuthContextValue {
  loading: boolean;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: PropsWithChildren) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const loadProfile = async (authUser?: User) => {
    if (!authUser) {
      setProfile(null);
      return;
    }
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", authUser.id)
      .maybeSingle();
    let nextProfile = (data as Profile | null) ?? null;

    // GitHub provides `user_name`. Claim it automatically when available so
    // successful GitHub OAuth goes straight to the hosting dashboard.
    if (nextProfile?.username_completed === false) {
      const metadata = authUser.user_metadata ?? {};
      const candidate = String(
        metadata.user_name ?? metadata.preferred_username ?? metadata.username ?? "",
      ).toLowerCase();
      if (/^[a-z0-9_.-]{3,32}$/.test(candidate)) {
        const { data: updated } = await supabase
          .from("profiles")
          .update({
            username: candidate,
            display_name: metadata.full_name ?? metadata.name ?? candidate,
            avatar_url: metadata.avatar_url ?? null,
            username_completed: true,
          })
          .eq("id", authUser.id)
          .select()
          .maybeSingle();
        if (updated) nextProfile = updated as Profile;
      }
    }

    const pendingTerms = localStorage.getItem("saw_terms_pending");
    if (pendingTerms && nextProfile?.terms_version !== pendingTerms) {
      const { data: accepted } = await supabase
        .from("profiles")
        .update({ terms_version: pendingTerms, terms_accepted_at: new Date().toISOString() })
        .eq("id", authUser.id)
        .select()
        .maybeSingle();
      if (accepted) {
        nextProfile = accepted as Profile;
        localStorage.removeItem("saw_terms_pending");
      }
    }
    setProfile(nextProfile);
  };

  useEffect(() => {
    const initialize = async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      let nextSession: Session | null = null;

      if (code && isHuggingFaceCallback(params)) {
        // The user already has a Supabase session. Complete HF OAuth separately,
        // save the token server-side, then return to Connections.
        const { data } = await supabase.auth.getSession();
        nextSession = data.session;
        try {
          await completeHuggingFaceLink(params);
          window.location.hash = "/account/connections";
        } catch (error) {
          sessionStorage.setItem("hf_link_error", error instanceof Error ? error.message : String(error));
          window.location.hash = "/account/connections";
        }
        window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.hash}`);
      } else if (code) {
        const { data, error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error) nextSession = data.session;
        window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.hash}`);
      } else {
        const { data } = await supabase.auth.getSession();
        nextSession = data.session;
      }

      setSession(nextSession);
      await loadProfile(nextSession?.user);
      setLoading(false);
    };

    void initialize();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      void loadProfile(next?.user);
      setLoading(false);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      session,
      user: session?.user ?? null,
      profile,
      refreshProfile: () => loadProfile(session?.user),
    }),
    [loading, session, profile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}
