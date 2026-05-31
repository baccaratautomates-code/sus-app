import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "./AuthContext";
import { isOnboarded, markOnboarded } from "../storage";

interface OnboardedState {
  // null while we're loading the persisted flag (or while no user is signed
  // in — App.tsx routes to Auth in that case and ignores this value).
  onboarded: boolean | null;
  markComplete: () => Promise<void>;
}

const OnboardedContext = createContext<OnboardedState | undefined>(undefined);

export function OnboardedProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [onboarded, setOnboarded] = useState<boolean | null>(null);

  // Re-read whenever the signed-in user changes. Each user has its own
  // sus:onboarded:v1:<id> key, so a fresh account on the same browser sees
  // the carousel even if a previous account already completed it.
  useEffect(() => {
    if (!userId) {
      setOnboarded(null);
      return;
    }
    let cancelled = false;
    isOnboarded(userId).then((flag) => {
      if (!cancelled) setOnboarded(flag);
    });
    return () => { cancelled = true; };
  }, [userId]);

  const value = useMemo<OnboardedState>(
    () => ({
      onboarded,
      markComplete: async () => {
        if (!userId) return;
        await markOnboarded(userId);
        setOnboarded(true);
      },
    }),
    [onboarded, userId],
  );

  return (
    <OnboardedContext.Provider value={value}>
      {children}
    </OnboardedContext.Provider>
  );
}

export function useOnboarded(): OnboardedState {
  const ctx = useContext(OnboardedContext);
  if (!ctx) throw new Error("useOnboarded must be used inside <OnboardedProvider>");
  return ctx;
}
