import type { Session, User } from "@supabase/supabase-js";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "../supabase";

interface AuthState {
  session: Session | null;
  user: User | null;
  // True while we're checking persisted storage on app boot. UI should hold
  // on a blank screen during this so we don't flash Auth → Home unnecessarily.
  loading: boolean;
  signOut: () => Promise<void>;
  // Local-scope sign-out for the post-deletion case. The server has already
  // wiped auth.users, so a regular (global) signOut would try to revoke a
  // JWT bound to a deleted user and 401 — sometimes silently leaving the
  // local session intact. Local scope clears only the on-device JWT, which
  // is exactly what we want after the user no longer exists server-side.
  signOutLocal: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Load any persisted session on boot. Supabase reads its own storage.
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    // Live subscription — fires on sign in, sign out, token refresh, etc.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });

    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      session,
      user: session?.user ?? null,
      loading,
      signOut: async () => {
        await supabase.auth.signOut();
      },
      signOutLocal: async () => {
        // scope:'local' clears the on-device JWT without calling /auth/v1/logout
        // on the server — appropriate when the server-side user has already
        // been deleted (account deletion flow). Defensive: also explicitly
        // nulls our local state in case onAuthStateChange doesn't fire.
        await supabase.auth.signOut({ scope: "local" });
        setSession(null);
      },
    }),
    [session, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
